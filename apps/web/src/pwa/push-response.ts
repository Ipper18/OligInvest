import * as z from "zod/mini";

export const pushResponseSchema = z.strictObject({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  failureCount: z.int().check(z.gte(0)),
  deviceLabel: z.optional(z.string()),
  userAgent: z.optional(z.string()),
  lastSuccessAt: z.optional(z.iso.datetime()),
});
