import { createHash, randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { AppDatabase, DatabaseTransaction, ServiceDatabase } from "@oliginvest/db";
import { ProblemError, requirePermission } from "@oliginvest/platform";
import { generateRandomString, symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { AuditWriter } from "./audit.js";
import { type Auth, type AuthConfiguration, createAuth } from "./config.js";
import { authInputs, CURRENT_LEGAL_VERSION, signupInput } from "./inputs.js";
import {
  checkPassword,
  hashPassword,
  needsRehash,
  type PasswordChecks,
  verifyPassword,
} from "./password.js";
import {
  findSession,
  type Principal,
  publicSession,
  readSignedCookie,
  requireFactorReplacement,
  requireMfa,
  requireStepUp,
  SESSION_COOKIE,
  sessionCookie,
} from "./session.js";
import type { AuthState } from "./state.js";
import { acceptedTotpStep } from "./totp.js";

const dummyHash = hashPassword(randomBytes(32).toString("hex"));
const digest = (token: string) => createHash("sha256").update(token).digest("hex");
const userRow = z.object({ id: z.uuid(), email: z.email(), name: z.string() }).strict();
const tokenBody = z.object({ token: z.string().optional() }).passthrough();
const publicPaths = new Set([
  "/sign-up/email",
  "/sign-in/email",
  "/request-password-reset",
  "/reset-password",
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
  "/get-session",
]);
const sensitivePaths = new Set([
  "/change-password",
  "/two-factor/generate-backup-codes",
  "/revoke-session",
  "/revoke-other-sessions",
]);
export type AuthSecurityEvent = {
  userId: string;
  kind: "two_factor_recovery_started" | "two_factor_recovered";
  occurredAt: string;
};
type AuthResult =
  | {
      response: Response;
      consent?: { userId: string; diagnostics: boolean };
      securityEvent?: AuthSecurityEvent;
    }
  | { failure: ProblemError };
export interface AuthServiceOptions {
  database: ServiceDatabase;
  appDatabase: AppDatabase;
  configuration: AuthConfiguration;
  state: AuthState;
  passwordChecks: PasswordChecks;
  audit: Pick<AuditWriter, "record">;
  securityEvent: (event: AuthSecurityEvent) => Promise<void>;
  wait?: (milliseconds: number) => Promise<void>;
  event: (event: string) => void;
}

export class AuthService {
  constructor(readonly options: AuthServiceOptions) {}
  async principal(request: Request): Promise<Principal | null> {
    return this.options.database.transaction(async (tx) => {
      const principal = await findSession(
        tx,
        readSignedCookie(request, SESSION_COOKIE, this.options.configuration),
      );
      if (
        principal &&
        readSignedCookie(request, "__Host-oliginvest.dont_remember", this.options.configuration) !==
          "true"
      ) {
        await tx.execute(sql`UPDATE auth.sessions SET updated_at=now(), expires_at=LEAST(now()+interval '7 days',created_at+interval '30 days')
          WHERE id=${principal.id}::uuid AND updated_at<now()-interval '24 hours'`);
      }
      return principal;
    });
  }
  async legal(
    principal: Principal,
  ): Promise<{ termsAcceptanceRequired: boolean; diagnosticsConsent: boolean }> {
    const rows = await this.options.appDatabase.transaction(
      { userId: principal.user_id, role: principal.role },
      async (tx) =>
        (
          await tx.execute(sql`SELECT DISTINCT ON (document) document,version,action FROM identity.consent_events
        ORDER BY document,recorded_at DESC,id DESC`)
        ).rows,
    );
    return {
      termsAcceptanceRequired: !rows.some(
        (row) =>
          row.document === "terms" &&
          row.version === CURRENT_LEGAL_VERSION &&
          row.action === "accepted",
      ),
      diagnosticsConsent: rows.some(
        (row) => row.document === "diagnostics" && row.action === "granted",
      ),
    };
  }
  async requireData(request: Request, stepUp = false): Promise<Principal> {
    const principal = requireMfa(await this.principal(request));
    if ((await this.legal(principal)).termsAcceptanceRequired)
      throw new ProblemError("TERMS_ACCEPTANCE_REQUIRED");
    if (stepUp) requireStepUp(principal);
    return principal;
  }
  async requireAdmin(request: Request, permission: string, mutation = false): Promise<Principal> {
    const principal = await this.requireData(request, mutation);
    requirePermission(principal.role, permission);
    if (principal.mfa_method !== "totp") throw new ProblemError("STEP_UP_REQUIRED");
    return principal;
  }
  async recordConsents(
    userId: string,
    diagnostics: boolean,
    role: "user" | "pro" | "admin" = "user",
  ): Promise<void> {
    await this.options.appDatabase.transaction({ userId, role }, async (tx) => {
      await tx.execute(sql`INSERT INTO identity.consent_events (user_id,document,version,action,source)
        VALUES (${userId}::uuid,'terms',${CURRENT_LEGAL_VERSION},'accepted','sign_up'),
        (${userId}::uuid,'privacy_notice',${CURRENT_LEGAL_VERSION},'acknowledged','sign_up')`);
      if (diagnostics)
        await tx.execute(sql`INSERT INTO identity.consent_events (user_id,document,version,action,source)
        VALUES (${userId}::uuid,'diagnostics',${CURRENT_LEGAL_VERSION},'granted','sign_up')`);
    });
  }
  assertOrigin(request: Request): void {
    if (request.method === "GET") return;
    if (request.headers.get("origin") !== this.options.configuration.origin)
      throw new ProblemError("FORBIDDEN");
  }
  async handle(request: Request, ip: string): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.slice("/api/auth".length);
    const schema = authInputs[path];
    if (!schema || url.search || request.headers.has("authorization"))
      throw new ProblemError("FORBIDDEN");
    if (request.method !== (["/get-session", "/list-sessions"].includes(path) ? "GET" : "POST"))
      throw new ProblemError("FORBIDDEN");
    this.assertOrigin(request);
    if (request.headers.get("cookie")?.includes("__Host-oliginvest.trust_device="))
      throw new ProblemError("FORBIDDEN");
    let input: unknown = {};
    if (request.method === "POST") {
      if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
        throw new ProblemError("BAD_REQUEST");
      const text = await request.text();
      if (Buffer.byteLength(text) > 16_384) throw new ProblemError("BAD_REQUEST");
      try {
        input = text ? JSON.parse(text) : {};
      } catch {
        throw new ProblemError("BAD_REQUEST");
      }
    }
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new ProblemError("BAD_REQUEST");
    const body = z.record(z.string(), z.unknown()).parse(parsed.data);
    if (body.trustDevice === true) throw new ProblemError("FORBIDDEN");
    if ((publicPaths.has(path) && path !== "/get-session") || path.startsWith("/two-factor/")) {
      await this.options.state.limit(ip, 5, 60);
      await this.options.state.limit(ip, 20, 3600);
    }
    const before = await this.principal(request);
    if (!publicPaths.has(path) && !before) throw new ProblemError("UNAUTHENTICATED");
    if (
      before &&
      ![
        "/sign-out",
        "/get-session",
        "/two-factor/enable",
        "/two-factor/verify-totp",
        "/two-factor/verify-backup-code",
      ].includes(path) &&
      !publicPaths.has(path)
    ) {
      requireMfa(before);
      if ((await this.legal(before)).termsAcceptanceRequired)
        throw new ProblemError("TERMS_ACCEPTANCE_REQUIRED");
    }
    if (before && sensitivePaths.has(path)) requireStepUp(before);
    if (before && path === "/two-factor/enable" && before.two_factor_enabled)
      requireFactorReplacement(before);
    if (path === "/sign-in/email") {
      const email = z.string().parse(body.email).toLowerCase();
      body.email = email;
      const failed = await this.options.state.failures(email);
      await (this.options.wait ?? delay)(
        failed ? Math.min(30, 2 ** Math.min(failed - 1, 5)) * 1000 : 0,
      );
    }
    if (path === "/sign-up/email" || path === "/reset-password" || path === "/change-password")
      await this.checkNewPassword(path, body, before);
    const mail: { email: string; token: string }[] = [];
    const result = await this.options.database.transaction<AuthResult>(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(730101)`);
      const auth = createAuth(tx, {
        ...this.options.configuration,
        sendReset: async (message) => {
          mail.push(message);
        },
      });
      // Recheck the session after acquiring the lock; revocation must win a race.
      const principal = await findSession(
        tx,
        readSignedCookie(request, SESSION_COOKIE, this.options.configuration),
      );
      if (before && !principal) throw new ProblemError("UNAUTHENTICATED");
      if (principal && sensitivePaths.has(path)) {
        requireMfa(principal);
        requireStepUp(principal);
      }
      if (principal && path === "/two-factor/enable" && principal.two_factor_enabled)
        requireFactorReplacement(principal);
      if (path === "/get-session")
        return { response: Response.json(principal ? publicSession(principal) : null) };
      if (path === "/list-sessions")
        return { response: await this.listSessions(tx, requireMfa(principal)) };
      let invitation: { role: string } | undefined;
      if (path === "/sign-up/email") {
        const signup = signupInput.parse(body);
        if (
          signup.termsVersion !== CURRENT_LEGAL_VERSION ||
          signup.privacyNoticeVersion !== CURRENT_LEGAL_VERSION
        )
          throw new ProblemError("BAD_REQUEST");
        const row = (
          await tx.execute(
            sql`SELECT * FROM identity.find_invitation(${digest(signup.invitationToken)})`,
          )
        ).rows[0];
        if (!row || row.email !== signup.email.toLowerCase()) throw new ProblemError("FORBIDDEN");
        invitation = { role: z.enum(["user", "pro", "admin"]).parse(row.role) };
        body.email = signup.email.toLowerCase();
      }
      if (path === "/sign-in/email") {
        const account = (
          await tx.execute(sql`SELECT a.password FROM auth.accounts a JOIN auth.users u ON u.id=a.user_id
          WHERE u.email=${body.email} AND a.provider_id='credential'`)
        ).rows[0];
        if (!account) {
          await verifyPassword({
            hash: await dummyHash,
            password: z.string().parse(body.password),
          });
          return { failure: new ProblemError("UNAUTHENTICATED") };
        }
      }
      let verifiedUser: string | undefined;
      if (path === "/two-factor/verify-totp" || path === "/two-factor/verify-backup-code") {
        const verification = await this.checkSecondFactor(
          tx,
          auth,
          request,
          principal,
          z.string().parse(body.code),
          path.endsWith("backup-code"),
        );
        if (verification instanceof ProblemError) return { failure: verification };
        verifiedUser = verification;
      }
      if (path === "/two-factor/enable" && principal?.two_factor_enabled) {
        // Native 1.7.5 rejects re-enrollment. Validate password before replacing the
        // factor and revoke other sessions; a failed native call rolls this back.
        const account = (
          await tx.execute(
            sql`SELECT password FROM auth.accounts WHERE user_id=${principal.user_id}::uuid AND provider_id='credential'`,
          )
        ).rows[0];
        if (
          !account ||
          !(await verifyPassword({
            hash: z.string().parse(account.password),
            password: z.string().parse(body.password),
          }))
        )
          throw new ProblemError("UNAUTHENTICATED");
        await tx.execute(
          sql`DELETE FROM auth.two_factors WHERE user_id=${principal.user_id}::uuid`,
        );
        if (principal.mfa_method === "backup")
          await this.options.audit.record(
            { userId: principal.user_id, role: principal.role },
            {
              action: "auth.two_factor.recovery.started",
              outcome: "success",
              resourceId: principal.user_id,
            },
          );
        // Keep two_factor_enabled=true: password-only login cannot start a fresh
        // enrollment while recovery is in progress. Native enable needs only the
        // previous factor removed, not a disabled user.
        await tx.execute(
          sql`UPDATE auth.sessions SET mfa_verified_at=NULL WHERE user_id=${principal.user_id}::uuid`,
        );
        await tx.execute(
          sql`DELETE FROM auth.sessions WHERE user_id=${principal.user_id}::uuid AND id<>${principal.id}::uuid`,
        );
      }
      const nativeBody = { ...body };
      for (const key of [
        "invitationToken",
        "acceptTerms",
        "termsVersion",
        "privacyNoticeVersion",
        "diagnosticsConsent",
      ])
        delete nativeBody[key];
      if (path === "/request-password-reset") delete nativeBody.redirectTo;
      const headers = new Headers(request.headers);
      headers.delete("content-length");
      const native = await auth.handler(
        new Request(`${this.options.configuration.origin}/api/auth${path}`, {
          method: request.method,
          headers,
          ...(request.method === "POST" ? { body: JSON.stringify(nativeBody) } : {}),
        }),
      );
      if (!native.ok) {
        if (path === "/two-factor/enable" && principal?.two_factor_enabled)
          throw new ProblemError("BAD_REQUEST");
        return {
          failure: new ProblemError(
            native.status === 429
              ? "RATE_LIMITED"
              : native.status === 403
                ? "FORBIDDEN"
                : native.status === 401
                  ? "UNAUTHENTICATED"
                  : "BAD_REQUEST",
          ),
        };
      }
      const data: unknown = await native.json();
      const responseHeaders = new Headers(native.headers);
      responseHeaders.delete("content-length");
      let token = tokenBody.parse(data).token;
      // During enrollment BA replaces the session but returns the old token in
      // its JSON response. The signed Set-Cookie is the authoritative new token.
      const nativeSessionCookie = native.headers
        .getSetCookie()
        .findLast(
          (cookie) => cookie.startsWith(`${SESSION_COOKIE}=`) && !cookie.includes("Max-Age=0"),
        );
      if (nativeSessionCookie)
        token =
          readSignedCookie(
            new Request(request.url, {
              headers: {
                cookie: nativeSessionCookie.split(";")[0] ?? "",
              },
            }),
            SESSION_COOKIE,
            this.options.configuration,
          ) ?? undefined;
      let consent: { userId: string; diagnostics: boolean } | undefined;
      let securityEvent: AuthSecurityEvent | undefined;
      if (path === "/two-factor/enable" && principal?.mfa_method === "backup")
        securityEvent = {
          userId: principal.user_id,
          kind: "two_factor_recovery_started",
          occurredAt: new Date().toISOString(),
        };
      let backupCodes: string[] | undefined;
      const replacementComplete =
        path === "/two-factor/verify-totp" &&
        principal?.two_factor_enabled &&
        principal.mfa_method !== null &&
        principal.mfa_verified_at === null;
      if (replacementComplete && verifiedUser) {
        backupCodes = Array.from({ length: 10 }, () =>
          generateRandomString(10, "a-z", "0-9", "A-Z"),
        ).map((code) => `${code.slice(0, 5)}-${code.slice(5)}`);
        const { secretConfig } = await auth.$context;
        const encrypted = await symmetricEncrypt({
          key: secretConfig,
          data: JSON.stringify(backupCodes),
        });
        await tx.execute(
          sql`UPDATE auth.two_factors SET backup_codes=${encrypted} WHERE user_id=${verifiedUser}::uuid`,
        );
        await tx.execute(
          sql`DELETE FROM auth.sessions WHERE user_id=${verifiedUser}::uuid AND token<>${token ?? ""}`,
        );
        if (principal.mfa_method === "backup")
          securityEvent = {
            userId: verifiedUser,
            kind: "two_factor_recovered",
            occurredAt: new Date().toISOString(),
          };
      }
      if (invitation && token) {
        const created = await findSession(tx, token);
        if (!created) throw new Error("Missing new session");
        const consumed = (
          await tx.execute(
            sql`SELECT identity.consume_invitation(${digest(z.string().parse(body.invitationToken))},${created.user_id}::uuid) AS used`,
          )
        ).rows[0];
        if (consumed?.used !== true) throw new ProblemError("FORBIDDEN");
        await tx.execute(
          sql`UPDATE auth.users SET role=${invitation.role},email_verified=true WHERE id=${created.user_id}::uuid`,
        );
        consent = { userId: created.user_id, diagnostics: body.diagnosticsConsent === true };
      }
      if (verifiedUser && token) {
        const rotated = randomBytes(32).toString("base64url");
        await tx.execute(sql`UPDATE auth.sessions SET token=${rotated},mfa_verified_at=now(),mfa_method=${path.endsWith("backup-code") ? "backup" : "totp"},
          created_at=COALESCE(${principal?.created_at.toISOString() ?? null}::timestamptz,created_at),
          expires_at=LEAST(expires_at,COALESCE(${principal?.created_at.toISOString() ?? null}::timestamptz,created_at)+interval '30 days')
          WHERE token=${token} AND user_id=${verifiedUser}::uuid`);
        const remainingCookies = responseHeaders
          .getSetCookie()
          .filter((cookie) => !cookie.startsWith(`${SESSION_COOKIE}=`));
        responseHeaders.delete("set-cookie");
        for (const cookie of remainingCookies) responseHeaders.append("set-cookie", cookie);
        responseHeaders.append(
          "set-cookie",
          sessionCookie(
            rotated,
            this.options.configuration,
            readSignedCookie(
              request,
              "__Host-oliginvest.dont_remember",
              this.options.configuration,
            ) !== "true",
          ),
        );
        token = rotated;
      }
      if (token) {
        const active = await findSession(tx, token);
        if (active) {
          await tx.execute(sql`DELETE FROM auth.sessions WHERE user_id=${active.user_id}::uuid AND id IN
            (SELECT id FROM auth.sessions WHERE user_id=${active.user_id}::uuid ORDER BY created_at DESC,id DESC OFFSET 10)`);
          if (path === "/sign-in/email") {
            const account = (
              await tx.execute(
                sql`SELECT password FROM auth.accounts WHERE user_id=${active.user_id}::uuid AND provider_id='credential'`,
              )
            ).rows[0];
            if (account && needsRehash(z.string().parse(account.password)))
              await tx.execute(
                sql`UPDATE auth.accounts SET password=${await hashPassword(z.string().parse(body.password))} WHERE user_id=${active.user_id}::uuid AND provider_id='credential'`,
              );
          }
          const resultBody =
            path === "/sign-in/email"
              ? { user: publicSession(active).user }
              : path === "/change-password"
                ? { status: true }
                : { ...publicSession(active), ...(backupCodes ? { backupCodes } : {}) };
          return {
            response: Response.json(resultBody, { headers: responseHeaders }),
            ...(consent ? { consent } : {}),
            ...(securityEvent ? { securityEvent } : {}),
          };
        }
      }
      if (path === "/sign-out")
        responseHeaders.set("Clear-Site-Data", '"cache", "cookies", "storage"');
      const resultBody =
        path === "/sign-in/email"
          ? { twoFactorRedirect: true }
          : path === "/two-factor/enable"
            ? z.object({ totpURI: z.string(), backupCodes: z.array(z.string()) }).parse(data)
            : path === "/two-factor/generate-backup-codes"
              ? {
                  backupCodes: z.object({ backupCodes: z.array(z.string()) }).parse(data)
                    .backupCodes,
                }
              : { status: true };
      return {
        response: Response.json(resultBody, { headers: responseHeaders }),
        ...(securityEvent ? { securityEvent } : {}),
      };
    });
    if (path === "/sign-in/email") {
      const email = z.string().parse(body.email);
      if ("failure" in result) await this.options.state.failed(email);
      else await this.options.state.succeeded(email);
    }
    if ("failure" in result) throw result.failure;
    if (result.securityEvent) {
      if (result.securityEvent.kind === "two_factor_recovered") {
        await this.options.audit.record(
          { userId: result.securityEvent.userId, role: before?.role ?? "user" },
          {
            action: "auth.two_factor.recovery.completed",
            outcome: "success",
            resourceId: result.securityEvent.userId,
          },
        );
      }
      await this.options.securityEvent(result.securityEvent);
    }
    if (result.consent) {
      try {
        await this.recordConsents(result.consent.userId, result.consent.diagnostics);
      } catch {
        this.options.event("auth.consent_write_failed");
      }
    }
    for (const message of mail) {
      try {
        await this.options.configuration.sendReset(message);
      } catch {
        this.options.event("auth.reset_delivery_failed");
      }
    }
    return result.response;
  }

  private async checkNewPassword(
    path: string,
    body: Record<string, unknown>,
    principal: Principal | null,
  ): Promise<void> {
    let subject = { email: "", name: "" };
    if (path === "/sign-up/email")
      subject = { email: z.string().parse(body.email), name: z.string().parse(body.name) };
    else if (principal) subject = { email: principal.email, name: principal.name };
    else {
      const token = z.string().parse(body.token);
      const found = await this.options.database.transaction(
        async (tx) =>
          (
            await tx.execute(sql`SELECT u.id,u.email,u.name FROM auth.users u JOIN auth.verifications v
        ON v.value=u.id::text WHERE v.identifier=${`reset-password:${token}`} AND v.expires_at>now()`)
          ).rows[0],
      );
      if (!found) throw new ProblemError("BAD_REQUEST");
      subject = userRow.parse(found);
    }
    await checkPassword(
      z.string().parse(body.newPassword ?? body.password),
      subject,
      this.options.passwordChecks,
    );
  }

  private async checkSecondFactor(
    tx: DatabaseTransaction,
    auth: Auth,
    request: Request,
    principal: Principal | null,
    code: string,
    backup: boolean,
  ): Promise<string | ProblemError> {
    let userId = principal?.user_id;
    if (!userId) {
      const challenge = readSignedCookie(
        request,
        "__Host-oliginvest.two_factor",
        this.options.configuration,
      );
      if (!challenge) return new ProblemError("UNAUTHENTICATED");
      const found = (
        await tx.execute(sql`SELECT u.id FROM auth.verifications v JOIN auth.users u ON u.id::text=v.value
        WHERE v.identifier=${challenge} AND v.expires_at>now() AND u.two_factor_enabled
          AND (NOT u.banned OR (u.ban_expires IS NOT NULL AND u.ban_expires<=now()))`)
      ).rows[0];
      if (!found) return new ProblemError("UNAUTHENTICATED");
      userId = z.uuid().parse(found.id);
    }
    const factor = (
      await tx.execute(sql`SELECT secret,backup_codes,verified,failed_verification_count,locked_until
      FROM auth.two_factors WHERE user_id=${userId}::uuid FOR UPDATE`)
    ).rows[0];
    if (!factor || (backup && factor.verified !== true)) return new ProblemError("UNAUTHENTICATED");
    if (factor.locked_until && new Date(String(factor.locked_until)).getTime() > Date.now())
      return new ProblemError("RATE_LIMITED", { retryAfterSeconds: 900 });
    if (factor.locked_until)
      await tx.execute(
        sql`UPDATE auth.two_factors SET failed_verification_count=0,locked_until=NULL WHERE user_id=${userId}::uuid`,
      );
    const { secretConfig } = await auth.$context;
    let valid = false;
    if (backup) {
      const codes = z.array(z.string()).parse(
        JSON.parse(
          await symmetricDecrypt({
            key: secretConfig,
            data: z.string().parse(factor.backup_codes),
          }),
        ),
      );
      valid = codes.includes(code);
    } else {
      const secret = await symmetricDecrypt({
        key: secretConfig,
        data: z.string().parse(factor.secret),
      });
      const step = acceptedTotpStep(secret, code);
      valid = step !== null && (await this.options.state.consumeStep(userId, step));
    }
    if (!valid) {
      await tx.execute(sql`UPDATE auth.two_factors SET failed_verification_count=COALESCE(failed_verification_count,0)+1,
        locked_until=CASE WHEN COALESCE(failed_verification_count,0)+1>=5 THEN now()+interval '15 minutes' ELSE NULL END
        WHERE user_id=${userId}::uuid`);
      return new ProblemError("UNAUTHENTICATED");
    }
    await tx.execute(
      sql`UPDATE auth.two_factors SET failed_verification_count=0,locked_until=NULL WHERE user_id=${userId}::uuid`,
    );
    return userId;
  }
  private async listSessions(tx: DatabaseTransaction, principal: Principal): Promise<Response> {
    const rows = (
      await tx.execute(sql`SELECT id,token,created_at,expires_at,ip_address,user_agent FROM auth.sessions
      WHERE user_id=${principal.user_id}::uuid AND expires_at>now() AND created_at>now()-interval '30 days' ORDER BY created_at DESC,id DESC`)
    ).rows;
    return Response.json(
      rows.map((row) => ({
        id: row.id,
        token: row.token,
        createdAt: new Date(String(row.created_at)).toISOString(),
        expiresAt: new Date(String(row.expires_at)).toISOString(),
        ...(row.ip_address ? { ipAddress: row.ip_address } : {}),
        ...(row.user_agent ? { userAgent: row.user_agent } : {}),
      })),
    );
  }
  async stepUp(request: Request, code: string): Promise<Response> {
    const principal = requireMfa(await this.principal(request));
    this.assertOrigin(request);
    const result = await this.options.database.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(730101)`);
      const current = await findSession(tx, principal.token);
      if (!current) throw new ProblemError("UNAUTHENTICATED");
      const auth = createAuth(tx, this.options.configuration);
      const verification = await this.checkSecondFactor(tx, auth, request, current, code, false);
      if (verification instanceof ProblemError) return { failure: verification };
      const token = randomBytes(32).toString("base64url");
      const at = new Date();
      await tx.execute(
        sql`UPDATE auth.sessions SET token=${token},mfa_verified_at=${at.toISOString()},mfa_method='totp' WHERE id=${current.id}::uuid`,
      );
      return {
        response: Response.json(
          { validUntil: new Date(at.getTime() + 900_000).toISOString() },
          {
            headers: {
              "set-cookie": sessionCookie(
                token,
                this.options.configuration,
                readSignedCookie(
                  request,
                  "__Host-oliginvest.dont_remember",
                  this.options.configuration,
                ) !== "true",
              ),
            },
          },
        ),
      };
    });
    if (result.failure) throw result.failure;
    if (!result.response) throw new Error("Missing step-up response");
    return result.response;
  }
}
