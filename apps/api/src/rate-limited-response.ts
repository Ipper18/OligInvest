import {marketError} from './modules.js';
export const conflictError={...marketError,headers:{...marketError.headers,'Retry-After':{schema:{type:'integer' as const,minimum:1}}}};
export const rateLimitedError={...marketError,headers:{...marketError.headers,'Retry-After':{schema:{type:'integer' as const,minimum:1}},RateLimit:{schema:{type:'string' as const}},'RateLimit-Policy':{schema:{type:'string' as const}}}};
