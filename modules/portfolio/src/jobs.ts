import { persistentEventSchema } from "@oliginvest/contracts";
import { importJob } from "./contracts.js";
import { parseXtb } from "./import/xtb.js";
import type { ImportRepository } from "./server/imports.js";

export { parseXtb } from "./import/xtb.js";
export async function parseImport(
  repository: ImportRepository,
  raw: unknown,
  publish: (userId: string, event: unknown) => Promise<void>,
) {
  const payload = importJob.parse(raw),
    context = { userId: payload.userId, role: "user" as const };
  const input = await repository.parseInput(context, payload.importId);
  if (input) {
    let parsed: ReturnType<typeof parseXtb> | undefined;
    try {
      parsed = parseXtb(input.content, input.account);
    } catch {
      await repository.fail(context, payload.importId);
    }
    if (parsed) await repository.saveParsed(context, payload.importId, parsed);
  }
  const batch = await repository.get(context, payload.importId);
  if (!["parsed", "failed"].includes(batch.status)) return;
  await publish(
    payload.userId,
    persistentEventSchema.parse({
      event: "portfolio.import.parsed",
      data: {
        v: 1,
        importId: payload.importId,
        status: batch.status,
        counts: batch.summary?.byStatus ?? {},
      },
    }),
  );
}
