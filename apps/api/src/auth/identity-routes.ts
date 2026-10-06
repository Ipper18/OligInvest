import { createHash } from "node:crypto";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { type AppEnv, ProblemError, permissionsForRole } from "@oliginvest/platform";
import { sql } from "drizzle-orm";
import { bodyLimit } from "hono/body-limit";
import type { Administration } from "./administration.js";
import { inviteInput, previewInput } from "./inputs.js";
import { type AuthRouteDependencies, authErrors } from "./routes.js";

const timestamp = z.string().datetime();
const idempotencyKey = z
  .string()
  .min(16)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/u)
  .openapi({ pattern: "^[A-Za-z0-9_-]+$" });
export const preferencesSchema = z
  .object({
    baseCurrency: z.enum(["PLN"]),
    costBasisMethod: z.enum(["fifo", "average"]),
    plView: z.enum(["economic", "tax"]),
    taxDateBasis: z.enum(["settlement", "trade"]),
    taxIncludeFxFee: z.boolean(),
    timezone: z.string(),
    locale: z.enum(["pl-PL", "en-US"]),
    theme: z.enum(["system", "light", "dark"]),
    plPalette: z.enum(["default", "colorblind"]),
  })
  .strict()
  .openapi("Preferences");
export const meSchema = z
  .object({
    id: z.uuid(),
    email: z.email(),
    name: z.string(),
    emailVerified: z.boolean().optional(),
    role: z.enum(["user", "pro", "admin"]),
    mfa: z
      .object({
        enrolled: z.boolean(),
        sessionVerifiedAt: timestamp.optional(),
        stepUpValidUntil: timestamp.optional(),
      })
      .strict(),
    legal: z
      .object({ termsAcceptanceRequired: z.boolean(), diagnosticsConsent: z.boolean() })
      .strict(),
    permissions: z.array(z.string()),
    features: z.record(z.string(), z.boolean()),
    preferences: preferencesSchema,
    deletionScheduledFor: timestamp.optional(),
  })
  .strict()
  .openapi("Me");
const previewSchema = z
  .object({ emailMasked: z.string(), role: z.enum(["user", "pro", "admin"]), expiresAt: timestamp })
  .strict()
  .openapi("InvitationPreview");
const createdSchema = z
  .object({
    id: z.uuid(),
    email: z.email(),
    role: z.enum(["user", "pro", "admin"]),
    invitedBy: z.uuid(),
    status: z.enum(["pending", "used", "expired", "revoked"]),
    expiresAt: timestamp,
    usedAt: timestamp.optional(),
    revokedAt: timestamp.optional(),
    createdAt: timestamp,
    inviteUrl: z.url(),
  })
  .strict()
  .openapi("AdminInvitationCreated");
