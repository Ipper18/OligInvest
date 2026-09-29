import { createServer } from "node:http";

let lastRequest;
createServer((request, response) => {
  response.setHeader("Content-Type", "application/json");
  if (request.url === "/api/v1/health/live") {
    lastRequest = request.headers;
    response.end(JSON.stringify({ status: "ok" }));
  } else if (request.url === "/last-request") {
    response.end(JSON.stringify(lastRequest));
  } else {
    response.writeHead(404).end();
  }
}).listen(3198, "127.0.0.1");
