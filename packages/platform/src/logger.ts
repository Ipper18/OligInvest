import pino, { type DestinationStream } from "pino";
import { z } from "zod";

const entrySchema = z
  .object({
    event: z.string().regex(/^[a-z][a-z0-9_.-]{0,79}$/u),
    request_id: z.uuid().optional(),
    user_id: z.uuid().optional(),
    module_id: z
      .string()
      .regex(/^[a-z][a-z0-9-]*$/u)
      .optional(),
    route: z
      .string()
      .regex(/^\/[a-zA-Z0-9_/:.*{}-]*$/u)
      .max(200)
      .optional(),
    status: z.number().int().min(100).max(599).optional(),
    duration_ms: z.number().nonnegative().finite().optional(),
    code: z
      .string()
      .regex(/^[A-Z_]+$/u)
      .max(80)
      .optional(),
    email: z.email().optional(),
  })
  .strict();
export type LogEntry = z.input<typeof entrySchema>;
export interface PlatformLogger {
  info(entry: LogEntry): void;
  warn(entry: LogEntry): void;
  error(entry: LogEntry): void;
}
const REDACT_PATHS = [
  "password",
  "token",
  "secret",
  "totp",
  "backupCodes",
  "authorization",
  "cookie",
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers['set-cookie']",
  "req.body",
  "body",
  "payload",
  "files",
  "notes",
  "journal",
  "amount",
  "quantity",
  "price",
  "*.password",
  "*.token",
  "*.secret",
  "*.amount",
  "*.quantity",
  "*.price",
  "err",
];
function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  const suffix = domain.slice(domain.lastIndexOf("."));
  return `${local.slice(0, 1)}***@${domain.slice(0, 1)}***${suffix}`;
}

/** Accept only structured metadata; never expose Pino's arbitrary message/child APIs. */
export function createLogger(destination?: DestinationStream): PlatformLogger {
  const options = {
    base: null,
    redact: { paths: REDACT_PATHS, remove: true },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
  const logger = destination ? pino(options, destination) : pino(options);
  const write = (level: "info" | "warn" | "error", entry: LogEntry) => {
    if (typeof entry !== "object" || entry === null) throw new Error("Invalid log metadata");
    const selected = Object.fromEntries(
      Object.keys(entrySchema.shape)
        .filter((key) => Object.hasOwn(entry, key))
        .map((key) => [key, entry[key as keyof LogEntry]]),
    );
    const parsed = entrySchema.safeParse(selected);
    if (!parsed.success) throw new Error("Invalid log metadata");
    logger[level]({
      ...parsed.data,
      ...(parsed.data.email ? { email: maskEmail(parsed.data.email) } : {}),
    });
  };
  return Object.freeze({
    info: (entry: LogEntry) => write("info", entry),
    warn: (entry: LogEntry) => write("warn", entry),
    error: (entry: LogEntry) => write("error", entry),
  });
}
