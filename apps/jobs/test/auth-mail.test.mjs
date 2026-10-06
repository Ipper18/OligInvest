import { once } from "node:events";
import { createServer } from "node:net";
import { expect, test } from "vitest";
import {
  createAuthMailer,
  invitationMail,
  mailOptions,
  passwordResetMail,
  twoFactorResetMail,
} from "../dist/auth-mail.js";

const config = {
  SMTP_HOST: "smtp-relay.brevo.com",
  SMTP_USER: "synthetic-user",
  SMTP_PASSWORD: "synthetic-password",
  SMTP_FROM: "sender@example.test",
  PUBLIC_BASE_URL: "https://example.test",
};
const message = {
  email: "recipient@example.test",
  token: "synthetic-reset-token",
  issuedAt: new Date().toISOString(),
};

test("invitation carries the fragment token and controller notice; break-glass mail has no secrets", () => {
  const data = {
    email: message.email,
    token: "a".repeat(43),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    inviterName: "Synthetic Inviter",
  };
  const settings = { ...config, LEGAL_CONTROLLER_NAME: "Synthetic Controller" };
  const mail = invitationMail(data, settings);
  expect(mail.text).toContain(`/rejestracja#t=${data.token}`);
  expect(mail.text).toContain(settings.LEGAL_CONTROLLER_NAME);
  expect(() => invitationMail(data, settings, Date.parse(data.expiresAt))).toThrow();
  expect(() => invitationMail(data, config)).toThrow();
  const reset = { email: message.email, issuedAt: message.issuedAt };
  expect(twoFactorResetMail(reset, config).text).toContain(message.issuedAt);
  expect(() => twoFactorResetMail({ ...reset, token: "secret" }, config)).toThrow();
  expect(() => twoFactorResetMail(reset, config, Date.parse(reset.issuedAt) + 86400001)).toThrow();
});

test("reset token is only in the fragment, payload is strict and expired messages are rejected", () => {
  const mail = passwordResetMail(message, config.PUBLIC_BASE_URL, config.SMTP_FROM);
  const link = new URL(mail.text.match(/https:\/\/[^\s]+/u)[0]);
  expect(link.pathname).toBe("/reset-hasla/nowe");
  expect(link.search).toBe("");
  expect(link.hash).toBe(`#t=${message.token}`);
  for (const data of [
    { ...message, url: "https://untrusted.test" },
    { ...message, token: "bad\r\nheader" },
    { ...message, email: "invalid" },
  ])
    expect(() => passwordResetMail(data, config.PUBLIC_BASE_URL, config.SMTP_FROM)).toThrow();
  expect(() =>
    passwordResetMail(
      message,
      config.PUBLIC_BASE_URL,
      config.SMTP_FROM,
      Date.parse(message.issuedAt) + 1_800_000,
    ),
  ).toThrow("AUTH_MAIL_EXPIRED");
});

test("production SMTP requires Brevo STARTTLS with certificate verification", () => {
  expect(mailOptions(config, "production", 587)).toMatchObject({
    requireTLS: true,
    ignoreTLS: false,
    tls: { rejectUnauthorized: true },
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  expect(() => mailOptions({ ...config, SMTP_HOST: "other.test" }, "production", 587)).toThrow();
  expect(() => mailOptions(config, "production", 1025)).toThrow();
  expect(() => mailOptions({ ...config, SMTP_FROM: undefined }, "production", 587)).toThrow();
});

test("nodemailer delivers a synthetic message over SMTP without external traffic", async () => {
  const messages = [];
  const sockets = new Set();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.setEncoding("utf8");
    socket.write("220 synthetic SMTP\r\n");
    let buffer = "",
      data = false,
      content = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
      while (buffer.includes("\r\n")) {
        const at = buffer.indexOf("\r\n");
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        if (data) {
          if (line === ".") {
            messages.push(content);
            data = false;
            socket.write("250 accepted\r\n");
          } else content += `${line}\r\n`;
        } else if (line.startsWith("EHLO")) socket.write("250-synthetic\r\n250 8BITMIME\r\n");
        else if (line === "DATA") {
          data = true;
          socket.write("354 send data\r\n");
        } else if (line === "QUIT") socket.end("221 bye\r\n");
        else socket.write("250 ok\r\n");
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const mailer = createAuthMailer(
    { ...config, SMTP_HOST: "127.0.0.1" },
    "test",
    server.address().port,
  );
  try {
    await mailer.send("auth.password-reset", message);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("recipient@example.test");
    const decoded = messages[0]
      .replaceAll("=\r\n", "")
      .replace(/=([0-9A-F]{2})/gu, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
    expect(decoded).toContain("https://example.test/reset-hasla/nowe#t=synthetic-reset-token");
    expect(messages[0]).not.toContain("synthetic-password");
    await expect(mailer.send("unrecognized-job", message)).rejects.toThrow("AUTH_MAIL_INVALID");
  } finally {
    mailer.close();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
});
