import type { AppDatabase, DatabaseContext } from "@oliginvest/db";
import { ProblemError } from "@oliginvest/platform";
import { sql } from "drizzle-orm";
import { onboardingState, onboardingUpdate } from "../contracts.js";

const columns = sql`step,to_char(completed_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "completedAt",to_char(skipped_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "skippedAt",to_char(updated_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt"`;
const dto = (row: Record<string, unknown>) =>
  onboardingState.parse(
    Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null)),
  );
export class OnboardingRepository {
  constructor(readonly database: AppDatabase) {}
  async read(context: DatabaseContext) {
    if (!context.userId) throw new ProblemError("UNAUTHENTICATED");
    return this.database.transaction(context, async (tx) => {
      const row = (
        await tx.execute(
          sql`SELECT ${columns} FROM education.onboarding_state WHERE user_id=${context.userId}::uuid`,
        )
      ).rows[0];
      return row ? dto(row) : { step: "start", updatedAt: new Date(0).toISOString() };
    });
  }
  async update(context: DatabaseContext, raw: unknown) {
    if (!context.userId) throw new ProblemError("UNAUTHENTICATED");
    const input = onboardingUpdate.parse(raw);
    return this.database.transaction(context, async (tx) => {
      await tx.execute(
        sql`INSERT INTO education.onboarding_state(user_id) VALUES(${context.userId}::uuid) ON CONFLICT DO NOTHING`,
      );
      const row = (
        await tx.execute(sql`UPDATE education.onboarding_state SET
        step=CASE WHEN ${input.action}='restart' THEN 'start' ELSE coalesce(${input.step ?? null},step) END,
        completed_at=CASE WHEN ${input.action}='restart' THEN NULL WHEN ${input.action}='complete' THEN coalesce(completed_at,now()) ELSE completed_at END,
        skipped_at=CASE WHEN ${input.action} IN ('restart','complete') THEN NULL WHEN ${input.action}='skip' THEN coalesce(skipped_at,now()) ELSE skipped_at END,
        updated_at=now() WHERE user_id=${context.userId}::uuid RETURNING ${columns}`)
      ).rows[0];
      if (!row) throw new ProblemError("NOT_FOUND");
      return dto(row);
    });
  }
}
