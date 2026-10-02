import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:https";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apiKey, defaultKeyHasher } from "@better-auth/api-key";
import { hash, hashSync, verify } from "@node-rs/argon2";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { symmetricDecrypt } from "better-auth/crypto";
import { toNodeHandler } from "better-auth/node";
import { twoFactor } from "better-auth/plugins";

const options = { memoryCost: 19456, timeCost: 2, parallelism: 1, algorithm: 2 };
const password = randomBytes(24).toString("hex");
const timings = [];
const syncTimings = [];
const encodings = new Set();
for (let index = 0; index < 12; index++) {
  const start = performance.now();
  const encoded = await hash(password, options);
  if (index >= 2) timings.push(performance.now() - start);
  assert.match(encoded, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/u);
  assert.equal(await verify(encoded, password), true);
  assert.equal(await verify(encoded, `${password}-wrong`), false);
  encodings.add(encoded);
  const syncStart = performance.now();
  const syncEncoded = hashSync(password, options);
  if (index >= 2) syncTimings.push(performance.now() - syncStart);
  assert.match(syncEncoded, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/u);
  assert.equal(await verify(syncEncoded, password), true);
}
assert.equal(encodings.size, 12, "Every hash must use a fresh salt");
function median(values) {
  const sorted = values.toSorted((a, b) => a - b);
  return ((sorted[4] + sorted[5]) / 2).toFixed(1);
}
console.log(
  `Argon2id full hash, 10 samples after 2 warmups: async median ${median(timings)} ms, sync median ${median(syncTimings)} ms; PHC and fresh salts verified; server calibration remains owner-run`,
);
if (process.argv.includes("--benchmark-only")) process.exit(0);

const requireWeb = createRequire(new URL("../../web/package.json", import.meta.url));
const { chromium, firefox, webkit } = requireWeb("@playwright/test");
const directory = mkdtempSync(join(tmpdir(), "oliginvest-auth-spike-"));
const key = join(directory, "key.pem");
const cert = join(directory, "cert.pem");
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
    "subjectAltName=DNS:localhost",
  ],
  { stdio: "ignore" },
);

function decodeSecret(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.toUpperCase().replace(/=+$/u, "")]
    .map((c) => alphabet.indexOf(c).toString(2).padStart(5, "0"))
    .join("");
  const bytes = Buffer.from(bits.match(/.{8}/gu).map((b) => Number.parseInt(b, 2)));
  return bytes;
}

function code(secret) {
  const bytes = decodeSecret(secret);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hmac = createHmac("sha1", bytes).update(counter).digest();
  return String((hmac.readUInt32BE(hmac[19] & 15) & 0x7fffffff) % 1000000).padStart(6, "0");
}

