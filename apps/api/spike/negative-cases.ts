import type { BetterAuthOptions } from "better-auth";

export function verifyStrictTypes(): void {
  // @ts-expect-error BL-032: skipLibCheck must not allow invalid application options.
  const invalidEnabled: NonNullable<BetterAuthOptions["emailAndPassword"]>["enabled"] = "yes";
  // @ts-expect-error BL-032: strictNullChecks still applies to application code.
  const invalidString: string = null;
  void invalidEnabled;
  void invalidString;
}
