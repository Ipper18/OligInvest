import {persistentEventSchema} from "@oliginvest/contracts";
import type {AppDatabase} from "@oliginvest/db";
import type {FeatureFlags,PlatformLogger} from "@oliginvest/platform";
import {type Queue,Worker} from "bullmq";
import {sql} from "drizzle-orm";
import type {Redis} from "ioredis";
import {z} from "zod";
import {evaluateAlerts,flushAlertEvents} from "./modules.js";
import type {readRuntime} from "./runtime.js";
export async function startAlertsWorker(options:{database:AppDatabase;flags:FeatureFlags;cache:Redis;queues:Queue[];connection:ReturnType<typeof readRuntime>["connection"];logger:PlatformLogger;origin:string;observe?:(worker:Worker)=>void}) {
  const queue=options.queues.find(q=>q.name==="alerts")!,notify=options.queues.find(q=>q.name==="notify")!;
  const users=()=>options.database.transaction({userId:null,role:"system"},async tx=>(await tx.execute(sql`SELECT id::text,role FROM identity.user_directory WHERE NOT banned`)).rows);
  const enabled=async(userId:string,role:"user"|"pro"|"admin")=>options.flags.enabled("module.alerts",{userId,role});
  const enqueueAll=async(mode:"quote"|"eod")=>{
    for(const user of await users()) {
      const userId=z.uuid().parse(user.id),role=z.enum(["user","pro","admin"]).parse(user.role);
      if(await enabled(userId,role))await queue.add("alerts.evaluate",{v:1,userId,mode},{deduplication:{id:`${userId}-${mode}`},removeOnComplete:true,removeOnFail:{age:86400},attempts:3,backoff:{type:"exponential",delay:1000}});
    }
  };
  const {commandTimeout:_deadline,...connection}=options.connection;
  const worker=new Worker("alerts",async job=>{
    if(job.name==="alerts.recover") {z.object({}).strict().parse(job.data);await enqueueAll("quote");await enqueueAll("eod");return;}
    const input=z.object({v:z.literal(1),userId:z.uuid(),mode:z.enum(["quote","eod"])}).strict().parse(job.data);
    const user=(await users()).find(u=>u.id===input.userId);
    if(!user||!await enabled(input.userId,z.enum(["user","pro","admin"]).parse(user.role)))return;
    await evaluateAlerts(options.database,input,options.origin);
    await flushAlertEvents(options.database,input.userId,async(id,payload)=>{
      await notify.add("notifications.deliver",payload,{jobId:`alert-${input.userId}-${id}`,removeOnComplete:{age:86400},removeOnFail:{age:604800},attempts:3,backoff:{type:"exponential",delay:1000}});
    },async raw=>{
      const event=persistentEventSchema.parse(raw),key=`sse:${input.userId}`;
      await options.cache.xadd(key,"MAXLEN","~",500,"*","event",event.event,"data",JSON.stringify(event.data));
      await options.cache.expire(key,600);
    });
  },{connection:{...connection,maxRetriesPerRequest:null},concurrency:2});
  worker.on("error",()=>options.logger.warn({event:"alerts.worker_unavailable"}));
  options.observe?.(worker);
  await queue.upsertJobScheduler("alerts.recover",{every:60000},{name:"alerts.recover",data:{},opts:{removeOnComplete:true,removeOnFail:{age:86400}}});
  await worker.waitUntilReady();
  return {enqueueAll,close:()=>worker.close(),observed:async()=>{
    const ids=new Set<string>();
    for(const user of await users()) {
      const userId=z.uuid().parse(user.id);
      if(!await enabled(userId,z.enum(["user","pro","admin"]).parse(user.role)))continue;
      const rows=await options.database.transaction({userId,role:"user"},async tx=>(await tx.execute(sql`SELECT instrument_id::text FROM alerts.alert_rules WHERE enabled AND instrument_id IS NOT NULL`)).rows);
      for(const row of rows)ids.add(String(row.instrument_id));
    }
    return [...ids];
  }};
}