try {
  for (const browserType of [chromium, firefox, webkit]) {
    const database = {
      user: [],
      session: [],
      account: [],
      verification: [],
      twoFactor: [],
      apikey: [],
    };
    let auth;
    const server = createServer(
      { key: readFileSync(key), cert: readFileSync(cert) },
      (request, response) => {
        if (request.url === "/") {
          response.setHeader("content-type", "text/html");
          response.end(
            "<!doctype html><html lang=en><title>Auth spike</title><body>Local synthetic auth probe</body></html>",
          );
        } else void toNodeHandler(auth)(request, response);
      },
    );
    await new Promise((accept) => server.listen(0, "localhost", accept));
    const origin = `https://localhost:${server.address().port}`;
    auth = betterAuth({
      baseURL: origin,
      secret: randomBytes(32).toString("hex"),
      database: memoryAdapter(database),
      emailAndPassword: {
        enabled: true,
        password: {
          hash: (value) => hash(value, options),
          verify: ({ hash: encoded, password: value }) => verify(encoded, value),
        },
      },
      advanced: {
        useSecureCookies: false,
        defaultCookieAttributes: { secure: true, httpOnly: true, sameSite: "lax", path: "/" },
        cookies: Object.fromEntries(
          [
            "session_token",
            "dont_remember",
            "two_factor",
            "session_data",
            "account_data",
            "trust_device",
          ].map((name) => [name, { name: `__Host-oliginvest.${name}` }]),
        ),
      },
      session: { cookieCache: { enabled: false } },
      plugins: [twoFactor({ backupCodeOptions: { storeBackupCodes: "encrypted" } }), apiKey()],
      logger: { disabled: true },
    });
    let browser;
    try {
      browser = await browserType.launch();
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      const cookieHeaders = [];
      const responses = [];
      page.on("response", (response) => {
        responses.push(
          response
            .headersArray()
            .then((headers) =>
              cookieHeaders.push(
                ...headers.filter((h) => h.name.toLowerCase() === "set-cookie").map((h) => h.value),
              ),
            ),
        );
      });
      await page.goto(origin);
      const post = async (path, body) => {
        const result = await page.evaluate(
          async ({ path, body }) => {
            const response = await fetch(`/api/auth${path}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            return { status: response.status, body: await response.json() };
          },
          { path, body },
        );
        assert.equal(result.status, 200, `${path}: ${result.body.code ?? "HTTP failure"}`);
        return result.body;
      };
      const email = `${browserType.name()}@example.test`;
      await post("/sign-up/email", { name: "Synthetic", email, password });
      const enabled = await post("/two-factor/enable", { password });
      const secret = new URL(enabled.totpURI).searchParams.get("secret");
      await post("/two-factor/verify-totp", { code: code(secret) });
      const stored = database.twoFactor[0];
      assert.ok(stored);
      assert.notEqual(stored.secret, secret);
      const secretConfig = (await auth.$context).secretConfig;
      assert.equal(
        await symmetricDecrypt({ key: secretConfig, data: stored.secret }),
        decodeSecret(secret).toString(),
      );
      assert.deepEqual(
        JSON.parse(await symmetricDecrypt({ key: secretConfig, data: stored.backupCodes })),
        enabled.backupCodes,
      );
      assert.ok(enabled.backupCodes.every((value) => !stored.backupCodes.includes(value)));
      const token = await post("/api-key/create", { name: "spike" });
      assert.ok(database.apikey.some((item) => item.key !== token.key));
      assert.equal(database.apikey[0].key, await defaultKeyHasher(token.key));
      await post("/sign-out", {});
      assert.equal((await post("/sign-in/email", { email, password })).twoFactorRedirect, true);
      await post("/two-factor/verify-totp", { code: code(secret) });
      await post("/sign-out", {});
      assert.equal((await post("/sign-in/email", { email, password })).twoFactorRedirect, true);
      await post("/two-factor/verify-backup-code", { code: enabled.backupCodes[0] });
      const remaining = JSON.parse(
        await symmetricDecrypt({ key: secretConfig, data: database.twoFactor[0].backupCodes }),
      );
      assert.equal(remaining.length, enabled.backupCodes.length - 1);
      assert.ok(!remaining.includes(enabled.backupCodes[0]));
      await post("/sign-out", {});
      await Promise.all(responses);
      assert.ok(cookieHeaders.length > 5);
      for (const header of cookieHeaders) {
        assert.match(header, /^__Host-oliginvest\./u);
        assert.match(header, /; Secure(?:;|$)/iu);
        assert.match(header, /; HttpOnly(?:;|$)/iu);
        assert.match(header, /; Path=\/(?:;|$)/iu);
        assert.doesNotMatch(header, /; Domain=/iu);
      }
      assert.ok(!(await context.cookies()).some((cookie) => cookie.name.endsWith("session_token")));
      console.log(
        `${browserType.name()}: __Host cookies, enrollment, login, backup-code consumption, logout and encrypted/hashed storage PASS`,
      );
    } finally {
      await browser?.close();
      server.closeAllConnections();
      await new Promise((accept) => server.close(accept));
    }
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
