import { createServer } from "node:http";
import { uiFixture } from "./ui-fixture.mjs";

let lastRequest;
const logoutGates = new Map();
createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json");
  // Hold the real upstream response: page.route is not reliable on SW-controlled WebKit pages.
  const gateKey = /^\/logout-gates\/(fixture-[\w-]+)$/.exec(request.url ?? "")?.[1];
  if (gateKey) {
    if (request.method === "POST") {
      const gate = { arrived: false };
      gate.wait = new Promise((resolve) => {
        gate.release = resolve;
      });
      logoutGates.set(gateKey, gate);
    } else if (request.method === "DELETE") {
      logoutGates.get(gateKey)?.release();
      logoutGates.delete(gateKey);
    }
    response.end(JSON.stringify({ arrived: logoutGates.get(gateKey)?.arrived ?? false }));
    return;
  }
  if (request.url === "/api/auth/sign-out") {
    const key = /\b__Host-oliginvest\.session_token=(fixture-[\w-]+)/u.exec(
      request.headers.cookie ?? "",
    )?.[1];
    const gate = logoutGates.get(key);
    if (gate) {
      gate.arrived = true;
      await gate.wait;
    }
  }
  if (request.url === "/api/v1/health/live") {
    lastRequest = request.headers;
    if (process.env.E2E_API_URL) {
      // Record forwarding assertions, then exercise the real production API in CI.
      try {
        const result = await fetch(`${process.env.E2E_API_URL}/api/v1/health/live`, {
          headers: request.headers,
          signal: AbortSignal.timeout(2000),
        });
        response.writeHead(result.status).end(await result.text());
      } catch {
        response.writeHead(502).end();
      }
    } else {
      response.end(JSON.stringify({ status: "ok" }));
    }
  } else if (request.url === "/last-request") {
    response.end(JSON.stringify(lastRequest));
  } else {
    if (!(await uiFixture(request, response))) response.writeHead(404).end();
  }
}).listen(3198, "127.0.0.1");
