import type { AppDatabase, DatabaseContext, DatabaseTransaction } from "@oliginvest/db";
import {
  createFormatters,
  authMailMessages as defaultMessages,
  formatMessage,
} from "@oliginvest/i18n";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  classifyDevice,
  deviceFamily,
  deviceKey,
  failedSignInAlertDue,
  type MassExportReason,
  massExportAnomaly,
  SECURITY_RULES,
} from "../modules.js";
import { userLocale } from "../user-locale.js";
import type { AuditWriter } from "./audit.js";
import { approximateIp } from "./client-ip.js";

/** Security notification job (`notifications.deliver`, kind `security`). */
export type SecurityNotification = {
  v: 1;
  userId: string;
  kind: "security";
  sourceRef: string;
  channels: ["email"];
  subject: string;
  text: string;
  url: string;
  occurredAt: string;
};
export type SecurityNotify = (jobId: string, payload: SecurityNotification) => Promise<void>;
type Actor = { userId: string; role: "user" | "pro" | "admin" };
type Client = { ip: string; userAgent: string | undefined };
export type SecurityRecoveryEvent = {
  userId: string;
  kind: "two_factor_recovery_started" | "two_factor_recovered";
  occurredAt: string;
};

const SETTINGS_PATH = "/ustawienia";
const lockId = 110;
const ipSchema = z.union([z.ipv4(), z.ipv6()]);
const rowTime = (value: unknown) => z.coerce.date().parse(value);

/**
 * BL-110 (NFR-03.10): records authentication events in `platform.audit_log` under
 * the account's RLS context and applies the § 5.3 anomaly rules. Every decision
 * reads only the account's own audit rows; alerts go through the notifications
 * module as `security` jobs (e-mail always, quiet hours do not apply).
 */
export class SecurityMonitor {
  constructor(
    private readonly options: {
      appDatabase: AppDatabase;
      audit: Pick<AuditWriter, "recordInTransaction">;
      notify: SecurityNotify;
      origin: string;
    },
  ) {}

