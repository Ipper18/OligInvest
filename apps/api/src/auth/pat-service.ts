import {createHash} from "node:crypto";
import type {DatabaseContext} from "@oliginvest/db";
import {alertMessages,formatMessage} from "@oliginvest/i18n";
import {ProblemError} from "@oliginvest/platform";
import {sql} from "drizzle-orm";
import {z} from "zod";
import {approximateIp} from "./client-ip.js";
import {createAuth} from "./config.js";
import {CURRENT_LEGAL_VERSION} from "./inputs.js";
import {patCreate,patMetadata,patSchema,patScope,type PatPrincipal} from "./pat-contracts.js";
import type {AuthService} from "./service.js";
import {findSession,readSignedCookie,requireMfa,requireStepUp,SESSION_COOKIE} from "./session.js";

const digest=(s:string)=>createHash("sha256").update(s).digest("base64url");
const at=(s:unknown)=>z.coerce.date().parse(s).toISOString();
const permissions=(scopes:string[])=>Object.fromEntries(scopes.map(s=>{const [resource,action]=s.split(":");return [resource,[action]];}));
function dto(row:Record<string,unknown>) {
  const p=z.record(z.string(),z.array(z.string())).parse(JSON.parse(String(row.permissions)));
  return patSchema.parse({id:row.id,name:row.name,start:row.start,scopes:Object.entries(p).flatMap(([resource,actions])=>actions.map(action=>`${resource}:${action}`)),createdAt:at(row.created_at),expiresAt:at(row.expires_at),...(row.last_request?{lastUsedAt:at(row.last_request)}:{})});
}
export class PatService {
  constructor(readonly service:AuthService){}
  async list(request:Request) {
    const user=await this.service.requireData(request);
    return this.service.options.database.transaction(async tx=>({data:(await tx.execute(sql`SELECT * FROM auth.api_keys WHERE reference_id=${user.user_id}::uuid AND enabled ORDER BY created_at DESC,id DESC`)).rows.map(dto)}));
  }
  async create(request:Request,input:unknown,key:string) {
    const data=patCreate.parse(input),keyHash=digest(key),requestHash=digest(JSON.stringify({...data,scopes:[...data.scopes].sort()}));
    this.service.assertOrigin(request);
    const initial=await this.service.requireData(request,true),context={userId:initial.user_id,role:initial.role};
    const limit=await this.service.options.appDatabase.transaction(context,async tx=>Number((await tx.execute(sql`SELECT limits->>'max_active_pats' AS n FROM platform.role_limits WHERE role=${initial.role}`)).rows[0]?.n??5));
    const result=await this.service.options.database.transaction(async tx=>{
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`pat:${initial.user_id}`},407))`);
      const principal=requireMfa(await findSession(tx,readSignedCookie(request,SESSION_COOKIE,this.service.options.configuration)));
      requireStepUp(principal);
      if(principal.user_id!==initial.user_id)throw new ProblemError("UNAUTHENTICATED");
      if((await this.service.legal(principal)).termsAcceptanceRequired)throw new ProblemError("TERMS_ACCEPTANCE_REQUIRED");
      const old=(await tx.execute(sql`SELECT metadata FROM auth.api_keys WHERE reference_id=${initial.user_id}::uuid AND (metadata::jsonb->'creation'->>'keyHash')=${keyHash} AND (metadata::jsonb->'creation'->>'expiresAt')::timestamptz>now() LIMIT 1`)).rows[0];
      if(old) {
        const metadata=patMetadata.parse(JSON.parse(String(old.metadata)));
        if(metadata.creation.requestHash!==requestHash)throw new ProblemError("IDEMPOTENCY_CONFLICT");
        return {...metadata.creation.receipt,tokenShown:false as const};
      }
      const count=Number((await tx.execute(sql`SELECT count(*)::int AS n FROM auth.api_keys WHERE reference_id=${initial.user_id}::uuid AND enabled AND expires_at>now()`)).rows[0]?.n);
      if(!Number.isSafeInteger(limit)||limit<1||count>=limit)throw new ProblemError("QUOTA_EXCEEDED");
      const raw=await createAuth(tx,this.service.options.configuration).api.createApiKey({body:{userId:initial.user_id,name:data.name,expiresIn:data.expiresInDays*86400,permissions:permissions(data.scopes) as Record<string,string[]>,rateLimitEnabled:false}});
      const created=z.object({id:z.uuid(),key:z.string().regex(/^oli_pat_[A-Za-z0-9]{64}$/)}).strict().parse({id:(raw as {id:unknown}).id,key:(raw as {key:unknown}).key});
      const row=(await tx.execute(sql`SELECT * FROM auth.api_keys WHERE id=${created.id}::uuid`)).rows[0]!;
      const receipt=dto(row),metadata=patMetadata.parse({creation:{keyHash,requestHash,expiresAt:new Date(Date.now()+86400_000).toISOString(),receipt},networks:[]});
      await tx.execute(sql`UPDATE auth.api_keys SET metadata=${JSON.stringify(metadata)} WHERE id=${created.id}::uuid`);
      await this.service.options.audit.record(context,{action:"pat.create",outcome:"success",resourceType:"api_key",resourceId:receipt.id,after:{expiresAt:receipt.expiresAt}});
      return {...receipt,tokenShown:true as const,token:created.key};
    });
    await this.scheduleExpiry(context,result);
    return result;
  }
  async scheduleExpiry(context:DatabaseContext,token:z.infer<typeof patSchema>) {
    if(!this.service.options.patMail)throw new Error("PAT_MAIL_NOT_CONFIGURED");
    await this.service.options.patMail(`pat-expiry-${token.id}`,{v:1,userId:context.userId,kind:"security",sourceRef:`pat-expiry:${token.id}`,channels:["email"],subject:alertMessages.patExpirySubject,text:formatMessage(alertMessages.patExpiryBody,{name:token.name,time:token.expiresAt,url:new URL("/ustawienia/tokeny",this.service.options.configuration.origin).href}),occurredAt:new Date().toISOString()},Math.max(0,Date.parse(token.expiresAt)-Date.now()-7*86400_000));
  }
  async revoke(request:Request,id:string) {
    const user=await this.service.requireData(request);this.service.assertOrigin(request);
    await this.service.options.database.transaction(async tx=>{
      const rows=(await tx.execute(sql`UPDATE auth.api_keys SET enabled=false,updated_at=now() WHERE id=${id}::uuid AND reference_id=${user.user_id}::uuid AND enabled RETURNING id`)).rows;
      if(!rows.length)throw new ProblemError("NOT_FOUND");
      await this.service.options.audit.record({userId:user.user_id,role:user.role},{action:"pat.revoke",outcome:"success",resourceType:"api_key",resourceId:id});
    });
    await this.service.options.cancelPatMail?.(`pat-expiry-${id}`);
  }
  async authorize(request:Request,scope:z.infer<typeof patScope>,ip:string):Promise<PatPrincipal> {
    const url=new URL(request.url),token=/^Bearer (oli_pat_[A-Za-z0-9]{64})$/.exec(request.headers.get("authorization")??"")?.[1];
    if(!url.pathname.startsWith("/api/v1/quick/")||!token||request.headers.has("cookie")||url.searchParams.has("token"))throw new ProblemError("UNAUTHENTICATED");
    const keyHash=digest(token);
    const result=await this.service.options.database.transaction(async tx=>{
      const row=(await tx.execute(sql`SELECT k.*,u.role,u.email_verified,u.two_factor_enabled,u.banned FROM auth.api_keys k JOIN auth.users u ON u.id=k.reference_id WHERE k.key=${keyHash} AND k.enabled AND k.expires_at>now() FOR UPDATE OF k`)).rows[0];
      if(!row||row.banned||!row.email_verified||!row.two_factor_enabled)throw new ProblemError("UNAUTHENTICATED");
      const publicToken=dto(row),role=z.enum(["user","pro","admin"]).parse(row.role),userId=z.uuid().parse(row.reference_id);
      const accepted=await this.service.options.appDatabase.transaction({userId,role},async appTx=>(await appTx.execute(sql`SELECT version FROM identity.consent_events WHERE document='terms' AND action='accepted' ORDER BY recorded_at DESC,id DESC LIMIT 1`)).rows[0]?.version===CURRENT_LEGAL_VERSION);
      if(!accepted)throw new ProblemError("TERMS_ACCEPTANCE_REQUIRED");
      await this.service.options.state.limit(`pat:${userId}:${publicToken.id}`,30,60);
      await this.service.options.state.limit(`pat:${userId}:${publicToken.id}`,2000,86400);
      if(!publicToken.scopes.includes(scope))throw new ProblemError("PAT_SCOPE_MISSING");
      const verified=await createAuth(tx,this.service.options.configuration).api.verifyApiKey({body:{key:token}});
      if((verified as {valid?:unknown}).valid!==true)throw new ProblemError("UNAUTHENTICATED");
      const metadata=patMetadata.parse(JSON.parse(String(row.metadata))),network=approximateIp(ip);
      const newNetwork=network!=="unknown"&&!metadata.networks.includes(network);
      if(newNetwork){metadata.networks.push(network);await tx.execute(sql`UPDATE auth.api_keys SET metadata=${JSON.stringify(metadata)},last_request=now() WHERE id=${publicToken.id}::uuid`);}
      return {userId,role,tokenId:publicToken.id,scopes:publicToken.scopes,newNetwork,network,name:publicToken.name};
    });
    if(result.newNetwork) {
      if(!this.service.options.patMail)throw new Error("PAT_MAIL_NOT_CONFIGURED");
      await this.service.options.patMail(`pat-network-${result.tokenId}-${digest(result.network)}`,{v:1,userId:result.userId,kind:"security",sourceRef:`pat-network:${result.tokenId}:${digest(result.network).replaceAll("_","-")}`,channels:["email"],subject:alertMessages.patNetworkSubject,text:formatMessage(alertMessages.patNetworkBody,{name:result.name,time:new Date().toISOString(),network:result.network,url:new URL("/ustawienia/tokeny",this.service.options.configuration.origin).href}),occurredAt:new Date().toISOString()},0);
    }
    return {userId:result.userId,role:result.role,tokenId:result.tokenId,scopes:result.scopes};
  }
}
