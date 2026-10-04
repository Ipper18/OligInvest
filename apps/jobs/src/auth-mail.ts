import type { ServiceConfig } from "@oliginvest/config";
import { authMailSchema } from "@oliginvest/contracts";
import { authMailMessages, formatMessage } from "@oliginvest/i18n";
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
) {
  const transport = nodemailer.createTransport(mailOptions(config, mode, port));
  return {
    send: async (name: string, input: unknown) => {
      if (name !== "auth.password-reset" || !config.SMTP_FROM) throw new Error("AUTH_MAIL_INVALID");
      const message = passwordResetMail(input, config.PUBLIC_BASE_URL, config.SMTP_FROM);
      try {
        await transport.sendMail(message);
      } catch {
        // BullMQ persists errors; never put SMTP replies, addresses or tokens in them.
        throw new Error("AUTH_MAIL_DELIVERY_FAILED");
      }
    },
    close: () => transport.close(),
  };
}
