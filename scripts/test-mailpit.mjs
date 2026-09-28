import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";

export async function testMailpit(host, smtpPort, httpPort) {
  const subject = `OligInvest synthetic ${randomUUID()}`;
  const socket = createConnection({ host, port: Number(smtpPort) });
  let pending;
  let buffer = "";
  let failure;
  const responses = [];
  socket.setEncoding("utf8");
  socket.setTimeout(3000, () => socket.destroy(new Error("SMTP timeout")));
  socket.on("error", (error) => {
    failure = error;
    pending?.reject(error);
  });
  socket.on("data", (data) => {
    buffer += data;
    while (buffer.includes("\r\n")) {
      const index = buffer.indexOf("\r\n");
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      if (/^\d{3} /u.test(line)) {
        if (pending) {
          const { accept } = pending;
          pending = undefined;
          accept(Number(line.slice(0, 3)));
        } else responses.push(Number(line.slice(0, 3)));
      }
    }
  });
  const response = () =>
    failure
      ? Promise.reject(failure)
      : responses.length
        ? Promise.resolve(responses.shift())
        : new Promise((accept, reject) => {
            pending = { accept, reject };
          });
  try {
    assert.equal(await response(), 220);
    for (const [command, expected] of [
      ["EHLO localhost", 250],
      ["MAIL FROM:<dev@example.invalid>", 250],
      ["RCPT TO:<dev@example.invalid>", 250],
      ["DATA", 354],
      [
        `From: dev@example.invalid\r\nTo: dev@example.invalid\r\nSubject: ${subject}\r\n\r\nSynthetic development test.\r\n.`,
        250,
      ],
      ["QUIT", 221],
    ]) {
      socket.write(`${command}\r\n`);
      assert.equal(await response(), expected);
    }
  } finally {
    socket.destroy();
  }
  const urlHost = host.includes(":") ? `[${host}]` : host;
  const messages = await (
    await fetch(`http://${urlHost}:${httpPort}/api/v1/messages`, {
      signal: AbortSignal.timeout(3000),
    })
  ).json();
  assert.ok(messages.messages.some((message) => message.Subject === subject));
}
