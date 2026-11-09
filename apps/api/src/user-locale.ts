import type { AppDatabase, DatabaseContext } from "@oliginvest/db";
import { sql } from "drizzle-orm";
export async function userLocale(database: AppDatabase, context: DatabaseContext) {
  return database.transaction(context, async (tx) => {
    const row = (await tx.execute(sql`SELECT locale,timezone FROM identity.user_preferences`))
      .rows[0];
    return {
      locale: row?.locale === "en-US" ? ("en-US" as const) : ("pl-PL" as const),
      timezone: String(row?.timezone ?? "Europe/Warsaw"),
    };
  });
}
