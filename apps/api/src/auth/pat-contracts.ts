import {z} from "@hono/zod-openapi";
const object=<T extends z.ZodRawShape>(shape:T)=>z.object(shape).strict().openapi({additionalProperties:true});
export const patScope=z.enum(["portfolio:read","transactions:write","alerts:read","market:read"]).openapi("PatScope");
export const patCreate=object({name:z.string().min(1).max(60),scopes:z.array(patScope).min(1).refine(s=>new Set(s).size===s.length).openapi({uniqueItems:true}),expiresInDays:z.number().int().min(1).max(365).default(90)}).openapi("PersonalAccessTokenCreate");
export const patSchema=object({id:z.uuid(),name:z.string(),start:z.string(),scopes:z.array(patScope),createdAt:z.iso.datetime(),expiresAt:z.iso.datetime(),lastUsedAt:z.iso.datetime().optional()}).openapi("PersonalAccessToken");
export const patCreated=z.intersection(patSchema,object({tokenShown:z.boolean(),token:z.string().optional()})).openapi("PersonalAccessTokenCreated");
export type PatPrincipal={userId:string;role:"user"|"pro"|"admin";tokenId:string;scopes:z.infer<typeof patScope>[]};
export const patMetadata=z.object({
  creation:z.object({keyHash:z.string(),requestHash:z.string(),expiresAt:z.iso.datetime(),receipt:patSchema}).strict(),
  networks:z.array(z.string()),
}).strict();