  /** Serialises rule evaluation per account so concurrent attempts cannot double-alert. */
  private async locked<T>(actor: Actor, run: (tx: DatabaseTransaction) => Promise<T>) {
    return this.options.appDatabase.transaction(actor satisfies DatabaseContext, async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`security:${actor.userId}`},${lockId}))`,
      );
      return run(tx);
    });
  }

  private client(client: Client) {
    const parsed = ipSchema.safeParse(client.ip);
    return {
      ...(parsed.success ? { ip: parsed.data } : {}),
      ...(client.userAgent ? { userAgent: client.userAgent.slice(0, 512) } : {}),
    };
  }

  private async messages(actor: Actor) {
    const preferences = await userLocale(this.options.appDatabase, actor);
    const messages =
      preferences.locale === "en-US"
        ? (await import("@oliginvest/i18n/en")).copies.authMailMessages
        : defaultMessages;
    const time = (at: Date) =>
      createFormatters(preferences).formatDateTime(at, preferences.timezone);
    return { messages, time, timezone: preferences.timezone };
  }

  private url() {
    return new URL(SETTINGS_PATH, this.options.origin).href;
  }

  /** Failed password (`password`) or login second factor (`totp`, `backup`). */
  async signInFailed(actor: Actor, client: Client, factor: "password" | "totp" | "backup") {
    const rule = SECURITY_RULES.failedSignIn;
    const text = await this.messages(actor);
    await this.locked(actor, async (tx) => {
      await this.options.audit.recordInTransaction(tx, actor, {
        action: factor === "password" ? "auth.sign_in_failed" : "auth.2fa_failed",
        outcome: "denied",
        resourceType: "user",
        resourceId: actor.userId,
        ...this.client(client),
      });
      const row = (
        await tx.execute(sql`SELECT now() AS now,
          count(*) FILTER (WHERE action IN ('auth.sign_in_failed','auth.2fa_failed')
            AND occurred_at > now() - make_interval(mins => ${rule.windowMinutes}))::int AS failures,
          max(occurred_at) FILTER (WHERE action='security.failed_sign_in_series') AS last_alert
          FROM platform.audit_log WHERE actor_user_id=${actor.userId}::uuid
            AND occurred_at > now() - make_interval(mins => ${Math.max(rule.windowMinutes, rule.cooldownMinutes)})`)
      ).rows[0];
      const now = rowTime(row?.now);
      const failures = Number(row?.failures ?? 0);
      const lastAlertAt = row?.last_alert ? rowTime(row.last_alert) : null;
      if (!failedSignInAlertDue({ failures, lastAlertAt, now })) return;
      const alertId = await this.alert(tx, actor, "security.failed_sign_in_series", {
        count: failures,
      });
      await this.options.notify(`security-failed-sign-in-${alertId}`, {
        v: 1,
        userId: actor.userId,
        kind: "security",
        sourceRef: `security:failed-sign-in:${alertId}`,
        channels: ["email"],
        subject: text.messages.securityFailedSignInSubject,
        text: formatMessage(text.messages.securityFailedSignInBody, {
          minutes: String(rule.windowMinutes),
          count: String(failures),
          time: text.time(now),
          timezone: text.timezone,
          url: this.url(),
        }),
        url: SETTINGS_PATH,
        occurredAt: now.toISOString(),
      });
    });
  }

  /** Completed login (password + second factor) that created a new session. */
  async signedIn(actor: Actor, client: Client) {
    const network = approximateIp(client.ip);
    const current = deviceKey(client.userAgent, network);
    const text = await this.messages(actor);
    await this.locked(actor, async (tx) => {
      const history = (
        await tx.execute(sql`SELECT host(ip) AS ip,user_agent FROM platform.audit_log
          WHERE actor_user_id=${actor.userId}::uuid AND action='auth.sign_in' AND outcome='success'
            AND occurred_at > now() - make_interval(days => ${SECURITY_RULES.newDevice.lookbackDays})`)
      ).rows.map((row) =>
        deviceKey(
          row.user_agent === null ? undefined : String(row.user_agent),
          row.ip === null ? undefined : approximateIp(String(row.ip)),
        ),
      );
      await this.options.audit.recordInTransaction(tx, actor, {
        action: "auth.sign_in",
        outcome: "success",
        resourceType: "user",
        resourceId: actor.userId,
        ...this.client(client),
      });
      if (classifyDevice(current, history) !== "new") return;
      const now = rowTime((await tx.execute(sql`SELECT now() AS now`)).rows[0]?.now);
      const alertId = await this.alert(tx, actor, "session.new_device", {}, client);
      const family = deviceFamily(client.userAgent);
      const label = (value: string) => (value === "other" ? text.messages.securityUnknown : value);
      await this.options.notify(`security-new-device-${alertId}`, {
        v: 1,
        userId: actor.userId,
        kind: "security",
        sourceRef: `security:new-device:${alertId}`,
        channels: ["email"],
        subject: text.messages.securityNewDeviceSubject,
        text: formatMessage(text.messages.securityNewDeviceBody, {
          time: text.time(now),
          timezone: text.timezone,
          device: `${label(family.browser)} / ${label(family.system)}`,
          network: network ?? text.messages.securityUnknown,
          url: this.url(),
        }),
        url: SETTINGS_PATH,
        occurredAt: now.toISOString(),
      });
    });
  }

  /** E-mail for the backup-code recovery flow (uwierzytelnianie-autoryzacja § 4). */
  async twoFactorRecovery(actor: Actor, event: SecurityRecoveryEvent) {
    const text = await this.messages(actor);
    const at = rowTime(event.occurredAt);
    const started = event.kind === "two_factor_recovery_started";
    const ref = `${started ? "started" : "completed"}:${actor.userId}:${at.getTime()}`;
    await this.options.notify(`security-recovery-${ref.replaceAll(":", "-")}`, {
      v: 1,
      userId: actor.userId,
      kind: "security",
      sourceRef: `security:recovery:${ref}`,
      channels: ["email"],
      subject: started
        ? text.messages.securityRecoveryStartedSubject
        : text.messages.securityRecoveredSubject,
      text: formatMessage(
        started ? text.messages.securityRecoveryStartedBody : text.messages.securityRecoveredBody,
        { time: text.time(at), timezone: text.timezone, url: this.url() },
      ),
      url: SETTINGS_PATH,
      occurredAt: at.toISOString(),
    });
  }

  /**
   * Extension point for BL-114 (GDPR export, not implemented yet). Call when an
   * export is requested; on an anomaly the caller must require a fresh step-up
   * before the download and administrators receive one e-mail per account per day.
   */
  async exportRequested(
    actor: Actor,
    client: Client,
  ): Promise<{ anomaly: MassExportReason | null; requireStepUp: boolean }> {
    const rule = SECURITY_RULES.massExport;
    const result = await this.locked(actor, async (tx) => {
      await this.options.audit.recordInTransaction(tx, actor, {
        action: "identity.export_requested",
        outcome: "success",
        resourceType: "user",
        resourceId: actor.userId,
        ...this.client(client),
      });
      const row = (
        await tx.execute(sql`SELECT now() AS now,
          count(*) FILTER (WHERE action='identity.export_requested'
            AND occurred_at > now() - interval '24 hours')::int AS exports,
          coalesce(bool_or(action='pat.create'
            AND occurred_at > now() - make_interval(mins => ${rule.combinationWindowMinutes})),false) AS pat,
          coalesce(bool_or(action='session.new_device'
            AND occurred_at > now() - make_interval(mins => ${rule.combinationWindowMinutes})),false) AS device,
          max(occurred_at) FILTER (WHERE action='security.mass_export') AS last_alert
          FROM platform.audit_log WHERE actor_user_id=${actor.userId}::uuid
            AND occurred_at > now() - make_interval(mins => ${Math.max(24 * 60, rule.cooldownMinutes)})`)
      ).rows[0];
      const now = rowTime(row?.now);
      const anomaly = massExportAnomaly({
        exportsLastDay: Number(row?.exports ?? 0),
        patCreatedRecently: row?.pat === true,
        newDeviceRecently: row?.device === true,
      });
      if (!anomaly) return { anomaly, alertId: null, now };
      const lastAlertAt = row?.last_alert ? rowTime(row.last_alert) : null;
      const due =
        lastAlertAt === null ||
        now.getTime() - lastAlertAt.getTime() >= rule.cooldownMinutes * 60_000;
      return {
        anomaly,
        alertId: due ? await this.alert(tx, actor, "security.mass_export", {}, client) : null,
        now,
      };
    });
    if (result.alertId)
      await this.notifyAdministrators(actor, result.anomaly, result.alertId, result.now);
    return { anomaly: result.anomaly, requireStepUp: result.anomaly !== null };
  }

  private async notifyAdministrators(
    actor: Actor,
    reason: MassExportReason | null,
    alertId: string,
    now: Date,
  ) {
    const administrators = await this.options.appDatabase.transaction(
      { userId: null, role: "system" },
      async (tx) =>
        (
          await tx.execute(
            sql`SELECT id::text,role FROM identity.user_directory WHERE role='admin' AND NOT banned ORDER BY id`,
          )
        ).rows,
    );
    for (const row of administrators) {
      const admin = { userId: z.uuid().parse(row.id), role: "admin" as const };
      const text = await this.messages(admin);
      await this.options.notify(`security-mass-export-${alertId}-${admin.userId}`, {
        v: 1,
        userId: admin.userId,
        kind: "security",
        sourceRef: `security:mass-export:${alertId}`,
        channels: ["email"],
        subject: text.messages.securityMassExportSubject,
        text: formatMessage(text.messages.securityMassExportBody, {
          account: actor.userId,
          reason:
            reason === "combination"
              ? text.messages.securityMassExportReasonCombination
              : text.messages.securityMassExportReasonVolume,
          time: text.time(now),
          timezone: text.timezone,
        }),
        url: "/",
        occurredAt: now.toISOString(),
      });
    }
  }

  private async alert(
    tx: DatabaseTransaction,
    actor: Actor,
    action: "security.failed_sign_in_series" | "session.new_device" | "security.mass_export",
    after: { count?: number },
    client?: Client,
  ): Promise<string> {
    await this.options.audit.recordInTransaction(tx, actor, {
      action,
      outcome: "success",
      resourceType: "user",
      resourceId: actor.userId,
      ...(client ? this.client(client) : {}),
      ...(after.count === undefined ? {} : { after: { count: after.count } }),
    });
    // Same transaction under the per-account advisory lock: the newest row is ours.
    // (INSERT ... RETURNING would be checked against the SELECT policy.)
    const row = (
      await tx.execute(
        sql`SELECT id::text FROM platform.audit_log WHERE actor_user_id=${actor.userId}::uuid AND action=${action} ORDER BY occurred_at DESC,id DESC LIMIT 1`,
      )
    ).rows[0];
    return z.uuid().parse(row?.id);
  }
}
