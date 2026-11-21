import { isIP } from "node:net";
import type { ServiceConfig } from "@oliginvest/config";
import {
  accountBlockedMailSchema,
  authMailSchema,
  emailChangedMailSchema,
  invitationMailSchema,
  twoFactorResetMailSchema,
} from "@oliginvest/contracts";
import { authMailMessages as defaultAuthMailMessages, formatMessage } from "@oliginvest/i18n";
import { copies } from "@oliginvest/i18n/en";
import nodemailer from "nodemailer";
import { z } from "zod";

export function mailOptions(
  config: ServiceConfig<"jobs">,
  mode: "development" | "test" | "production",
  port: number,
) {
  if (!config.SMTP_HOST || !config.SMTP_USER || !config.SMTP_PASSWORD || !config.SMTP_FROM)
    throw new Error("SMTP_NOT_CONFIGURED");
  if (mode === "production" && (config.SMTP_HOST !== "smtp-relay.brevo.com" || port !== 587))
    throw new Error("SMTP_NOT_ALLOWED");
  if (
    mode !== "production" &&
    !(
      config.SMTP_HOST === "localhost" ||
      config.SMTP_HOST === "::1" ||
      (isIP(config.SMTP_HOST) === 4 && config.SMTP_HOST.startsWith("127."))
    )
  )
    throw new Error("SMTP_NOT_ALLOWED");
  return {
    host: config.SMTP_HOST,
    port: z.number().int().min(1).max(65535).parse(port),
    secure: false,
    requireTLS: mode === "production",
    ignoreTLS: mode !== "production",
    ...(mode === "production"
      ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } }
      : {}),
    tls: { minVersion: "TLSv1.2" as const, rejectUnauthorized: true },
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

