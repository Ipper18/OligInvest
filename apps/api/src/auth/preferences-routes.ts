import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { type AppEnv, ProblemError } from "@oliginvest/platform";
import { sql } from "drizzle-orm";
import { bodyLimit } from "hono/body-limit";
import { marketError } from "../modules.js";
import { preferencesSchema } from "./identity-routes.js";
import { CURRENT_LEGAL_VERSION, legalVersion } from "./inputs.js";
import type { AuthRouteDependencies } from "./routes.js";
import { requireMfa } from "./session.js";

export const defaultPreferences = {
  baseCurrency: "PLN",
  costBasisMethod: "fifo",
  plView: "economic",
  taxDateBasis: "settlement",
  taxIncludeFxFee: false,
  timezone: "Europe/Warsaw",
  locale: "pl-PL",
  theme: "dark",
  plPalette: "default",
} as const;
const columns = sql`base_currency AS "baseCurrency",cost_basis_method AS "costBasisMethod",pl_view AS "plView",tax_date_basis AS "taxDateBasis",tax_include_fx_fee AS "taxIncludeFxFee",timezone,locale,theme,pl_palette AS "plPalette"`;
const patch = preferencesSchema
  .omit({ baseCurrency: true })
  .partial()
  .extend({ timezone: z.string().max(64).optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0)
  .openapi("PreferencesPatch", { minProperties: 1 });
const acceptance = z
  .object({ termsVersion: legalVersion, privacyNoticeVersion: legalVersion })
  .strict()
  .openapi("LegalAcceptanceRequest");
const document = { currentVersion: legalVersion, url: z.string() };
const timestamp = z.string().datetime();
export const legalStatusSchema = z
  .object({
    terms: z
      .object({
        ...document,
        acceptedVersion: legalVersion.optional(),
        acceptedAt: timestamp.optional(),
      })
      .strict(),
    privacyNotice: z
      .object({
        ...document,
        acknowledgedVersion: legalVersion.optional(),
        acknowledgedAt: timestamp.optional(),
      })
      .strict(),
    consents: z
      .object({
        diagnostics: z
          .object({
            granted: z.boolean(),
            version: legalVersion.optional(),
            updatedAt: timestamp.optional(),
          })
          .strict(),
      })
      .strict(),
    termsAcceptanceRequired: z.boolean(),
  })
  .strict()
  .openapi("LegalStatus");
const json = (schema: z.ZodType) => ({
  description: "Dane konta.",
  content: { "application/json": { schema } },
});

export function mountPreferences(api: OpenAPIHono<AppEnv>, dependencies: AuthRouteDependencies) {
  api.use(
    "/me/*",
    bodyLimit({
      maxSize: 16_384,
      onError: () => {
        throw new ProblemError("BAD_REQUEST");
      },
    }),
  );
  for (const [path, method, operationId, schema, input] of [
    ["/me/preferences", "get", "getPreferences", preferencesSchema, null],
    ["/me/preferences", "patch", "updatePreferences", preferencesSchema, patch],
    ["/me/legal", "get", "getLegalStatus", legalStatusSchema, null],
    ["/me/legal/acceptances", "post", "acceptLegalDocuments", legalStatusSchema, acceptance],
  ] as const) {
    api.openapi(
      createRoute({
        path,
        method,
        operationId,
        tags: ["identity"],
        security: [{ sessionCookie: [] }],
        ...(input
          ? {
              request: {
                body: { required: true, content: { "application/json": { schema: input } } },
              },
            }
          : {}),
        responses: {
          401: marketError,
          ...(!path.startsWith("/me/legal") ? { 403: marketError } : {}),
          ...(input ? { 422: marketError } : {}),
          200: {
            ...json(schema),
            ...(operationId === "getLegalStatus"
              ? { headers: { "Cache-Control": { schema: { type: "string" as const } } } }
              : {}),
          },
        },
      }),
      async (c) => {
        const service = await dependencies.service();
        if (c.req.header("authorization")) throw new ProblemError("FORBIDDEN");
        const legal = path.startsWith("/me/legal");
        const principal = legal
          ? requireMfa(await service.principal(c.req.raw))
          : await service.requireData(c.req.raw);
        if (method !== "get") service.assertOrigin(c.req.raw);
        const subject = { userId: principal.user_id, role: principal.role };
        let recalculate = false;
        const result = await service.options.appDatabase.transaction(subject, async (tx) => {
          if (!legal) {
            if (method === "patch") {
              const value = patch.parse(await c.req.json());
              if (value.timezone)
                try {
                  new Intl.DateTimeFormat("pl-PL", { timeZone: value.timezone });
                } catch {
                  throw new ProblemError("VALIDATION_FAILED");
                }
              await tx.execute(
                sql`INSERT INTO identity.user_preferences (user_id) VALUES (${subject.userId}::uuid) ON CONFLICT DO NOTHING`,
              );
              const previous = preferencesSchema.parse(
                (await tx.execute(sql`SELECT ${columns} FROM identity.user_preferences FOR UPDATE`))
                  .rows[0],
              );
              const next = { ...previous, ...value };
              recalculate =
                next.costBasisMethod !== previous.costBasisMethod ||
                next.taxDateBasis !== previous.taxDateBasis ||
                next.taxIncludeFxFee !== previous.taxIncludeFxFee;
              await tx.execute(
                sql`UPDATE identity.user_preferences SET theme=${next.theme},pl_palette=${next.plPalette},cost_basis_method=${next.costBasisMethod},pl_view=${next.plView},tax_date_basis=${next.taxDateBasis},tax_include_fx_fee=${next.taxIncludeFxFee},timezone=${next.timezone},locale=${next.locale}`,
              );
            }
            return preferencesSchema.parse(
              (await tx.execute(sql`SELECT ${columns} FROM identity.user_preferences`)).rows[0] ??
                defaultPreferences,
            );
          }
          if (method === "post") {
            const value = acceptance.parse(await c.req.json());
            if (
              value.termsVersion !== CURRENT_LEGAL_VERSION ||
              value.privacyNoticeVersion !== CURRENT_LEGAL_VERSION
            )
              throw new ProblemError("VALIDATION_FAILED");
            // Serialize repeat submissions without modifying append-only consent history.
            await tx.execute(
              sql`SELECT pg_advisory_xact_lock(hashtextextended(${subject.userId},104))`,
            );
            for (const [name, action] of [
              ["terms", "accepted"],
              ["privacy_notice", "acknowledged"],
            ] as const)
              await tx.execute(
                sql`INSERT INTO identity.consent_events (user_id,document,version,action,source) SELECT ${subject.userId}::uuid,${name},${CURRENT_LEGAL_VERSION},${action},'gate' WHERE NOT EXISTS (SELECT 1 FROM identity.consent_events WHERE document=${name} AND version=${CURRENT_LEGAL_VERSION} AND action=${action})`,
              );
          }
          const rows = (
            await tx.execute(
              sql`SELECT DISTINCT ON (document) document,version,action,recorded_at FROM identity.consent_events ORDER BY document,recorded_at DESC,id DESC`,
            )
          ).rows;
          const terms = rows.find((r) => r.document === "terms" && r.action === "accepted");
          const privacy = rows.find(
            (r) => r.document === "privacy_notice" && r.action === "acknowledged",
          );
          const diagnostics = rows.find((r) => r.document === "diagnostics");
          const at = (v: unknown) => z.coerce.date().parse(v).toISOString();
          return legalStatusSchema.parse({
            terms: {
              currentVersion: CURRENT_LEGAL_VERSION,
              url: "/regulamin",
              ...(terms
                ? { acceptedVersion: terms.version, acceptedAt: at(terms.recorded_at) }
                : {}),
            },
            privacyNotice: {
              currentVersion: CURRENT_LEGAL_VERSION,
              url: "/prywatnosc",
              ...(privacy
                ? { acknowledgedVersion: privacy.version, acknowledgedAt: at(privacy.recorded_at) }
                : {}),
            },
            consents: {
              diagnostics: {
                granted: diagnostics?.action === "granted",
                ...(diagnostics
                  ? { version: diagnostics.version, updatedAt: at(diagnostics.recorded_at) }
                  : {}),
              },
            },
            termsAcceptanceRequired: terms?.version !== CURRENT_LEGAL_VERSION,
          });
        });
        if (recalculate) await service.options.preferencesChanged?.(subject.userId);
        return c.json(result, 200);
      },
      (result) => {
        if (!result.success) throw new ProblemError("VALIDATION_FAILED");
      },
    );
  }
}
