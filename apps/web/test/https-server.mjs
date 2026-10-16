import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync } from "node:fs";
import { request as proxyRequest } from "node:http";
import { createServer } from "node:https";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import next from "next";
import { uiFixture } from "./ui-fixture.mjs";

// Ephemeral self-signed TLS keeps the production upgrade-insecure-requests CSP intact.
const directory = mkdtempSync(fileURLToPath(new URL("../../../.git/e2e-tls-", import.meta.url)));
const key = join(directory, "key.pem");
const cert = join(directory, "cert.pem");
const port = Number(process.env.E2E_WEB_PORT ?? 3197);
const openssl =
  process.platform === "win32" ? "C:/Program Files/Git/usr/bin/openssl.exe" : "openssl";
try {
  execFileSync(
    openssl,
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
  const credentials = { key: readFileSync(key), cert: readFileSync(cert) };
  const app = next({ dev: false, hostname: "127.0.0.1", port });
  await app.prepare();
  const handler = app.getRequestHandler();
  const server = createServer(credentials, async (request, response) => {
    if (process.env.E2E_REAL_API && request.url?.startsWith("/api/")) {
      const target = new URL(request.url, process.env.E2E_REAL_API);
      const upstream = proxyRequest(
        target,
        { method: request.method, headers: request.headers },
        (result) => {
          response.writeHead(result.statusCode ?? 502, result.headers);
          result.pipe(response);
        },
      );
      upstream.on("error", () => response.writeHead(502).end());
      response.on("close", () => upstream.destroy());
      request.pipe(upstream);
    } else if (request.url?.startsWith("/api/v1/stream")) await uiFixture(request, response);
    else await handler(request, response);
  });
  server.listen(port, "127.0.0.1");
  for (const signal of ["SIGTERM", "SIGINT"])
    process.once(signal, () => {
      server.closeAllConnections();
      server.close(() => {
        void app.close();
      });
    });
} finally {
  cleanup();
}

function cleanup() {
  for (const path of [key, cert]) {
    try {
      unlinkSync(path);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  rmdirSync(directory);
}
