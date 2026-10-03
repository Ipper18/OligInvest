import { readFileSync } from "node:fs";
import { hash, verify } from "@node-rs/argon2";
import { ProblemError } from "@oliginvest/platform";
import { isPasswordCompromised } from "better-auth/plugins/haveibeenpwned";

export const ARGON2_OPTIONS = Object.freeze({
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  algorithm: 2 as const,
});
const common = new Set(
  readFileSync(new URL("../../data/common-passwords.txt", import.meta.url), "utf8")
    .split(/\r?\n/u)
    .filter(Boolean)
    .slice(0, 10_000),
);
const contextWords = [
  "oliginvest",
  "oligi",
  "invest",
  "inwestycje",
  "portfel",
  "xtb",
  "mbank",
  "emakler",
  "gpw",
];
export type PasswordChecks = Readonly<{
  compromised: (password: string) => Promise<boolean>;
  unavailable: () => void;
}>;

export const defaultPasswordChecks = (unavailable: () => void): PasswordChecks => ({
  compromised: isPasswordCompromised,
  unavailable,
});

export async function checkPassword(
  password: string,
  user: Readonly<{ email: string; name: string }>,
  checks: PasswordChecks,
): Promise<void> {
  const folded = password.toLocaleLowerCase("en-US");
  const stem = folded.replace(/\d+$/u, "");
  const words = [
    ...contextWords,
    user.email.split("@")[0] ?? "",
    user.name.toLocaleLowerCase("en-US"),
  ];
  if (
    password.length < 12 ||
    password.length > 128 ||
    common.has(folded) ||
    words.some((word) => word.length > 0 && (folded === word || stem === word))
  ) {
    throw new ProblemError("VALIDATION_FAILED", {
      errors: [
        {
          path: "password",
          code: "weak_password",
          message:
            "Hasło musi mieć 12–128 znaków i nie może być popularne ani oparte na danych konta.",
        },
      ],
    });
  }
  let compromised: boolean;
  try {
    compromised = await checks.compromised(password);
  } catch {
    checks.unavailable();
    return;
  }
  if (compromised)
    throw new ProblemError("VALIDATION_FAILED", {
      errors: [
        {
          path: "password",
          code: "compromised_password",
          message: "To hasło wystąpiło w wycieku. Ustaw inne hasło.",
        },
      ],
    });
}

export const hashPassword = (password: string): Promise<string> => hash(password, ARGON2_OPTIONS);
export const verifyPassword = (input: { hash: string; password: string }): Promise<boolean> =>
  verify(input.hash, input.password).catch(() => false);

export function needsRehash(encoded: string): boolean {
  const match = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/u.exec(encoded);
  return (
    !match ||
    Number(match[1]) < ARGON2_OPTIONS.memoryCost ||
    Number(match[2]) < ARGON2_OPTIONS.timeCost ||
    Number(match[3]) < ARGON2_OPTIONS.parallelism
  );
}
