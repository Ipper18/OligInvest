import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { loadConfig } from "@oliginvest/config";
import { createAppDatabase, createAuthDatabase } from "@oliginvest/db";
import { createLogger, ProblemError } from "@oliginvest/platform";
import { z } from "zod";
import { AuditWriter } from "./auth/audit.js";
import { createOwner } from "./auth/bootstrap.js";
import { CURRENT_LEGAL_VERSION } from "./auth/inputs.js";
import { defaultPasswordChecks } from "./auth/password.js";

async function hiddenPassword(): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY || !process.stdout.isTTY) throw new Error("TTY_REQUIRED");
  process.stdout.write("Hasło (12–128 znaków; wejście ukryte): ");
  input.setRawMode(true);
  input.setEncoding("utf8");
  input.resume();
  try {
    return await new Promise<string>((resolve, reject) => {
      let value = "";
      const onData = (chunk: string) => {
        for (const char of chunk) {
          if (char === "\u0003" || char === "\u0004") {
            finish();
            reject(new Error("CANCELLED"));
            return;
          }
          if (char === "\r" || char === "\n") {
            finish();
            resolve(value);
            return;
          }
          if (char === "\u007f" || char === "\b") value = [...value].slice(0, -1).join("");
          else if (char >= " " && value.length < 129) value += char;
        }
      };
      const finish = () => input.off("data", onData);
      input.on("data", onData);
    });
  } finally {
    input.setRawMode(false);
    input.pause();
    process.stdout.write("\n");
  }
}

async function main(): Promise<void> {
  const mode = z.enum(["development", "test", "production"]).parse(process.env.NODE_ENV);
  const config = loadConfig("api", process.env, { mode });
  const connection = z
    .object({
      host: z.string().min(1),
      port: z.coerce.number().int().min(1).max(65535),
      database: z.string().min(1),
      ssl: z.boolean(),
    })
    .strict()
    .parse({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      database: process.env.DB_NAME,
      ssl: process.env.DB_SSL === "true",
    });
  const database = createAuthDatabase({ ...connection, password: config.DB_AUTH_PASSWORD });
  const appDatabase = createAppDatabase({ ...connection, password: config.DB_APP_PASSWORD });
  const audit = new AuditWriter(appDatabase, config.AUDIT_PSEUDONYM_KEY);
  try {
    let args: ReturnType<typeof parseArgs>;
    try {
      args = parseArgs({
        allowPositionals: true,
        strict: true,
        options: {
          email: { type: "string" },
          name: { type: "string" },
          reason: { type: "string" },
        },
      });
      if (args.positionals.length !== 1 || args.positionals[0] !== "create-owner")
        throw new Error("INVALID_COMMAND");
      z.object({
        email: z.email(),
        name: z.string().min(1).max(80),
        reason: z.string().min(5).max(500),
      })
        .strict()
        .parse(args.values);
      if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("TTY_REQUIRED");
    } catch (error) {
      await audit.record(
        { userId: null, role: "system" },
        { action: "cli.invalid", outcome: "denied" },
      );
      throw error;
    }
    await audit.record(
      { userId: null, role: "system" },
      {
        action: "cli.create-owner.prompt",
        outcome: "success",
        reason: z.string().parse(args.values.reason),
      },
    );
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    let accepted: boolean;
    try {
      accepted =
        (await prompt.question(
          `Potwierdź kontrolę adresu ${String(args.values.email)} oraz akceptację regulaminu i informacji o prywatności ${CURRENT_LEGAL_VERSION} (wpisz TAK): `,
        )) === "TAK";
    } finally {
      prompt.close();
    }
    if (!accepted) {
      await audit.record(
        { userId: null, role: "system" },
        { action: "cli.create-owner", outcome: "denied" },
      );
      throw new Error("CANCELLED");
    }
    const password = await hiddenPassword();
    await createOwner(
      {
        ...args.values,
        password,
        emailOwnershipConfirmed: true,
        termsVersion: CURRENT_LEGAL_VERSION,
        privacyNoticeVersion: CURRENT_LEGAL_VERSION,
      },
      {
        database,
        appDatabase,
        audit,
        passwordChecks: defaultPasswordChecks(() =>
          createLogger().warn({ event: "auth.hibp_unavailable" }),
        ),
      },
    );
    process.stdout.write(
      "Konto właściciela utworzone. Zaloguj się i skonfiguruj TOTP przed dostępem do danych.\n",
    );
  } finally {
    await Promise.all([database.close(), appDatabase.close()]);
  }
}
main().catch((error) => {
  // Never print pg/validation errors or argv: they may contain private input.
  process.stderr.write(
    `Polecenie nie powiodło się (${error instanceof ProblemError ? error.code : "CLI_FAILED"}). Sprawdź konfigurację i audyt.\n`,
  );
  process.exitCode = 1;
});
