import assert from "node:assert/strict";
import {randomBytes,randomUUID,createHash} from "node:crypto";
import {createAppDatabase,createAuthDatabase} from "@oliginvest/db";
import {sql} from "drizzle-orm";
import {AuthService} from "../dist/auth/service.js";
import {PatService} from "../dist/auth/pat-service.js";
import {sessionCookie} from "../dist/auth/session.js";
import {NotificationRepository} from "@oliginvest/mod-notifications/server";
import {dispatchNotification} from "@oliginvest/mod-notifications/jobs";
import {PortfolioRepository} from '@oliginvest/mod-portfolio/server';
import {AlertRepository} from '@oliginvest/mod-alerts/server';
import {evaluateAlerts,flushAlertEvents} from '@oliginvest/mod-alerts/jobs';
import {createApp} from '../dist/app.js';

export async function testM4Backend(settings){
  const connection={host:settings.host,port:settings.port,database:settings.database};
  const database=createAuthDatabase({...connection,password:settings.passwords.auth});
  const appDatabase=createAppDatabase({...connection,password:settings.passwords.app});
  const configuration={origin:"https://example.test",secrets:[{version:1,value:randomBytes(32).toString("hex")}],trustedProxies:[],sendReset:async()=>{}};
  const users=[randomUUID(),randomUUID()],sessions=users.map(()=>randomBytes(32).toString("hex")),instrumentId=randomUUID(),secondInstrumentId=randomUUID();
  const mail=new Map(),limits=[],audit=[];
  let queueUnavailable=false,limited=false;
  const service=new AuthService({database,appDatabase,configuration,
    state:{limit:async(...args)=>{limits.push(args);if(limited){const {ProblemError}=await import('@oliginvest/platform');throw new ProblemError('RATE_LIMITED');}}},
    passwordChecks:{compromised:async()=>false,unavailable(){}},audit:{record:async(...args)=>audit.push(args)},
    patMail:async(id,payload,delay)=>{if(queueUnavailable)throw Error('QUEUE_UNAVAILABLE');if(!mail.has(id))mail.set(id,{payload,delay});},
    cancelPatMail:async id=>mail.delete(id),
  });
  const pats=new PatService(service),notifications=new NotificationRepository(appDatabase);
  const context={userId:users[0],role:'user'},other={userId:users[1],role:'user'};
  const request=(index=0)=>new Request(configuration.origin+'/api/v1/me/tokens',{method:'POST',headers:{origin:configuration.origin,cookie:sessionCookie(sessions[index],configuration,false).split(';')[0]}});
  const bearer=(token,path='/api/v1/quick/today',extra={})=>new Request(configuration.origin+path,{headers:{authorization:`Bearer ${token}`,...extra}});
  const denied=(run,code)=>assert.rejects(run,error=>error.code===code);
  try{
    await database.transaction(async tx=>{
      for(const [index,id] of users.entries()){
        await tx.execute(sql`INSERT INTO auth.users(id,name,email,email_verified,two_factor_enabled) VALUES(${id}::uuid,'Synthetic M4',${`${id}@example.invalid`},true,true)`);
        await tx.execute(sql`INSERT INTO auth.sessions(token,user_id,expires_at,mfa_verified_at,mfa_method)VALUES(${sessions[index]},${id}::uuid,now()+interval '1 day',now(),'totp')`);
      }
    });
    for(const id of users)await service.recordConsents(id,false);
    const input={name:'Synthetic shortcut',scopes:['portfolio:read','market:read'],expiresInDays:90},key=randomUUID();
    const results=await Promise.all([pats.create(request(),input,key),pats.create(request(),input,key)]);
    const first=results.find(r=>r.tokenShown),replay=results.find(r=>!r.tokenShown);
    assert.ok(first?.token);assert.equal(first.id,replay.id);assert.equal(replay.token,undefined);
    const stored=await database.transaction(async tx=>(await tx.execute(sql`SELECT key,metadata FROM auth.api_keys WHERE id=${first.id}::uuid`)).rows[0]);
    assert.equal(stored.key,createHash('sha256').update(first.token).digest('base64url'));
    assert.ok(!stored.metadata.includes(first.token));assert.ok(!JSON.stringify(audit).includes(first.token));
    assert.equal((await pats.list(request())).data.length,1);assert.equal((await pats.list(request(1))).data.length,0);
    await denied(()=>pats.create(request(),{...input,name:'Changed'},key),'IDEMPOTENCY_CONFLICT');
    await denied(()=>pats.revoke(request(1),first.id),'NOT_FOUND');
    await denied(()=>pats.authorize(bearer(first.token), 'transactions:write','192.0.2.1'),'PAT_SCOPE_MISSING');
    await denied(()=>pats.authorize(bearer(first.token,'/api/v1/market/instruments'),'market:read','192.0.2.1'),'UNAUTHENTICATED');
    await denied(()=>pats.authorize(bearer(first.token,undefined,{cookie:'unrelated=x'}),'market:read','192.0.2.1'),'UNAUTHENTICATED');
    await denied(()=>service.requireData(bearer(first.token)),'FORBIDDEN');
    queueUnavailable=true;
    await assert.rejects(()=>pats.authorize(bearer(first.token),'portfolio:read','192.0.2.1'),/QUEUE_UNAVAILABLE/);
    queueUnavailable=false;
    await pats.authorize(bearer(first.token),'portfolio:read','192.0.2.2');
    await pats.authorize(bearer(first.token),'portfolio:read','192.0.2.3');
    assert.equal([...mail.keys()].filter(k=>k.startsWith('pat-network')).length,1);
    assert.ok(limits.some(([,max,window])=>max===30&&window===60));assert.ok(limits.some(([,max,window])=>max===2000&&window===86400));
    limited=true;await denied(()=>pats.authorize(bearer(first.token),'portfolio:read','192.0.2.1'),'RATE_LIMITED');limited=false;
    await database.transaction(tx=>tx.execute(sql`UPDATE auth.sessions SET mfa_verified_at=now()-interval '16 minutes' WHERE user_id=${users[0]}::uuid`));
    await denied(()=>pats.create(request(),input,randomUUID()),'STEP_UP_REQUIRED');
    await database.transaction(tx=>tx.execute(sql`UPDATE auth.sessions SET mfa_verified_at=now() WHERE user_id=${users[0]}::uuid`));
    await database.transaction(tx=>tx.execute(sql`UPDATE auth.api_keys SET expires_at=now()-interval '1 second' WHERE id=${first.id}::uuid`));
    await denied(()=>pats.authorize(bearer(first.token),'portfolio:read','192.0.2.1'),'UNAUTHENTICATED');
    await pats.revoke(request(),first.id);
    await pats.create(request(),input,key);
    assert.equal(mail.has(`pat-expiry-${first.id}`),false);
    await denied(()=>pats.authorize(bearer(first.token),'portfolio:read','192.0.2.1'),'UNAUTHENTICATED');

    const quiet={channels:{push:true,email:true},emailFallback:true,quietHours:{start:'22:00',end:'07:00'}};
    await notifications.replace(context,quiet);
    const rule=randomUUID(),sent=[];
    const job=(minute)=>({v:1,userId:users[0],kind:'alert',sourceRef:`alert:${rule}:${randomUUID()}`,channels:['push'],subject:'Fakt',text:'Źródło: Yahoo; dane 20:00; wyzwolenie 22:00.',occurredAt:`2026-10-24T22:${minute}:00Z`});
    const a=job('00'),b=job('01'),send=async(...args)=>sent.push(args),night=new Date(a.occurredAt),morning=new Date('2026-10-25T06:00:00Z');
    assert.equal((await dispatchNotification(appDatabase,a,send,night)).delayUntil,morning.getTime());
    await dispatchNotification(appDatabase,b,send,night);
    await Promise.all([dispatchNotification(appDatabase,a,send,morning),dispatchNotification(appDatabase,b,send,morning),dispatchNotification(appDatabase,b,send,morning)]);
    assert.equal(sent.length,1);
    await notifications.replace(context,{...quiet,channels:{push:false,email:false}});
    await dispatchNotification(appDatabase,{...job('02'),kind:'security',sourceRef:`security:${randomUUID()}`},send,night);
    assert.equal(sent.length,2);assert.equal(sent[1][3],true);
    assert.equal((await notifications.deliveries(other,{limit:50})).data.length,0);
    const history=(await notifications.deliveries(context,{limit:50})).data;
    assert.equal(history.filter(d=>d.status==='sent').length,2);assert.equal(history.filter(d=>d.status==='skipped').length,1);

    const enqueued=[],repo=new PortfolioRepository(appDatabase,async payload=>enqueued.push(payload));
    const alerts=new AlertRepository(appDatabase);
    await appDatabase.transaction({userId:null,role:'system'},async tx=>{
      await tx.execute(sql`INSERT INTO market.instruments(id,ticker,name,mic,currency,type)VALUES(${instrumentId}::uuid,'M4SYN','Synthetic instrument','XWAR','PLN','stock'),(${secondInstrumentId}::uuid,'M4SYN','Synthetic alternate','XNYS','USD','stock')`);
      await tx.execute(sql`INSERT INTO market.quotes_latest(instrument_id,price,prev_close,as_of,delay_minutes,source,fetched_at)VALUES(${instrumentId}::uuid,101,100,now(),15,'yahoo',now())`);
    });
    const createdRule=(await alerts.create(context,{type:'price_above',instrumentId,params:{threshold:'100'},channels:['email']},randomUUID())).data;
    await denied(()=>alerts.get(other,createdRule.id),'NOT_FOUND');
    const eventJob={v:1,userId:users[0],mode:'quote'};
    await Promise.all([evaluateAlerts(appDatabase,eventJob,configuration.origin),evaluateAlerts(appDatabase,eventJob,configuration.origin)]);
    assert.equal((await alerts.events(context,{limit:50})).data.length,1);
    assert.equal((await alerts.events(other,{limit:50})).data.length,0);
    const messages=[];
    await flushAlertEvents(appDatabase,users[0],async(...args)=>messages.push(args),async()=>{});
    await flushAlertEvents(appDatabase,users[0],async(...args)=>messages.push(args),async()=>{});
    assert.equal(messages.length,1);assert.match(messages[0][1].text,/Yahoo/);
    await alerts.remove(context,createdRule.id);assert.equal((await alerts.events(context,{limit:50})).data.length,1);
    const staleRule=(await alerts.create(context,{type:'price_above',instrumentId,params:{threshold:'100'},channels:['email']},randomUUID())).data;
    await appDatabase.transaction({userId:null,role:'system'},tx=>tx.execute(sql`UPDATE market.quotes_latest SET fetched_at=now()-interval '1 hour' WHERE instrument_id=${instrumentId}::uuid`));
    await evaluateAlerts(appDatabase,eventJob,configuration.origin);
    assert.equal((await alerts.events(context,{limit:50,ruleId:staleRule.id})).data.length,0);

    const account=(await repo.createAccount(context,{name:'Synthetic PLN',broker:'other',currency:'PLN',accountType:'regular'},randomUUID())).value;
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Warsaw'}).format(new Date());
    await repo.createTransaction(context,{accountId:account.id,type:'DEPOSIT',tradeDate:today,amount:{amount:'1000',currency:'PLN'}},randomUUID());
    const token=await pats.create(request(),{name:'Quick tests',scopes:['transactions:write','portfolio:read','market:read','alerts:read']},randomUUID());
    const app=createApp({logger:{info(){},warn(){},error(){}},publicBaseUrl:configuration.origin,checks:{postgres:async()=>{},valkeyQueue:async()=>{},valkeyCache:async()=>{}},auth:{service:()=>service,clientIp:()=> '192.0.2.1'},portfolio:{repository:()=>repo,authorize:async()=>context,assertOrigin:async()=>{}}});
    const quick=(path,body,key=randomUUID(),secret=token.token)=>app.request('/api/v1/quick/'+path,{method:body?'POST':'GET',headers:{authorization:`Bearer ${secret}`,'content-type':'application/json','idempotency-key':key},...(body?{body:JSON.stringify(body)}:{})});
    const ambiguous=await quick('quote?ticker=M4SYN');assert.equal(ambiguous.status,409);assert.equal((await ambiguous.json()).candidates.length,2);
    const quote=await quick('quote?ticker=M4SYN&mic=XWAR');assert.equal(quote.status,200);assert.equal((await quote.json()).stale,true);
    const quickInput={ticker:'M4SYN',mic:'XWAR',side:'BUY',quantity:'1',price:'101,00',fee:'0'},quickKey=randomUUID();
    const created=await quick('transactions',quickInput,quickKey);assert.equal(created.status,201,await created.clone().text());
    const record=await created.json(),repeated=await quick('transactions',quickInput,quickKey);assert.equal(repeated.status,201);assert.equal((await repeated.json()).transactionId,record.transactionId);
    const duplicate=await quick('transactions',quickInput);assert.equal(duplicate.status,409);assert.equal((await duplicate.json()).code,'CONFLICT');
    assert.equal((await quick('transactions',{...quickInput,confirmDuplicate:true})).status,201);
    assert.equal((await quick('transactions',{...quickInput,price:101})).status,422);
    assert.equal((await quick('transactions',{...quickInput,accountId:randomUUID()})).status,422);
    const reader=await pats.create(request(),{name:'Read only',scopes:['portfolio:read']},randomUUID());
    assert.equal((await quick('transactions',quickInput,randomUUID(),reader.token)).status,403);
    const started=performance.now();const day=await quick('today?format=text');assert.equal(day.status,200,await day.clone().text());assert.ok(performance.now()-started<300,'quick today latency <300ms');
    assert.equal((await quick('alerts')).status,200);
    await appDatabase.transaction({userId:null,role:'system'},tx=>tx.execute(sql`DELETE FROM market.quotes_latest WHERE instrument_id=${instrumentId}::uuid`));
    const missing=await quick('portfolio');assert.equal(missing.status,200);const missingData=await missing.json();assert.equal(missingData.totalValue,null);assert.equal(missingData.incomplete,true);assert.ok(missingData.reasons.some(r=>r.code==='missing_price'));
    await pats.revoke(request(),token.id);assert.equal((await quick('today')).status,401);
  }finally{
    await database.transaction(tx=>tx.execute(sql`DELETE FROM auth.users WHERE id=ANY(${sql.param(users)}::uuid[])`));
    await appDatabase.transaction({userId:null,role:'system'},tx=>tx.execute(sql`DELETE FROM market.instruments WHERE id=ANY(${sql.param([instrumentId,secondInstrumentId])}::uuid[])`));
    await Promise.all([database.close(),appDatabase.close()]);
  }
}
