import { spawn } from "node:child_process";
import { appendFileSync, closeSync, openSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

export const webDirectory = fileURLToPath(new URL("../", import.meta.url));
export const readJson = (path) => JSON.parse(readFileSync(resolve(webDirectory, path), "utf8"));
export const isMain = (url) => process.argv[1] && resolve(process.argv[1]) === fileURLToPath(url);
export function report(markdown) {
  console.log(markdown);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
}

export async function fetchChecked(url, { cookie = "", type = "text/html" } = {}) {
  const response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
    headers: cookie ? { Cookie: cookie } : {},
  });
  if (response.status !== 200 || !response.headers.get("content-type")?.includes(type))
    throw new Error(`Invalid performance response (${response.status}, expected ${type})`);
  return response;
}

// M0 has only a health endpoint; real authenticated fixtures belong to M1.
export async function withPerformanceServer(run) {
  if (process.env.BASE_URL) return run(new URL(process.env.BASE_URL).origin);
  const fixture = createServer((request, response) => {
    if (request.url !== "/api/v1/health/live") return response.writeHead(404).end();
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ status: "ok" }));
  });
  await new Promise((accept) => fixture.listen(0, "127.0.0.1", accept));
  const reservation = createServer();
  await new Promise((accept) => reservation.listen(0, "127.0.0.1", accept));
  const port = reservation.address().port;
  await new Promise((accept) => reservation.close(accept));
  const origin = `http://127.0.0.1:${port}`;
  const log = openSync(resolve(webDirectory, "../../.git/bl016-next.log"), "a");
  const child = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: webDirectory,
      windowsHide: true,
      stdio: ["ignore", log, log],
      env: {
        ...process.env,
        NODE_ENV: "production",
        NEXT_TELEMETRY_DISABLED: "1",
        PUBLIC_BASE_URL: origin,
        API_INTERNAL_URL: `http://127.0.0.1:${fixture.address().port}`,
      },
    },
  );
  closeSync(log);
  let spawnError;
  child.on("error", (error) => {
    spawnError = error;
  });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (spawnError || child.exitCode !== null)
        throw new Error("next start failed; inspect .git/bl016-next.log");
      try {
        await fetchChecked(origin);
        ready = true;
        break;
      } catch {
        await delay(250);
      }
    }
    if (!ready) throw new Error("next start timed out; inspect .git/bl016-next.log");
    return await run(origin);
  } finally {
    if (child.exitCode === null) {
      const exited = new Promise((accept) => child.once("exit", accept));
      child.kill();
      await Promise.race([exited, delay(3000)]);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
    fixture.closeAllConnections();
    await new Promise((accept) => fixture.close(accept));
  }
}
