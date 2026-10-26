import {z} from "@hono/zod-openapi";
import {summarySchema} from "@oliginvest/mod-market/contracts";
export const object=<T extends z.ZodRawShape>(shape:T)=>z.object(shape).strict().openapi({additionalProperties:true});
export const decimal=z.string().regex(/^-?\d{1,12}(\.\d{1,8})?$/);
export const channels=z.array(z.enum(["push","email"])).min(1).refine(v=>new Set(v).size===v.length).openapi({uniqueItems:true});
const settings={channels:channels.default(["push","email"]),cooldownMinutes:z.number().int().min(5).max(10080).default(1440),hysteresis:z.number().min(0).max(0.1).default(0.005),enabled:z.boolean().default(true)};
export const priceParams=object({threshold:decimal.refine(v=>Number(v)>0),basis:z.enum(["last","close"]).default("last")});
export const changeParams=object({threshold:z.number().gt(0).max(1),direction:z.enum(["up","down","both"]).default("both")});
export const priceRuleInput=z.discriminatedUnion("type",[
  object({...settings,type:z.literal("price_above"),instrumentId:z.uuid(),params:priceParams}),
  object({...settings,type:z.literal("price_below"),instrumentId:z.uuid(),params:priceParams}),
  object({...settings,type:z.literal("change_pct"),instrumentId:z.uuid(),params:changeParams}),
]).openapi("PriceAlertRuleInput");
export type PriceRuleInput=z.infer<typeof priceRuleInput>;
export const rulePatch=object({channels:channels.optional(),cooldownMinutes:settings.cooldownMinutes.unwrap().optional(),hysteresis:settings.hysteresis.unwrap().optional(),enabled:z.boolean().optional(),params:z.record(z.string(),z.unknown()).optional()}).refine(v=>Object.keys(v).length>0).openapi("PriceAlertRulePatch",{minProperties:1});
export const ruleSchema=object({id:z.uuid(),type:z.enum(["price_above","price_below","change_pct"]),instrumentId:z.uuid(),params:z.union([priceParams,changeParams]),channels,cooldownMinutes:z.number().int().min(5).max(10080),hysteresis:z.number().min(0).max(0.1),enabled:z.boolean(),createdAt:z.iso.datetime(),updatedAt:z.iso.datetime(),lastTriggeredAt:z.iso.datetime().optional()}).openapi("PriceAlertRule");
export const pageInfo=object({nextCursor:z.string().max(512).optional(),hasMore:z.boolean()}).openapi("PageInfo");
export const rulePage=object({data:z.array(ruleSchema),page:pageInfo}).openapi("PriceAlertRulePage");
export const sources=z.enum(["gpw","gpw_manual","yahoo","stooq_manual","nbp","ecb","finnhub","twelvedata","alphavantage","fred","gdelt","marketaux","broker_import","computed","demo","mixed"]);
export const eventSchema=object({id:z.uuid(),ruleId:z.uuid(),ruleType:z.enum(["price_above","price_below","change_pct"]),triggeredAt:z.iso.datetime(),value:decimal,threshold:decimal,message:z.string(),dataAsOf:z.iso.datetime(),dataSource:sources,instrument:summarySchema.optional(),deliveries:z.array(object({channel:z.enum(["push","email"]),status:z.enum(["queued","sent","failed","skipped"]),sentAt:z.iso.datetime().optional()}))}).openapi("PriceAlertEvent");
export const eventPage=object({data:z.array(eventSchema),page:pageInfo}).openapi("PriceAlertEventPage");
export const alertJob=z.object({v:z.literal(1),userId:z.uuid(),mode:z.enum(["quote","eod"])}).strict();
export const stateSchema=z.object({armed:z.boolean(),asOf:z.iso.datetime(),sessionDate:z.iso.date(),lastTriggeredAt:z.iso.datetime().optional()}).strict();
