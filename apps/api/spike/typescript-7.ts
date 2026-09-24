import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { BetterAuthOptions, betterAuth } from "better-auth";

const responseSchema = z.object({ status: z.literal("ok") }).strict();
const route = createRoute({
  method: "get",
  path: "/spike",
  responses: {
    200: {
      description: "Odpowiedź wyłącznie do testu zgodności typów",
      content: { "application/json": { schema: responseSchema } },
    },
  },
});

// This application is only imported by the spike test; it never listens on a port.
export const spikeApp = new OpenAPIHono().openapi(route, (context) =>
  context.json({ status: "ok" }, 200),
);

export const authOptions = {
  emailAndPassword: { enabled: true },
  advanced: { disableCSRFCheck: false },
} satisfies BetterAuthOptions;

export type SpikeSession = ReturnType<typeof betterAuth>["$Infer"]["Session"];

export function sessionUserId(session: SpikeSession): string {
  return session.user.id;
}
