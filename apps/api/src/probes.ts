import { createConnection } from "node:net";
import pg from "pg";
import { z } from "zod";

const HEALTH_TIMEOUT_MS = 1500;
type PostgresOptions = Readonly<{
  host: string;
  port: number;
  database: string;
  password: string;
  ssl: boolean;
}>;
type ValkeyOptions = Readonly<{ host: string; port: number; user: string; password: string }>;
const queryResultSchema = z.object({ ok: z.literal(1) }).strict();

/** Dedicated, short-lived connection: no user tables, session settings or shared pool. */
export function checkPostgres(
  options: PostgresOptions,
  timeoutMs = HEALTH_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = new pg.Client({
      ...options,
      user: "oliginvest_app",
      options: "",
      ssl: options.ssl ? { rejectUnauthorized: true } : false,
      connectionTimeoutMillis: timeoutMs,
      query_timeout: timeoutMs,
    });
    let finished = false;
    const finish = (ok: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      void client.end().catch(() => {});
      if (ok) resolve();
      else reject(new Error("Dependency unavailable"));
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    client.on("error", () => finish(false));
    void (async () => {
      await client.connect();
      if (finished) return;
      const result = await client.query("SELECT 1 AS ok");
      finish(result.rows.length === 1 && queryResultSchema.safeParse(result.rows[0]).success);
    })().catch(() => finish(false));
  });
}

function command(parts: readonly string[]): string {
  return `*${parts.length}\r\n${parts.map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`).join("")}`;
}

/** Only the two expected RESP simple strings are accepted; this is not a general client. */
export function checkValkey(options: ValkeyOptions, timeoutMs = HEALTH_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: options.host, port: options.port });
    const expected = Buffer.from("+OK\r\n+PONG\r\n");
    let received = Buffer.alloc(0);
    let finished = false;
    const finish = (ok: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.destroy();
      if (ok) resolve();
      else reject(new Error("Dependency unavailable"));
    };
    // Absolute deadline, including DNS/connect and trickled response bytes.
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.on("error", () => finish(false));
    socket.on("close", () => finish(false));
    socket.on("end", () => finish(false));
    socket.once("connect", () => {
      socket.write(command(["AUTH", options.user, options.password]) + command(["PING"]));
    });
    socket.on("data", (chunk: Buffer) => {
      if (received.length + chunk.length > expected.length) return finish(false);
      received = Buffer.concat([received, chunk]);
      if (!expected.subarray(0, received.length).equals(received)) return finish(false);
      if (received.length === expected.length) finish(true);
    });
  });
}
