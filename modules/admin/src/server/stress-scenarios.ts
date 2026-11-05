import {
  stressScenarioInputSchema,
  stressScenarioKeySchema,
  stressScenarioSchema,
} from "@oliginvest/contracts";
import type { DatabaseTransaction } from "@oliginvest/db";
import { sql } from "drizzle-orm";

/** The host supplies its app-role transaction; success audit must commit with this write. */
export async function upsertStressScenario(
  tx: DatabaseTransaction,
  actorId: string,
  key: string,
  input: unknown,
) {
  const scenarioKey = stressScenarioKeySchema.parse(key);
  const value = stressScenarioInputSchema.parse(input);
  // Lock absent rows too, so concurrent first writes have a truthful before/after chain.
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`stress-scenario:${scenarioKey}`}))`,
  );
  const previous = (
    await tx.execute(sql`SELECT key,name,kind,
    start_date::text AS "startDate",end_date::text AS "endDate",shocks,description,enabled
    FROM analytics.stress_scenarios WHERE key=${scenarioKey} FOR UPDATE`)
  ).rows[0];
  const before = previous
    ? stressScenarioSchema.parse({
        ...previous,
        startDate: previous.startDate ?? undefined,
        endDate: previous.endDate ?? undefined,
      })
    : null;
  const after = stressScenarioSchema.parse({
    key: scenarioKey,
    ...value,
    shocks: value.shocks ?? {},
  });
  await tx.execute(sql`INSERT INTO analytics.stress_scenarios
    (key,name,kind,start_date,end_date,shocks,description,enabled,updated_by,updated_at)
    VALUES (${scenarioKey},${value.name},${value.kind},${value.startDate ?? null}::date,
      ${value.endDate ?? null}::date,${JSON.stringify(after.shocks)}::jsonb,${value.description},
      ${value.enabled},${actorId}::uuid,now())
    ON CONFLICT (key) DO UPDATE SET name=excluded.name,kind=excluded.kind,
      start_date=excluded.start_date,end_date=excluded.end_date,shocks=excluded.shocks,
      description=excluded.description,enabled=excluded.enabled,updated_by=excluded.updated_by,
      updated_at=excluded.updated_at`);
  return { before, after };
}
