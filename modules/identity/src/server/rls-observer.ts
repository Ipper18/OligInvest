import type { AppDatabase, DatabaseContext } from "@oliginvest/db";

/** Inspect only; never persist/log the driver error (it can contain row values and SQL). */
export function isRlsViolation(error: unknown): boolean {
  const seen = new Set<object>();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if (
      "code" in current &&
      current.code === "42501" &&
      "message" in current &&
      typeof current.message === "string" &&
      /row-level security/iu.test(current.message)
    )
      return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

/** Report after rollback/release, using the original pool for reporting to avoid recursion. */
export function observeRlsViolations(
  database: AppDatabase,
  report: (context: DatabaseContext) => Promise<void>,
  onFailure: () => void,
): AppDatabase {
  return {
    ...(database.poolInUse ? { poolInUse: () => database.poolInUse?.() ?? 0 } : {}),
    close: () => database.close(),
    async transaction(context, work) {
      try {
        return await database.transaction(context, work);
      } catch (error) {
        if (isRlsViolation(error)) {
          try {
            await report(context);
          } catch {
            onFailure();
          }
        }
        throw error;
      }
    },
  };
}