export function passwordResetMail(input: unknown, origin: string, from: string, now = Date.now()) {
  const data = authMailSchema.parse(input);
  const authMailMessages =
    data.locale === "en-US" ? copies.authMailMessages : defaultAuthMailMessages;
  const age = now - Date.parse(data.issuedAt);
  if (age < 0 || age >= 30 * 60_000) throw new Error("AUTH_MAIL_EXPIRED");
  const url = new URL("/reset-hasla/nowe", origin);
  url.hash = `t=${data.token}`;
  return {
    from: { name: "OligInvest", address: z.email().parse(from) },
    to: { address: data.email, name: "" },
    subject: authMailMessages.passwordResetSubject,
    text: formatMessage(authMailMessages.passwordResetBody, { url: url.href }),
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

export function createAuthMailer(
  config: ServiceConfig<"jobs">,
  mode: "development" | "test" | "production",
  port: number,
  reserve: (security: boolean) => Promise<void> = async () => {
    throw new Error("MAIL_QUOTA_NOT_CONFIGURED");
  },
) {
  const transport = nodemailer.createTransport(mailOptions(config, mode, port));
  return {
    sendReport: async (email: string, subject: string, text: string) => {
      await reserve(false);
      try {
        await transport.sendMail({
          from: config.SMTP_FROM,
          to: z.email().parse(email),
          subject,
          text,
          disableFileAccess: true,
          disableUrlAccess: true,
        });
      } catch {
        throw new Error("REPORT_DELIVERY_FAILED");
      }
    },
    send: async (name: string, input: unknown) => {
      if (
        ![
          "auth.password-reset",
          "auth.invitation",
          "auth.two-factor-reset",
          "auth.email-changed",
          "auth.account-blocked",
        ].includes(name) ||
        !config.SMTP_FROM
      )
        throw new Error("AUTH_MAIL_INVALID");
      const message =
        name === "auth.password-reset"
          ? passwordResetMail(input, config.PUBLIC_BASE_URL, config.SMTP_FROM)
          : name === "auth.invitation"
            ? invitationMail(input, config)
            : name === "auth.email-changed"
              ? emailChangedMail(input, config)
              : name === "auth.account-blocked"
                ? accountBlockedMail(input, config)
                : twoFactorResetMail(input, config);
      await reserve(true);
      try {
        await transport.sendMail(message);
      } catch {
        // BullMQ persists errors; never put SMTP replies, addresses or tokens in them.
        throw new Error("AUTH_MAIL_DELIVERY_FAILED");
      }
    },
    sendNotification: async (email: string, subject: string, text: string, security = false) => {
      const recipient = z.email().parse(email);
      await reserve(security);
      try {
        await transport.sendMail({
          from: config.SMTP_FROM,
          to: recipient,
          subject,
          text,
          disableFileAccess: true,
          disableUrlAccess: true,
        });
      } catch {
        throw new Error("NOTIFICATION_DELIVERY_FAILED");
      }
    },
    close: () => transport.close(),
  };
}

export function twoFactorResetMail(
  input: unknown,
  config: ServiceConfig<"jobs">,
  now = Date.now(),
) {
  const data = twoFactorResetMailSchema.parse(input);
  const authMailMessages =
    data.locale === "en-US" ? copies.authMailMessages : defaultAuthMailMessages;
  if (
    Date.parse(data.issuedAt) > now ||
    now - Date.parse(data.issuedAt) > 86400_000 ||
    !config.SMTP_FROM
  )
    throw new Error("AUTH_MAIL_EXPIRED");
  return {
    from: { name: "OligInvest", address: config.SMTP_FROM },
    to: { address: data.email, name: "" },
    subject: authMailMessages.twoFactorResetSubject,
    text: formatMessage(authMailMessages.twoFactorResetBody, {
      issuedAt: data.issuedAt,
      privacyUrl: new URL("/prywatnosc", config.PUBLIC_BASE_URL).href,
    }),
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

/** BL-509: an administrator changed the sign-in address; one message to each address. */
export function emailChangedMail(input: unknown, config: ServiceConfig<"jobs">, now = Date.now()) {
  const data = emailChangedMailSchema.parse(input);
  const messages = data.locale === "en-US" ? copies.authMailMessages : defaultAuthMailMessages;
  if (
    Date.parse(data.issuedAt) > now ||
    now - Date.parse(data.issuedAt) > 86400_000 ||
    !config.SMTP_FROM
  )
    throw new Error("AUTH_MAIL_EXPIRED");
  const previous = data.audience === "previous";
  return {
    from: { name: "OligInvest", address: config.SMTP_FROM },
    to: { address: data.email, name: "" },
    subject: previous ? messages.emailChangedPreviousSubject : messages.emailChangedCurrentSubject,
    text: formatMessage(
      previous ? messages.emailChangedPreviousBody : messages.emailChangedCurrentBody,
      { other: data.otherEmailMasked, issuedAt: data.issuedAt },
    ),
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

/** BL-509, regulamin § 4 ust. 4: block or its end, in the account's language. */
export function accountBlockedMail(
  input: unknown,
  config: ServiceConfig<"jobs">,
  now = Date.now(),
) {
  const data = accountBlockedMailSchema.parse(input);
  const messages = data.locale === "en-US" ? copies.authMailMessages : defaultAuthMailMessages;
  if (
    Date.parse(data.issuedAt) > now ||
    now - Date.parse(data.issuedAt) > 86400_000 ||
    !config.SMTP_FROM
  )
    throw new Error("AUTH_MAIL_EXPIRED");
  const blocked = data.state === "blocked";
  return {
    from: { name: "OligInvest", address: config.SMTP_FROM },
    to: { address: data.email, name: "" },
    subject: blocked ? messages.accountBlockedSubject : messages.accountUnblockedSubject,
    text: formatMessage(
      blocked
        ? data.until
          ? messages.accountBlockedUntilBody
          : messages.accountBlockedBody
        : messages.accountUnblockedBody,
      {
        issuedAt: data.issuedAt,
        until: data.until ?? "",
        termsUrl: new URL("/regulamin", config.PUBLIC_BASE_URL).href,
      },
    ),
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

export function invitationMail(input: unknown, config: ServiceConfig<"jobs">, now = Date.now()) {
  const data = invitationMailSchema.parse(input);
  const authMailMessages = defaultAuthMailMessages;
  if (Date.parse(data.expiresAt) <= now) throw new Error("AUTH_MAIL_EXPIRED");
  if (!config.SMTP_FROM || !config.LEGAL_CONTROLLER_NAME)
    throw new Error("INVITATION_MAIL_NOT_CONFIGURED");
  const url = new URL("/rejestracja", config.PUBLIC_BASE_URL);
  url.hash = `t=${data.token}`;
  return {
    from: { name: "OligInvest", address: config.SMTP_FROM },
    to: { address: data.email, name: "" },
    subject: authMailMessages.invitationSubject,
    text: formatMessage(authMailMessages.invitationBody, {
      inviter: data.inviterName,
      controller: config.LEGAL_CONTROLLER_NAME,
      privacyUrl: new URL("/prywatnosc", config.PUBLIC_BASE_URL).href,
      expiresAt: data.expiresAt,
      url: url.href,
    }),
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}
