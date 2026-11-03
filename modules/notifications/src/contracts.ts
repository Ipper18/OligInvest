import { z } from "@hono/zod-openapi";
export const object = <T extends z.ZodRawShape>(shape: T) =>
  z.object(shape).strict().openapi({ additionalProperties: true });
export const channelSchema = z.enum(["push", "email"]).openapi("NotificationChannel");
export const statusSchema = z.enum(["queued", "sent", "failed", "skipped"]);
export const preferencesSchema = object({
  channels: object({ push: z.boolean(), email: z.boolean() }),
  quietHours: z
    .union([
      object({
        start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      }),
      z.null(),
    ])
    .openapi({}, { unionPreferredType: "oneOf" })
    .optional(),
  emailFallback: z.boolean(),
}).openapi("NotificationPreferences");
export const deliverySchema = object({
  id: z.uuid(),
  kind: z.enum(["alert", "system", "export", "invitation", "security"]),
  channel: channelSchema,
  status: statusSchema,
  error: z.string().optional(),
  sourceRef: z.string().optional(),
  createdAt: z.iso.datetime(),
  sentAt: z.iso.datetime().optional(),
}).openapi("NotificationDelivery");
export const pageInfo = object({
  nextCursor: z.string().max(512).optional(),
  hasMore: z.boolean(),
}).openapi("PageInfo");
export const deliveryPageSchema = object({ data: z.array(deliverySchema), page: pageInfo }).openapi(
  "NotificationDeliveryPage",
);
export type NotificationPreferences = z.infer<typeof preferencesSchema>;

export const pushCreateSchema = object({
  endpoint: z
    .url()
    .regex(/^https:\/\//)
    .max(1024)
    .openapi({ format: "uri", pattern: "^https://" }),
  expirationTime: z.number().nullable().optional(),
  keys: object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
  deviceLabel: z.string().max(60).optional(),
}).openapi("PushSubscriptionCreate");
export const pushSubscriptionSchema = object({
  id: z.uuid(),
  deviceLabel: z.string().optional(),
  userAgent: z.string().optional(),
  createdAt: z.iso.datetime(),
  lastSuccessAt: z.iso.datetime().optional(),
  failureCount: z.number().int().min(0),
}).openapi("PushSubscription");
export const pushConfigurationSchema = object({ publicKey: z.string().nullable() });
export const pushListSchema = object({ data: z.array(pushSubscriptionSchema) });