export type IdentityDependencies = AuthRouteDependencies & {
  administration: () => Administration | Promise<Administration>;
};
export function mountIdentity(api: OpenAPIHono<AppEnv>, dependencies: IdentityDependencies) {
  api.use(
    "/invitations/preview",
    bodyLimit({
      maxSize: 16_384,
      onError: () => {
        throw new ProblemError("BAD_REQUEST");
      },
    }),
  );
  api.openapi(
    createRoute({
      method: "post",
      path: "/invitations/preview",
      operationId: "previewInvitation",
      tags: ["identity"],
      security: [],
      request: {
        body: { required: true, content: { "application/json": { schema: previewInput } } },
      },
      responses: {
        ...authErrors,
        404: authErrors[400]!,
        200: {
          description: "Zaproszenie ważne.",
          headers: { "Cache-Control": { schema: { type: "string" } } },
          content: { "application/json": { schema: previewSchema } },
        },
      },
    }),
    async (context) => {
      const service = await dependencies.service();
      if (context.req.header("authorization")) throw new ProblemError("FORBIDDEN");
      service.assertOrigin(context.req.raw);
      await service.options.state.limit(
        `invitation-preview:${dependencies.clientIp(context)}`,
        10,
        60,
      );
      const token = context.req.valid("json").token;
      const row = await service.options.database.transaction(
        async (tx) =>
          (
            await tx.execute(
              sql`SELECT email,role,expires_at FROM identity.find_invitation(${createHash("sha256").update(token).digest("hex")})`,
            )
          ).rows[0],
      );
      if (!row) throw new ProblemError("NOT_FOUND");
      const data = z
        .object({
          email: z.email(),
          role: z.enum(["user", "pro", "admin"]),
          expires_at: z.coerce.date(),
        })
        .strict()
        .parse(row);
      const [local, domain] = data.email.split("@");
      const suffix = domain?.slice(domain.lastIndexOf(".")) ?? "";
      return context.json(
        previewSchema.parse({
          emailMasked: `${local?.slice(0, 1)}***@${domain?.slice(0, 1)}***${suffix}`,
          role: data.role,
          expiresAt: data.expires_at.toISOString(),
        }),
        200,
      );
    },
  );
  api.openapi(
    createRoute({
      method: "get",
      path: "/me",
      operationId: "getMe",
      tags: ["identity"],
      security: [{ sessionCookie: [] }],
      responses: {
        ...authErrors,
        200: {
          description: "Bieżący użytkownik.",
          content: { "application/json": { schema: meSchema } },
        },
      },
    }),
    async (context) => {
      const service = await dependencies.service();
      if (context.req.header("authorization")) throw new ProblemError("FORBIDDEN");
      const principal = await service.principal(context.req.raw);
      if (!principal) throw new ProblemError("UNAUTHENTICATED");
      const subject = { userId: principal.user_id, role: principal.role };
      const preferences = await service.options.appDatabase.transaction(
        subject,
        async (tx) =>
          (
            await tx.execute(
              sql`SELECT base_currency AS "baseCurrency",cost_basis_method AS "costBasisMethod",pl_view AS "plView",tax_date_basis AS "taxDateBasis",tax_include_fx_fee AS "taxIncludeFxFee",timezone,locale,theme,pl_palette AS "plPalette" FROM identity.user_preferences`,
            )
          ).rows[0],
      );
      const verified = principal.mfa_verified_at;
      const validUntil = verified ? new Date(verified.getTime() + 900_000) : undefined;
      return context.json(
        meSchema.parse({
          id: principal.user_id,
          email: principal.email,
          name: principal.name,
          emailVerified: principal.email_verified,
          role: principal.role,
          mfa: {
            enrolled: principal.two_factor_enabled,
            ...(verified ? { sessionVerifiedAt: verified.toISOString() } : {}),
            ...(principal.mfa_method === "totp" && validUntil && validUntil.getTime() > Date.now()
              ? { stepUpValidUntil: validUntil.toISOString() }
              : {}),
          },
          legal: await service.legal(principal),
          permissions: permissionsForRole(principal.role),
          features: await service.features.effective(subject),
          preferences: preferences ?? {
            baseCurrency: "PLN",
            costBasisMethod: "fifo",
            plView: "economic",
            taxDateBasis: "settlement",
            taxIncludeFxFee: false,
            timezone: "Europe/Warsaw",
            locale: "pl-PL",
            theme: "system",
            plPalette: "default",
          },
        }),
        200,
      );
    },
  );
  api.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      path: "/admin/invitations",
      operationId: "adminCreateInvitation",
      tags: ["admin"],
      security: [{ sessionCookie: [] }],
      request: {
        headers: z.object({ "Idempotency-Key": idempotencyKey.optional() }).strict(),
        body: { required: true, content: { "application/json": { schema: inviteInput } } },
      },
      responses: {
        ...authErrors,
        409: {
          ...authErrors[400],
          description: "Konflikt żądania.",
          headers: {
            ...authErrors[400]?.headers,
            "Retry-After": { schema: { type: "integer", minimum: 1 } },
          },
        },
        201: {
          description: "Wystawiono zaproszenie.",
          headers: {
            "Cache-Control": { schema: { type: "string" } },
            "Idempotent-Replayed": { schema: { type: "string", enum: ["true"] } },
          },
          content: { "application/json": { schema: createdSchema } },
        },
      },
    }),
  );
  api.post("/admin/invitations", async (context) => {
    const admin = await dependencies.administration();
    const result = await admin.http(
      context.req.raw,
      "admin.invitation.create",
      async (actor, tx) => {
        let input: unknown;
        try {
          // Bound streamed/chunked bodies inside the audit boundary as well.
          const reader = context.req.raw.body?.getReader();
          const chunks: Uint8Array[] = [];
          let size = 0;
          if (reader) {
            try {
              for (;;) {
                const chunk = await reader.read();
                if (chunk.done) break;
                size += chunk.value.byteLength;
                if (size > 16_384) {
                  await reader.cancel();
                  throw new Error("BODY_TOO_LARGE");
                }
                chunks.push(chunk.value);
              }
            } finally {
              reader.releaseLock();
            }
          }
          input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          throw new ProblemError("BAD_REQUEST");
        }
        if (!inviteInput.safeParse(input).success) throw new ProblemError("VALIDATION_FAILED");
        const key = context.req.header("Idempotency-Key");
        if (key !== undefined && !idempotencyKey.safeParse(key).success)
          throw new ProblemError("BAD_REQUEST");
        return admin.createInvitation(actor, tx, input, key);
      },
      { requestId: context.get("requestContext").requestId, ip: dependencies.clientIp(context) },
      (result) => ({
        resourceType: "invitation",
        resourceId: result.value.id,
        before: null,
        after: {
          email: result.value.email,
          role: result.value.role,
          status: result.value.status,
          expiresAt: result.value.expiresAt,
        },
      }),
    );
    if (result.mail) {
      try {
        await admin.effects.inviteMail(result.mail);
      } catch {
        admin.service.options.event("auth.invitation_delivery_failed");
      }
    }
    if (result.replayed) context.header("Idempotent-Replayed", "true");
    return context.json(createdSchema.parse(result.value), 201);
  });
}
