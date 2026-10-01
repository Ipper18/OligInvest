import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const entry = fileURLToPath(new URL("../dist/server.js", import.meta.url));
async function listen(server) {
  server.listen(0, "localhost");
  await once(server, "listening");
  return server.address().port;
}
const close = (server) => new Promise((resolve) => server.close(resolve));

test("Node entrypoint starts during outages and bounds actual TCP readiness probes", async () => {
  const sockets = new Set();
  const dependency = createServer((socket) => {
    sockets.add(socket);
    socket.on("data", () => {});
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
  });
  const dependencyPort = String(await listen(dependency));
  const reservation = createServer();
  const port = await listen(reservation);
  await close(reservation);
  const secret = randomBytes(32).toString("hex");
  const child = spawn(process.execPath, [entry], {
    env: {
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      NODE_ENV: "test",
      PUBLIC_BASE_URL: "https://invest.example",
      BETTER_AUTH_SECRETS: `0:${secret}`,
      AUDIT_PSEUDONYM_KEY: secret,
      DB_AUTH_PASSWORD: secret,
      DB_APP_PASSWORD: secret,
      VALKEY_QUEUE_API_PASSWORD: secret,
      VALKEY_CACHE_API_PASSWORD: secret,
      API_HOST: "localhost",
      API_PORT: String(port),
      DB_HOST: "localhost",
      DB_PORT: dependencyPort,
      DB_NAME: "synthetic",
      VALKEY_QUEUE_HOST: "localhost",
      VALKEY_QUEUE_PORT: dependencyPort,
      VALKEY_QUEUE_USER: "api",
      VALKEY_CACHE_HOST: "localhost",
      VALKEY_CACHE_PORT: dependencyPort,
      VALKEY_CACHE_USER: "api",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const exited = once(child, "exit");
  try {
    const base = `http://localhost:${port}/api/v1`;
    let live;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        live = await fetch(`${base}/health/live`, { signal: AbortSignal.timeout(500) });
        break;
      } catch {
        if (child.exitCode !== null) throw new Error("API exited before listening");
        await delay(25);
      }
    }
    expect(live?.status).toBe(200);
    await live.body.cancel();
    const id = randomUUID();
    const started = performance.now();
    const ready = await fetch(`${base}/health/ready`, {
      headers: { "X-Request-Id": id },
      signal: AbortSignal.timeout(4000),
    });
    expect(performance.now() - started).toBeLessThan(3500);
    expect(ready.status).toBe(503);
    expect(ready.headers.get("X-Request-Id")).toBe(id);
    expect(await ready.json()).toEqual({
      status: "fail",
      checks: { postgres: "fail", valkeyQueue: "fail", valkeyCache: "fail" },
    });
    const spec = await fetch(`${base}/openapi.json`);
    expect((await spec.json()).openapi).toBe("3.1.0");
    // Failed probes must release their sockets, including pg during its handshake.
    for (let attempt = 0; attempt < 40 && sockets.size; attempt++) await delay(25);
    expect(sockets.size).toBe(0);
    expect(output).not.toContain(secret);
    expect(output).not.toContain("synthetic");
  } finally {
    if (child.exitCode === null) child.kill();
    await exited;
    for (const socket of sockets) socket.destroy();
    await close(dependency);
  }
}, 10000);

test("startup errors contain no configuration values", async () => {
  const secret = randomBytes(32).toString("hex");
  const child = spawn(process.execPath, [entry], {
    env: { PUBLIC_BASE_URL: secret },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const [code] = await once(child, "exit");
  expect(code).toBe(1);
  expect(output).toContain("api.start.failed");
  expect(output).not.toContain(secret);
});
