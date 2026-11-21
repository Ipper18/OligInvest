import { targetAllocationInputSchema, targetAllocationSchema } from "@oliginvest/contracts";
import { toDecimal } from "@oliginvest/core";
import type { DatabaseContext } from "@oliginvest/db";
import { ProblemError } from "@oliginvest/platform";
import { asc, eq } from "drizzle-orm";
import { portfolioTargetAllocations as targets } from "../../db/schema.js";
import type { PortfolioRepository } from "./repository.js";

function dto(row: typeof targets.$inferSelect) {
  return targetAllocationSchema.parse({
    id: row.id,
    name: row.name,
    ...(row.accountId ? { accountId: row.accountId } : {}),
    targets: row.targets,
    tolerance: toDecimal(row.tolerancePp).div(100).toFixed(),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  });
}

export function listTargets(repo: PortfolioRepository, context: DatabaseContext) {
  return repo.read(context, async (tx) => ({
    data: (await tx.select().from(targets).orderBy(asc(targets.name), asc(targets.id))).map(dto),
  }));
}

export function saveTarget(
  repo: PortfolioRepository,
  context: DatabaseContext,
  raw: unknown,
  id?: string,
  key?: string,
) {
  const input = targetAllocationInputSchema.parse(raw);
  const tolerance = toDecimal(input.tolerance);
  const weights = input.targets.map((item) => toDecimal(item.weight));
  if (
    tolerance.lt(0) ||
    tolerance.gt("0.5") ||
    weights.some((weight) => weight.lt(0) || weight.gt(1)) ||
    !weights.reduce((total, weight) => total.plus(weight), toDecimal("0")).eq(1) ||
    new Set(
      input.targets.map((item) =>
        item.instrumentId ? "instrument:" + item.instrumentId : "class:" + item.assetClass,
      ),
    ).size !== weights.length
  )
    throw new ProblemError("VALIDATION_FAILED");
  const values = {
    name: input.name,
    targets: input.targets,
    tolerancePp: tolerance.times(100).toFixed(),
    accountId: input.accountId ?? null,
  };
  return repo.mutate(
    context,
    async (tx) => {
      if (id) {
        const [row] = await tx
          .update(targets)
          .set({ ...values, updatedAt: repo.now().toISOString() })
          .where(eq(targets.id, id))
          .returning();
        if (!row) throw new ProblemError("NOT_FOUND");
        return dto(row);
      }
      const result = await repo.replay(
        tx,
        context,
        key,
        "/portfolio/targets",
        input,
        201,
        async () => {
          const [row] = await tx
            .insert(targets)
            .values({ ...values, userId: context.userId! })
            .returning();
          return dto(row!);
        },
      );
      return result.value;
    },
    key,
  );
}

export function deleteTarget(repo: PortfolioRepository, context: DatabaseContext, id: string) {
  return repo.mutate(context, async (tx) => {
    const [row] = await tx.delete(targets).where(eq(targets.id, id)).returning({ id: targets.id });
    if (!row) throw new ProblemError("NOT_FOUND");
  });
}
