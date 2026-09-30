import { createServer } from "node:http";

let lastRequest;
createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json");
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
    response.writeHead(404).end();
  }
}).listen(3198, "127.0.0.1");
