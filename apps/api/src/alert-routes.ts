import {rateLimitedError,conflictError} from './rate-limited-response.js';
import {createRoute,type OpenAPIHono,z} from "@hono/zod-openapi";
import {type AppEnv,ProblemError} from "@oliginvest/platform";
import type {AuthRouteDependencies} from "./auth/routes.js";
import {AlertRepository,priceRuleInput,priceRulePatch,priceRuleSchema,priceRulePage,priceEventPage,marketError} from "./modules.js";
const json=(schema:z.ZodType)=>({description:"Alerty cenowe.",content:{"application/json":{schema}}});
const page={limit:z.coerce.number().int().min(1).max(200).default(50),cursor:z.string().max(512).optional()};
const rulesQuery=z.object({...page,instrumentId:z.uuid().optional(),enabled:z.enum(["true","false"]).transform(v=>v==="true").optional().openapi({type:"boolean"})}).strict();
const eventsQuery=z.object({...page,ruleId:z.uuid().optional(),from:z.iso.date().optional(),to:z.iso.date().optional()}).strict();
const idempotency=z.string().min(16).max(64).regex(/^[A-Za-z0-9_-]+$/);
export function mountAlerts(api:OpenAPIHono<AppEnv>,dependencies:AuthRouteDependencies) {
  for(const [method,path,operationId,schema] of [
    ["get","/alerts/rules","listAlertRules",priceRulePage],
    ["post","/alerts/rules","createAlertRule",priceRuleSchema],
    ["get","/alerts/rules/{ruleId}","getAlertRule",priceRuleSchema],
    ["patch","/alerts/rules/{ruleId}","updateAlertRule",priceRuleSchema],
    ["delete","/alerts/rules/{ruleId}","deleteAlertRule",null],
    ["get","/alerts/events","listAlertEvents",priceEventPage],
  ] as const) {
    api.openapi(createRoute({method,path,operationId,tags:["alerts"],security:[{sessionCookie:[]}],request:{
      ...(path.includes("{ruleId}")?{params:z.object({ruleId:z.uuid()}).strict()}:{}),
      ...(method==="post"?{headers:z.object({"Idempotency-Key":idempotency}),body:{required:true,content:{"application/json":{schema:priceRuleInput}}}}:{}),
      ...(method==="patch"?{body:{required:true,content:{"application/json":{schema:priceRulePatch}}}}:{}),
      ...(operationId==="listAlertRules"?{query:rulesQuery}:operationId==="listAlertEvents"?{query:eventsQuery}:{}),
    },responses:{401:marketError,404:marketError,...(method==="post"||method==="patch"?{422:marketError}:{}),...(method==="post"?{429:rateLimitedError,409:conflictError,201:json(schema!)}:method==="delete"?{204:{description:"Usunięto."}}:{200:json(schema!)})}}),async c=>{
      const service=await dependencies.service(),principal=await service.requireData(c.req.raw),context={userId:principal.user_id,role:principal.role};
      if(method!=="get")service.assertOrigin(c.req.raw);
      const repository=new AlertRepository(service.options.appDatabase),id=c.req.param("ruleId");
      if(method==="delete"){await repository.remove(context,id!);return c.body(null,204);}
      if(method==="post") {
        await service.options.state.limit(`alerts:create:${principal.user_id}`,30,60);
        const result=await repository.create(context,await c.req.json(),c.req.header("Idempotency-Key"));
        if(result.replayed)c.header("Idempotent-Replayed","true");return c.json(result.data,201);
      }
      const data=method==="patch"?await repository.patch(context,id!,await c.req.json()):id?await repository.get(context,id):operationId==="listAlertRules"?await repository.list(context,rulesQuery.parse(c.req.query())):await repository.events(context,eventsQuery.parse(c.req.query()));
      return c.json(data,200);
    },result=>{if(!result.success)throw new ProblemError("VALIDATION_FAILED");});
  }
}
