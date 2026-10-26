import {createHash} from "node:crypto";
import {toDecimal} from "@oliginvest/core";
import type {AppDatabase,DatabaseContext,DatabaseTransaction} from "@oliginvest/db";
import {ProblemError} from "@oliginvest/platform";
import {sql} from "drizzle-orm";
import {z} from "zod";
import {eventPage,priceRuleInput,rulePatch,ruleSchema,rulePage} from "../contracts.js";
const instant=(v:unknown)=>z.coerce.date().parse(v).toISOString();
export function ruleDto(row:Record<string,unknown>) {
  return ruleSchema.parse({id:row.id,type:row.type,instrumentId:row.instrument_id,params:row.params,channels:row.channels,cooldownMinutes:row.cooldown_minutes,hysteresis:toDecimal(String(row.hysteresis_pct)).div(100).toNumber(),enabled:row.enabled,createdAt:instant(row.created_at),updatedAt:instant(row.updated_at),...(row.last_triggered_at?{lastTriggeredAt:instant(row.last_triggered_at)}:{})});
}
const live=sql`coalesce(last_state->>'deleted','false')<>'true'`;
export class AlertRepository {
  constructor(readonly database:AppDatabase) {}
  async get(context:DatabaseContext,id:string) {return this.database.transaction(context,async tx=>ruleDto(await this.row(tx,id)));}
  async row(tx:DatabaseTransaction,id:string) {
    const row=(await tx.execute(sql`SELECT * FROM alerts.alert_rules WHERE id=${id}::uuid AND ${live} FOR UPDATE`)).rows[0];
    if(!row)throw new ProblemError("NOT_FOUND");return row;
  }
  create(context:DatabaseContext,input:unknown,key?:string) {
    const value=priceRuleInput.parse(input),hash=createHash("sha256").update(JSON.stringify(value)).digest("hex");
    return this.database.transaction(context,async tx=>{
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`alert-create:${context.userId}`},404))`);
      if(key) {
        await tx.execute(sql`DELETE FROM platform.idempotency_keys WHERE key=${key} AND expires_at<=now()`);
        const old=(await tx.execute(sql`SELECT path,request_hash,response_body FROM platform.idempotency_keys WHERE key=${key}`)).rows[0];
        if(old) {if(old.path!=="/alerts/rules"||old.request_hash!==hash)throw new ProblemError("IDEMPOTENCY_CONFLICT");return {data:ruleSchema.parse(old.response_body),replayed:true};}
      }
      if(!(await tx.execute(sql`SELECT id FROM market.instruments WHERE id=${value.instrumentId}::uuid AND is_active`)).rows.length)throw new ProblemError("NOT_FOUND");
      const row=(await tx.execute(sql`INSERT INTO alerts.alert_rules(user_id,type,instrument_id,params,channels,cooldown_minutes,hysteresis_pct,enabled) VALUES(${context.userId}::uuid,${value.type},${value.instrumentId}::uuid,${JSON.stringify(value.params)}::jsonb,${sql.param(value.channels)}::text[],${value.cooldownMinutes},${toDecimal(String(value.hysteresis)).mul(100).toFixed()},${value.enabled}) RETURNING *`)).rows[0]!;
      const data=ruleDto(row);
      if(key)await tx.execute(sql`INSERT INTO platform.idempotency_keys(user_id,key,method,path,request_hash,status_code,response_body,expires_at)VALUES(${context.userId}::uuid,${key},'POST','/alerts/rules',${hash},201,${JSON.stringify(data)}::jsonb,now()+interval '24 hours')`);
      return {data,replayed:false};
    });
  }
  patch(context:DatabaseContext,id:string,input:unknown) {
    const patch=rulePatch.parse(input);
    return this.database.transaction(context,async tx=>{
      const old=await this.row(tx,id),current=ruleDto(old),value=priceRuleInput.parse({type:current.type,instrumentId:current.instrumentId,params:patch.params??current.params,channels:patch.channels??current.channels,cooldownMinutes:patch.cooldownMinutes??current.cooldownMinutes,hysteresis:patch.hysteresis??current.hysteresis,enabled:patch.enabled??current.enabled});
      const row=(await tx.execute(sql`UPDATE alerts.alert_rules SET params=${JSON.stringify(value.params)}::jsonb,channels=${sql.param(value.channels)}::text[],cooldown_minutes=${value.cooldownMinutes},hysteresis_pct=${toDecimal(String(value.hysteresis)).mul(100).toFixed()},enabled=${value.enabled},last_state=${patch.params?null:old.last_state===null?null:JSON.stringify(old.last_state)}::jsonb,updated_at=now() WHERE id=${id}::uuid RETURNING *`)).rows[0]!;
      return ruleDto(row);
    });
  }
  remove(context:DatabaseContext,id:string) {return this.database.transaction(context,async tx=>{
    await this.row(tx,id);
    // Retain the FK parent and events, as required by DELETE /alerts/rules.
    await tx.execute(sql`UPDATE alerts.alert_rules SET enabled=false,last_state=coalesce(last_state,'{}'::jsonb)||'{"deleted":true}'::jsonb,updated_at=now() WHERE id=${id}::uuid`);
  });}
  list(context:DatabaseContext,query:{limit:number;cursor?:string|undefined;instrumentId?:string|undefined;enabled?:boolean|undefined}) {
    const cursor=this.cursor(query);
    return this.database.transaction(context,async tx=>{
      const rows=(await tx.execute(sql`SELECT * FROM alerts.alert_rules WHERE ${live} AND ${query.instrumentId?sql`instrument_id=${query.instrumentId}::uuid`:sql`true`} AND ${query.enabled===undefined?sql`true`:sql`enabled=${query.enabled}`} AND ${cursor?sql`(created_at,id)<(${cursor.at}::timestamptz,${cursor.id}::uuid)`:sql`true`} ORDER BY created_at DESC,id DESC LIMIT ${query.limit+1}`)).rows;
      return rulePage.parse({data:rows.slice(0,query.limit).map(ruleDto),page:this.page(rows,query,"created_at")});
    });
  }
  events(context:DatabaseContext,query:{limit:number;cursor?:string|undefined;ruleId?:string|undefined;from?:string|undefined;to?:string|undefined}) {
    const cursor=this.cursor(query);
    return this.database.transaction(context,async tx=>{
      const rows=(await tx.execute(sql`SELECT e.*,r.type FROM alerts.alert_events e JOIN alerts.alert_rules r ON r.id=e.rule_id WHERE ${query.ruleId?sql`rule_id=${query.ruleId}::uuid`:sql`true`} AND ${query.from?sql`triggered_at>=(${query.from}::date::timestamp AT TIME ZONE 'Europe/Warsaw')`:sql`true`} AND ${query.to?sql`triggered_at<((${query.to}::date+1)::timestamp AT TIME ZONE 'Europe/Warsaw')`:sql`true`} AND ${cursor?sql`(triggered_at,e.id)<(${cursor.at}::timestamptz,${cursor.id}::uuid)`:sql`true`} ORDER BY triggered_at DESC,e.id DESC LIMIT ${query.limit+1}`)).rows;
      const data=[];
      for(const row of rows.slice(0,query.limit)){
        const payload=z.object({message:z.string(),channels:z.array(z.enum(["push","email"])),enqueued:z.boolean()}).strict().parse(row.payload);
        const deliveries=(await tx.execute(sql`SELECT channel,status,sent_at FROM notifications.notification_deliveries WHERE source_ref=${`alert:${row.rule_id}:${row.id}`}`)).rows.map(d=>({channel:d.channel,status:d.status,...(d.sent_at?{sentAt:instant(d.sent_at)}:{})}));
        data.push({id:row.id,ruleId:row.rule_id,ruleType:row.type,triggeredAt:instant(row.triggered_at),value:String(row.value),threshold:String(row.threshold),message:payload.message,dataAsOf:instant(row.data_as_of),dataSource:row.data_source,deliveries});
      }
      return eventPage.parse({data,page:this.page(rows,query,"triggered_at")});
    });
  }
  cursor(query:Record<string,unknown>) {
    if(!query.cursor)return undefined;
    try {
      const value=z.object({at:z.iso.datetime(),id:z.uuid(),filter:z.string()}).strict().parse(JSON.parse(Buffer.from(String(query.cursor),"base64url").toString()));
      if(value.filter!==this.filter(query))throw new Error("filter");return value;
    }catch{throw new ProblemError("VALIDATION_FAILED");}
  }
  filter(query:Record<string,unknown>) {return createHash("sha256").update(JSON.stringify({...query,cursor:undefined})).digest("hex");}
  page(rows:Record<string,unknown>[],query:Record<string,unknown>&{limit:number},column:string) {
    const hasMore=rows.length>query.limit,last=rows[query.limit-1];
    return {hasMore,...(hasMore&&last?{nextCursor:Buffer.from(JSON.stringify({at:instant(last[column]),id:last.id,filter:this.filter(query)})).toString("base64url")}: {})};
  }
}
