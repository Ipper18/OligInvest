import { z } from "zod";
import type { Subject } from "./modules.js";
import { ProblemError } from "./problem.js";

const roleSchema = z.enum(["user", "pro", "admin"]);
const sharedPermissions = [
  "market:read",
  "watchlists:write",
  "portfolio:read",
  "portfolio:write",
  "transactions:write",
  "alerts:manage",
  "analytics:run:light",
  "education:use",
] as const;
const adminPermissions = [
  "admin:users",
  "admin:flags",
  "admin:audit:read",
  "admin:queues",
  "admin:market",
  "admin:system",
] as const;
export function permissionsForRole(role: unknown): string[] {
  const parsed = roleSchema.safeParse(role);
  if (!parsed.success) throw new ProblemError("UNAUTHENTICATED");
  return [
    ...sharedPermissions,
    ...(parsed.data !== "user" ? ["analytics:run:heavy"] : []),
    ...(parsed.data === "admin" ? adminPermissions : []),
  ];
}
export function requirePermission(role: unknown, permission: string): void {
  if (!permissionsForRole(role).includes(permission)) throw new ProblemError("FORBIDDEN");
}
export const featureRulesSchema = z
  .object({ roles: z.array(roleSchema).optional(), users: z.array(z.uuid()).optional() })
  .strict();
export const featureFlagSchema = z
  .object({
    key: z.string().regex(/^(module\.[a-z][a-z0-9.-]*|auth\.(oauth|passkeys))$/u),
    enabled: z.boolean(),
    rules: featureRulesSchema,
  })
  .strict();
type FeatureFlag = z.infer<typeof featureFlagSchema>;
const subjectSchema = z.object({ userId: z.uuid(), role: roleSchema }).strict();
const foundations = new Set([
  "module.identity",
  "module.notifications",
  "module.market",
  "module.portfolio",
]);

// Cache only global configuration, never evaluated results shared across users.
// The host wires invalidate() to its flags.changed subscription after commits.
export class FeatureFlags {
  private cache: { rows: Map<string, FeatureFlag>; expires: number } | undefined;
  private pending: Promise<Map<string, FeatureFlag>> | undefined;
  private revision = 0;
  constructor(
    private readonly load: () => Promise<unknown>,
    private readonly now: () => number = Date.now,
  ) {}
  invalidate(): void {
    this.revision++;
    this.cache = undefined;
    this.pending = undefined;
  }
  private async rows(): Promise<Map<string, FeatureFlag>> {
    if (this.cache && this.cache.expires > this.now()) return this.cache.rows;
    if (this.pending) return this.pending;
    const revision = this.revision;
    const pending = this.load()
      .then((input) => {
        const rows = z.array(featureFlagSchema).parse(input);
        const map = new Map(rows.map((row) => [row.key, row]));
        if (map.size !== rows.length) throw new Error("Duplicate feature flag");
        if (revision === this.revision) this.cache = { rows: map, expires: this.now() + 30000 };
        return map;
      })
      .finally(() => {
        if (this.pending === pending) this.pending = undefined;
      });
    this.pending = pending;
    return pending;
  }
  private evaluate(
    key: string,
    subject: z.infer<typeof subjectSchema>,
    rows: Map<string, FeatureFlag>,
  ): boolean {
    if (foundations.has(key)) return true;
    if (key === "module.admin") return subject.role === "admin";
    const flag = rows.get(key);
    if (!flag?.enabled) return false;
    const segments = key.split(".");
    if (
      segments[0] === "module" &&
      segments.length > 2 &&
      !this.evaluate(segments.slice(0, 2).join("."), subject, rows)
    )
      return false;
    const { roles, users } = flag.rules;
    return (
      (!roles && !users) || !!roles?.includes(subject.role) || !!users?.includes(subject.userId)
    );
  }
  async enabled(key: string, input: Readonly<Subject>): Promise<boolean> {
    return this.evaluate(key, subjectSchema.parse(input), await this.rows());
  }
  async effective(input: Readonly<Subject>): Promise<Record<string, boolean>> {
    const subject = subjectSchema.parse(input);
    const rows = await this.rows();
    return Object.fromEntries(
      [...new Set([...rows.keys(), ...foundations, "module.admin"])].map((key) => [
        key,
        this.evaluate(key, subject, rows),
      ]),
    );
  }
}
