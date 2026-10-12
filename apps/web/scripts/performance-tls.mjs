import { execFileSync } from "node:child_process";
import { createHash, createPublicKey } from "node:crypto";
import { mkdtempSync, readFileSync, rmdirSync, rmSync } from "node:fs";
import { request as proxyRequest } from "node:http";
import { createSecureServer } from "node:http2";
import { request as tlsRequest } from "node:https";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

let localOrigin, fingerprint;
export const localChromeFlags = () =>
  fingerprint ? [`--ignore-certificate-errors-spki-list=${fingerprint}`] : [];
export async function startPerformanceProxy(nextOrigin, apiOrigin) {
  const directory = mkdtempSync(fileURLToPath(new URL("../../../.git/perf-tls-", import.meta.url)));
  const key = join(directory, "key.pem"),
    cert = join(directory, "cert.pem");
  let credentials;
  try {
    execFileSync(
      process.platform === "win32" ? "C:/Program Files/Git/usr/bin/openssl.exe" : "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        key,
        "-out",
        cert,
        "-days",
        "1",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=IP:127.0.0.1,DNS:localhost",
      ],
      { stdio: "ignore" },
    );
    credentials = { key: readFileSync(key), cert: readFileSync(cert) };
  } finally {
    for (const file of [key, cert]) rmSync(file, { force: true });
    rmdirSync(directory);
  }
  fingerprint = createHash("sha256")
    .update(createPublicKey(credentials.cert).export({ type: "spki", format: "der" }))
    .digest("base64");
  const forbidden = new Set([
    "connection",
    "keep-alive",
    "proxy-connection",
    "transfer-encoding",
    "upgrade",
  ]);
  const sessions = new Set();
  const sockets = new Set();
  const server = createSecureServer({ ...credentials, allowHTTP1: true }, (request, response) => {
    const headers = Object.fromEntries(
      Object.entries(request.headers).filter(([k]) => !k.startsWith(":") && !forbidden.has(k)),
    );
    headers.host = new URL(nextOrigin).host;
    const upstream = proxyRequest(
      new URL(request.url, request.url.startsWith("/api/") ? apiOrigin : nextOrigin),
      { method: request.method, headers },
      (reply) => {
        response.writeHead(
          reply.statusCode,
          Object.fromEntries(Object.entries(reply.headers).filter(([k]) => !forbidden.has(k))),
        );
        reply.pipe(response);
      },
    );
    upstream.on("error", () => {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    });
    response.on("close", () => upstream.destroy());
    request.pipe(upstream);
  });
  server.on("session", (session) => {
    sessions.add(session);
    session.on("close", () => sessions.delete(session));
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  localOrigin = `https://127.0.0.1:${server.address().port}`;
  return {
    origin: localOrigin,
    close: async () => {
      localOrigin = undefined;
      fingerprint = undefined;
      for (const session of sessions) session.destroy();
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
export function fetchLocalFixture(url, cookie) {
  if (new URL(url).origin !== localOrigin) return null;
  return new Promise((resolve, reject) => {
    const request = tlsRequest(
      url,
      { rejectUnauthorized: false, headers: cookie ? { Cookie: cookie } : {} },
      (reply) => {
        const chunks = [];
        reply.on("data", (chunk) => chunks.push(chunk));
        reply.on("end", () =>
          resolve(
            new Response(Buffer.concat(chunks), {
              status: reply.statusCode,
              headers: reply.headers,
            }),
          ),
        );
        reply.on("error", reject);
      },
    );
    request.setTimeout(15000, () =>
      request.destroy(new Error("Local performance response timed out")),
    );
    request.on("error", reject);
    request.end();
  });
}
