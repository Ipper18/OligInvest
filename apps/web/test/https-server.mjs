import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync } from "node:fs";
import { createServer } from "node:https";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import next from "next";

// Ephemeral self-signed TLS keeps the production upgrade-insecure-requests CSP intact.
const directory = mkdtempSync(fileURLToPath(new URL("../../../.git/e2e-tls-", import.meta.url)));
const key = join(directory, "key.pem");
const cert = join(directory, "cert.pem");
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
  const app = next({ dev: false, hostname: "127.0.0.1", port: 3197 });
  await app.prepare();
  const server = createServer(credentials, app.getRequestHandler());
  server.listen(3197, "127.0.0.1");
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
