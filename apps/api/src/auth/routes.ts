import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { type AppEnv, PROBLEM_DEFINITIONS, ProblemError } from "@oliginvest/platform";
import type { Context } from "hono";
import { authInputs, emptyInput, stepUpInput } from "./inputs.js";
import type { AuthService } from "./service.js";

const uuid = z.string().uuid();
const timestamp = z.string().datetime();
const codes = z.array(z.string()).min(10).max(10);
const user = z
  .object({
    id: uuid,
    email: z.email(),
    name: z.string(),
    emailVerified: z.boolean().optional(),
    role: z.enum(["user", "pro", "admin"]),
    twoFactorEnabled: z.boolean(),
  })
  .strict()
  .openapi("AuthUser");
const session = z
  .object({
    session: z
      .object({ id: uuid, expiresAt: timestamp, mfaVerifiedAt: timestamp.nullable().optional() })
      .strict(),
    user,
    backupCodes: codes.optional(),
  })
  .strict()
  .openapi("AuthSessionResponse");
const status = z
  .object({ status: z.boolean().optional(), message: z.string().optional() })
  .strict()
  .openapi("AuthStatusResponse");
const signin = z
  .object({ twoFactorRedirect: z.boolean().optional(), user: user.optional() })
  .strict()
  .openapi("AuthSignInResponse");
const enabled = z
  .object({
    totpURI: z
      .string()
      .regex(/^otpauth:\/\/totp\//u)
      .openapi({ pattern: /^otpauth:\/\/totp\//u.source.replaceAll("\\/", "/") }),
    backupCodes: codes,
  })
  .strict()
  .openapi("AuthTwoFactorEnableResponse");
const backups = z.object({ backupCodes: codes }).strict().openapi("AuthBackupCodesResponse");
const sessionInfo = z
  .object({
    id: uuid,
    createdAt: timestamp,
    expiresAt: timestamp,
    ipAddress: z.string().optional(),
    userAgent: z.string().optional(),
    token: z.string().optional(),
  })
  .strict()
  .openapi("AuthSessionInfo");
export const authProblem = z
  .object({
    type: z.url(),
    title: z.string(),
    status: z.number().int().min(400).max(599),
    code: z.enum(
      Object.keys(PROBLEM_DEFINITIONS) as [
        keyof typeof PROBLEM_DEFINITIONS,
        ...(keyof typeof PROBLEM_DEFINITIONS)[],
      ],
    ),
    detail: z.string().optional(),
    instance: z.string().optional(),
    errors: z
      .array(z.object({ path: z.string(), code: z.string(), message: z.string() }).strict())
      .optional(),
  })
  .strict()
  .openapi("AuthProblem");
export const authErrors = Object.fromEntries(
  [400, 401, 403, 422, 429].map((code) => [
    code,
    {
      description: "Błąd żądania; pole code rozróżnia przyczynę.",
      content: { "application/problem+json": { schema: authProblem } },
      headers: {
        "X-Request-Id": { schema: { type: "string" as const, maxLength: 64 } },
        ...(code === 429
          ? {
              "Retry-After": { schema: { type: "integer" as const, minimum: 1 } },
              RateLimit: { schema: { type: "string" as const } },
              "RateLimit-Policy": { schema: { type: "string" as const } },
            }
          : {}),
      },
    },
  ]),
);

export const authOperations = [
  ["/sign-up/email", "authSignUpEmail", session, true],
  ["/sign-in/email", "authSignInEmail", signin, true],
  ["/sign-out", "authSignOut", status, false],
  ["/get-session", "authGetSession", session.nullable(), false],
  ["/list-sessions", "authListSessions", z.array(sessionInfo), false],
  ["/request-password-reset", "authRequestPasswordReset", status, true],
  ["/reset-password", "authResetPassword", status, true],
  ["/change-password", "authChangePassword", status, false],
  ["/two-factor/enable", "authTwoFactorEnable", enabled, false],
  ["/two-factor/verify-totp", "authTwoFactorVerifyTotp", session, false],
  ["/two-factor/verify-backup-code", "authTwoFactorVerifyBackupCode", session, false],
  ["/two-factor/generate-backup-codes", "authTwoFactorGenerateBackupCodes", backups, false],
  ["/revoke-session", "authRevokeSession", status, false],
  ["/revoke-other-sessions", "authRevokeOtherSessions", status, false],
] as const;
export type AuthRouteDependencies = {
  service: () => AuthService;
  clientIp: (context: Context<AppEnv>) => string;
};
export function createAuthRouter(dependencies: AuthRouteDependencies) {
  const router = new OpenAPIHono<AppEnv>({
    defaultHook: (result) => {
      if (!result.success) throw new ProblemError("BAD_REQUEST");
    },
  });
  for (const [path, operationId, schema, publicRoute] of authOperations) {
    const method = path === "/get-session" || path === "/list-sessions" ? "get" : "post";
    const input = authInputs[path] ?? emptyInput;
    router.openAPIRegistry.registerPath(
      createRoute({
        method,
        path,
        operationId,
        tags: ["auth"],
        security: publicRoute ? [] : [{ sessionCookie: [] }],
        ...(method === "post"
          ? {
              request: {
                body: { required: true, content: { "application/json": { schema: input } } },
              },
            }
          : {}),
        responses: {
          ...authErrors,
          200: {
            description: "Sukces.",
            content: {
              "application/json": {
                schema:
                  path === "/get-session"
                    ? {
                        oneOf: [
                          { $ref: "#/components/schemas/AuthSessionResponse" },
                          { type: "null" as const },
                        ],
                      }
                    : schema,
              },
            },
            ...(path === "/sign-out"
              ? { headers: { "Clear-Site-Data": { schema: { type: "string" as const } } } }
              : path === "/two-factor/enable"
                ? { headers: { "Cache-Control": { schema: { type: "string" as const } } } }
                : {}),
          },
        },
      }),
    );
    router.on(method.toUpperCase(), path, async (context) => {
      const request = context.req.raw;
      const response = await dependencies.service().handle(request, dependencies.clientIp(context));
      const body = schema.parse(await response.json());
      return Response.json(body, { status: response.status, headers: response.headers });
    });
  }
  return router;
}
export function mountStepUp(api: OpenAPIHono<AppEnv>, dependencies: AuthRouteDependencies) {
  api.openapi(
    createRoute({
      method: "post",
      path: "/me/step-up",
      operationId: "verifyStepUp",
      tags: ["identity"],
      security: [{ sessionCookie: [] }],
      request: {
        body: { required: true, content: { "application/json": { schema: stepUpInput } } },
      },
      responses: {
        ...authErrors,
        200: {
          description: "Tożsamość potwierdzona.",
          content: {
            "application/json": {
              schema: z.object({ validUntil: timestamp }).strict().openapi("StepUpResult"),
            },
          },
        },
      },
    }),
    async (context) => {
      const service = dependencies.service();
      if (context.req.header("authorization")) throw new ProblemError("FORBIDDEN");
      await service.options.state.limit(dependencies.clientIp(context), 5, 60);
      const response = await service.stepUp(context.req.raw, context.req.valid("json").code);
      for (const cookie of response.headers.getSetCookie())
        context.header("Set-Cookie", cookie, { append: true });
      return context.json(
        z
          .object({ validUntil: timestamp })
          .strict()
          .parse(await response.json()),
        200,
      );
    },
  );
}
