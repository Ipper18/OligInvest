import {evaluatePriceAlert,toDecimal} from "@oliginvest/core";
import type {AppDatabase} from "@oliginvest/db";
import {alertMessages} from "@oliginvest/i18n";
import {sql} from "drizzle-orm";
import {z} from "zod";
import {alertJob,priceRuleInput,stateSchema} from "./contracts.js";
import {alertMessage} from "./message.js";
import {ruleDto} from "./server/repository.js";

export async function evaluateAlerts(database:AppDatabase,input:unknown,origin:string,now=new Date()) {
  const job=alertJob.parse(input),context={userId:job.userId,role:"user" as const};
  await database.transaction(context,async tx=>{
    const timezone=String((await tx.execute(sql`SELECT timezone FROM identity.user_preferences`)).rows[0]?.timezone??"Europe/Warsaw");
    const rules=(await tx.execute(sql`SELECT * FROM alerts.alert_rules WHERE enabled AND type IN ('price_above','price_below','change_pct') ORDER BY id FOR UPDATE`)).rows;
    for(const row of rules) {
      const dto=ruleDto(row),rule=priceRuleInput.parse({type:dto.type,params:dto.params,instrumentId:dto.instrumentId,channels:dto.channels,cooldownMinutes:dto.cooldownMinutes,hysteresis:dto.hysteresis,enabled:dto.enabled});
      if(rule.type!=="change_pct" && rule.params.basis==="close" && job.mode!=="eod")continue;
      const market=(await tx.execute(sql`SELECT i.ticker,i.currency,i.mic,EXISTS(SELECT 1 FROM market.data_quality_issues d WHERE d.instrument_id=i.id AND status='open' AND severity='BLOCK') AS blocked FROM market.instruments i WHERE id=${rule.instrumentId}::uuid AND is_active`)).rows[0];
      if(!market||market.blocked)continue;
      let observation:Record<string,unknown>|undefined;
      if(job.mode==="quote") observation=(await tx.execute(sql`SELECT price::text,prev_close::text,as_of,fetched_at,delay_minutes,source,to_char(as_of AT TIME ZONE CASE WHEN ${market.mic}='XWAR' THEN 'Europe/Warsaw' ELSE 'America/New_York' END,'YYYY-MM-DD') AS session_date FROM market.quotes_latest WHERE instrument_id=${rule.instrumentId}::uuid`)).rows[0];
      else observation=(await tx.execute(sql`SELECT b.close::text AS price,p.close::text AS prev_close,(c.session_date+c.close_time) AT TIME ZONE c.timezone AS as_of,b.ingested_at AS fetched_at,0 AS delay_minutes,b.source,b.session_date::text FROM market.trading_calendar c JOIN market.bars_daily b ON b.instrument_id=${rule.instrumentId}::uuid AND b.session_date=c.session_date LEFT JOIN LATERAL(SELECT close FROM market.bars_daily WHERE instrument_id=b.instrument_id AND session_date<b.session_date ORDER BY session_date DESC LIMIT 1)p ON true WHERE c.mic=${market.mic} AND c.is_open AND c.close_time IS NOT NULL AND (c.session_date+c.close_time) AT TIME ZONE c.timezone<=${now.toISOString()}::timestamptz AND c.session_date=(SELECT max(session_date) FROM market.trading_calendar WHERE mic=c.mic AND is_open AND close_time IS NOT NULL AND (session_date+close_time) AT TIME ZONE timezone<=${now.toISOString()}::timestamptz) ORDER BY b.session_date DESC LIMIT 1`)).rows[0];
      if(!observation)continue;
      const asOf=z.coerce.date().parse(observation.as_of).toISOString(),delay=z.number().int().min(0).parse(observation.delay_minutes);
      const stale=Date.parse(asOf)>now.getTime() || (job.mode==="quote" && (now.getTime()-z.coerce.date().parse(observation.fetched_at).getTime()>420000 || now.getTime()-Date.parse(asOf)>(delay+7)*60000));
      const previous=row.last_state?stateSchema.parse(row.last_state):undefined;
      const result=evaluatePriceAlert({type:rule.type,threshold:String(rule.params.threshold),hysteresis:String(rule.hysteresis),cooldownMinutes:rule.cooldownMinutes,...(rule.type==="change_pct"?{direction:rule.params.direction}:{})},{price:String(observation.price),...(observation.prev_close?{previousClose:String(observation.prev_close)}:{}),asOf,sessionDate:String(observation.session_date),stale,blocked:false},previous);
      if(!result.state)continue;
      // lastTriggeredAt is also retained after a parameter edit resets the observation state.
      if(result.triggered && row.last_triggered_at && now.getTime()-z.coerce.date().parse(row.last_triggered_at).getTime()<rule.cooldownMinutes*60000)continue;
      await tx.execute(sql`UPDATE alerts.alert_rules SET last_state=${JSON.stringify(result.state)}::jsonb WHERE id=${dto.id}::uuid`);
      if(!result.triggered)continue;
      const triggeredAt=now.toISOString();
      const threshold=rule.type==="change_pct"&&rule.params.direction==="down"?toDecimal(String(rule.params.threshold)).negated().toFixed():String(rule.params.threshold);
      const message=alertMessage({ticker:String(market.ticker),instrumentId:rule.instrumentId,currency:market.currency,type:rule.type,value:result.value,threshold,dataSource:observation.source,dataAsOf:asOf,triggeredAt,delayMinutes:delay},origin,timezone);
      const event=(await tx.execute(sql`INSERT INTO alerts.alert_events(user_id,rule_id,triggered_at,value,threshold,data_as_of,data_source,payload)VALUES(${job.userId}::uuid,${dto.id}::uuid,${triggeredAt}::timestamptz,${result.value},${threshold},${asOf}::timestamptz,${observation.source},${JSON.stringify({message,channels:rule.channels,enqueued:false})}::jsonb)RETURNING id::text`)).rows[0]!;
      await tx.execute(sql`UPDATE alerts.alert_rules SET last_triggered_at=${triggeredAt}::timestamptz WHERE id=${dto.id}::uuid`);
      // event.id exists only after the transaction commits; publishing happens in flushAlertEvents.
      z.uuid().parse(event.id);
    }
  });
}
export async function flushAlertEvents(database:AppDatabase,userId:string,enqueue:(id:string,payload:unknown)=>Promise<void>,publish:(event:unknown)=>Promise<void>) {
  const context={userId:z.uuid().parse(userId),role:"user" as const};
  const rows=await database.transaction(context,async tx=>(await tx.execute(sql`SELECT id::text,rule_id::text,triggered_at,payload FROM alerts.alert_events WHERE coalesce((payload->>'enqueued')::boolean,false)=false ORDER BY triggered_at,id LIMIT 200`)).rows);
  for(const row of rows) {
    const payload=z.object({message:z.string(),channels:z.array(z.enum(["push","email"])),enqueued:z.boolean()}).strict().parse(row.payload),at=z.coerce.date().parse(row.triggered_at).toISOString();
    await enqueue(String(row.id),{v:1,userId,kind:"alert",sourceRef:`alert:${row.rule_id}:${row.id}`,channels:payload.channels,subject:alertMessages.subject,text:payload.message,occurredAt:at});
    await publish({event:"alerts.alert.triggered",data:{v:1,ruleId:row.rule_id,eventId:row.id,message:payload.message,triggeredAt:at}});
    await database.transaction(context,async tx=>{await tx.execute(sql`UPDATE alerts.alert_events SET payload=jsonb_set(payload,'{enqueued}','true') WHERE id=${row.id}::uuid`);});
  }
}
