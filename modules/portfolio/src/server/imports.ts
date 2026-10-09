import { createHash } from "node:crypto";
import {
  addMoney,
  buildLedger,
  convertMoney,
  currencyCode,
  Decimal,
  divideMoney,
  fxRate,
  grossValue,
  invertFxRate,
  money,
  moneyToJson,
  price,
  quantity,
  subtractMoney,
  sumMoney,
} from "@oliginvest/core";
import type { DatabaseContext, DatabaseTransaction } from "@oliginvest/db";
import { ProblemError } from "@oliginvest/platform";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  portfolioImportBatches as batches,
  portfolioImportFiles as files,
  portfolioImportRows as rows,
  portfolioImportTemplates as templates,
  portfolioTransactions as transactions,
} from "../../db/schema.js";
import { accountSchema, transactionFields, transactionInput } from "../contracts.js";
import { normalizeTransaction, toCoreTransaction } from "../domain/transactions.js";
import {
  importBatchSchema,
  importCommitSchema,
  importRowSchema,
  resolutionSchema,
} from "../import/contracts.js";
import type { ParsedImport, ParsedRow } from "../import/xtb.js";
import {
  accountDto,
  clean,
  loadLedger,
  type PortfolioRepository,
  transactionValues,
} from "./repository.js";

const partialInput = z.object(transactionInput.shape).partial().strict();
const storedSchema = z
  .object({
    input: partialInput,
    symbol: z.string(),
    isin: z.string().optional(),
    key: z.string(),
    relatedKey: z.string().optional(),
    pairedTo: z.string().optional(),
    dividendGross: z.string().optional(),
    dividendTax: z.string().optional(),
  })
  .strict();
const snapshotSchema = z
  .object({ cash: z.string().nullable(), positions: z.record(z.string(), z.string()) })
  .strict();
type Stored = z.infer<typeof storedSchema>;
const stamp = (value: string | null) => (value ? new Date(value).toISOString() : undefined);
function batchDto(row: typeof batches.$inferSelect) {
  const summary = row.summary as Record<string, unknown> | null;
  const { _source, ...publicSummary } = summary ?? {};
  return importBatchSchema.parse(
    clean({
      id: row.id,
      accountId: row.accountId,
      source: row.source,
      fileName: row.fileName,
      status: row.status,
      formatDetected: row.formatDetected,
      summary: summary ? publicSummary : undefined,
      reconciliation: row.reconciliation,
      error: row.error,
      createdAt: stamp(row.createdAt),
      parsedAt: stamp(row.parsedAt),
      committedAt: stamp(row.committedAt),
    }),
  );
}
function rowDto(row: typeof rows.$inferSelect) {
  const normalized = row.normalized ? storedSchema.parse(row.normalized).input : undefined;
  const fields = normalized
    ? Object.fromEntries(
        Object.entries(normalized).filter(([key]) => key in transactionFields.shape),
      )
    : undefined;
  return importRowSchema.parse(
    clean({
      id: row.id,
      rowNumber: row.rowNumber,
      sheet: row.sheet,
      status: row.status,
      statusReason: row.statusReason,
      raw: row.raw,
      normalized: fields,
      instrumentId: row.instrumentId,
      transactionId: row.transactionId,
    }),
  );
}
export class ImportRepository {
  constructor(
    readonly portfolio: PortfolioRepository,
    readonly enqueue: (payload: { userId: string; importId: string }) => Promise<void>,
  ) {}
  async requireBatch(tx: DatabaseTransaction, id: string) {
    const [batch] = await tx.select().from(batches).where(eq(batches.id, id));
    if (!batch) throw new ProblemError("NOT_FOUND");
    return batch;
  }
  async upload(
    context: DatabaseContext,
    input: {
      accountId: string;
      fileName: string;
      contentType: string;
      content: Uint8Array;
      source: string;
    },
  ) {
    if (input.content.byteLength > 10485760) throw new ProblemError("FILE_TOO_LARGE");
    if (!input.content.byteLength || !["auto", "xtb"].includes(input.source))
      throw new ProblemError("IMPORT_FORMAT_UNKNOWN");
    const hash = createHash("sha256").update(input.content).digest("hex");
    const result = await this.portfolio.mutate(context, async (tx) => {
      const account = await this.portfolio.requireAccount(tx, input.accountId);
      if (account.closedOn) throw new ProblemError("CONFLICT");
      const [old] = await tx
        .select()
        .from(batches)
        .where(
          and(
            eq(batches.accountId, input.accountId),
            eq(batches.fileSha256, hash),
            sql`${batches.status}<>'discarded'`,
          ),
        );
      if (old) throw new ProblemError("DUPLICATE_IMPORT", { detail: `Import: ${old.id}` });
      const [count] = (
        await tx.execute(
          sql`SELECT count(*)::integer AS count FROM portfolio.import_batches WHERE created_at >= now()-interval '1 day'`,
        )
      ).rows;
      if (Number(count?.count) >= 20)
        throw new ProblemError("RATE_LIMITED", { retryAfterSeconds: 86400 });
      const [batch] = await tx
        .insert(batches)
        .values({
          userId: context.userId!,
          accountId: input.accountId,
          source: "xtb",
          fileName: input.fileName
            .slice(0, 255)
            .replace(/[\\/\r\n]/g, "_")
            .replaceAll(String.fromCharCode(0), "_"),
          fileSha256: hash,
        })
        .returning();
      await tx.insert(files).values({
        batchId: batch!.id,
        userId: context.userId!,
        content: input.content,
        contentType: input.contentType,
        sizeBytes: input.content.byteLength,
        expiresAt: new Date(this.portfolio.now().getTime() + 90 * 86400000).toISOString(),
      });
      return batchDto(batch!);
    });
    await this.enqueue({ userId: context.userId!, importId: result.id });
    return result;
  }
  async get(context: DatabaseContext, id: string) {
    return this.portfolio.read(context, async (tx) => batchDto(await this.requireBatch(tx, id)));
  }
  async list(
    context: DatabaseContext,
    query: { limit: number; cursor?: string | undefined; accountId?: string[] | undefined },
    batchId?: string,
    status?: string[],
  ) {
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({ userId: context.userId, ...query, cursor: undefined, batchId, status }),
      )
      .digest("hex");
    const cursor = query.cursor
      ? z
          .object({ id: z.uuid(), fingerprint: z.literal(fingerprint) })
          .strict()
          .parse(JSON.parse(Buffer.from(query.cursor, "base64url").toString()))
      : undefined;
    return this.portfolio.read(context, async (tx) => {
      if (batchId) await this.requireBatch(tx, batchId);
      const result = batchId
        ? await tx
            .select()
            .from(rows)
            .where(
              and(
                eq(rows.batchId, batchId),
                cursor ? sql`${rows.id}>${cursor.id}::uuid` : undefined,
                status?.length ? sql`${rows.status}=ANY(${sql.param(status)}::text[])` : undefined,
              ),
            )
            .orderBy(asc(rows.id))
            .limit(query.limit + 1)
        : await tx
            .select()
            .from(batches)
            .where(
              and(
                cursor ? sql`${batches.id}<${cursor.id}::uuid` : undefined,
                query.accountId?.length
                  ? sql`${batches.accountId}=ANY(${sql.param(query.accountId)}::uuid[])`
                  : undefined,
              ),
            )
            .orderBy(desc(batches.id))
            .limit(query.limit + 1);
      const selected = result.slice(0, query.limit),
        last = selected.at(-1);
      return {
        data: selected.map((r) =>
          batchId
            ? rowDto(r as typeof rows.$inferSelect)
            : batchDto(r as typeof batches.$inferSelect),
        ),
        page: {
          hasMore: result.length > query.limit,
          ...(result.length > query.limit && last
            ? {
                nextCursor: Buffer.from(JSON.stringify({ id: last.id, fingerprint })).toString(
                  "base64url",
                ),
              }
            : {}),
        },
      };
    });
  }
  async discard(context: DatabaseContext, id: string) {
    await this.portfolio.mutate(context, async (tx) => {
      const batch = await this.requireBatch(tx, id);
      if (batch.status === "committed") throw new ProblemError("CONFLICT");
      await tx.delete(files).where(eq(files.batchId, id));
      await tx.delete(rows).where(eq(rows.batchId, id));
      await tx
        .update(batches)
        .set({ status: "discarded", summary: null, reconciliation: null })
        .where(eq(batches.id, id));
    });
  }
  async parseInput(context: DatabaseContext, id: string) {
    return this.portfolio.mutate(context, async (tx) => {
      const batch = await this.requireBatch(tx, id);
      if (!["uploaded", "parsing", "failed"].includes(batch.status)) return null;
      const [file] = await tx
        .select()
        .from(files)
        .where(and(eq(files.batchId, id), sql`${files.expiresAt}>now()`));
      if (!file) throw new ProblemError("NOT_FOUND");
      const account = await this.portfolio.requireAccount(tx, batch.accountId);
      await tx.update(batches).set({ status: "parsing", error: null }).where(eq(batches.id, id));
      return { content: file.content, account: { id: account.id, currency: account.currency } };
    });
  }
  async fail(context: DatabaseContext, id: string) {
    await this.portfolio.mutate(context, async (tx) => {
      await tx
        .update(batches)
        .set({ status: "failed", error: "Nie udało się bezpiecznie odczytać pliku XTB." })
        .where(and(eq(batches.id, id), sql`${batches.status} IN ('uploaded','parsing','failed')`));
    });
  }
  async symbolMap(tx: DatabaseTransaction) {
    const instruments = (
      await tx.execute(
        sql`SELECT i.id::text,i.isin,i.name,i.currency,p.symbol FROM market.instruments i LEFT JOIN market.instrument_provider_symbols p ON p.instrument_id=i.id AND p.provider='xtb'`,
      )
    ).rows;
    const map = new Map<string, string[]>();
    for (const r of instruments)
      for (const value of [r.isin, r.symbol, r.name])
        if (typeof value === "string")
          map.set(value, [...new Set([...(map.get(value) ?? []), String(r.id)])]);
    const remembered = await tx
      .select()
      .from(templates)
      .where(eq(templates.sourceHint, "xtb-symbols"));
    for (const row of remembered) {
      const mapping = z.record(z.string(), z.uuid()).parse(row.mapping);
      for (const [symbol, id] of Object.entries(mapping)) map.set(symbol, [id]);
    }
    return map;
  }
  async saveParsed(context: DatabaseContext, id: string, parsed: ParsedImport) {
    await this.portfolio.mutate(context, async (tx) => {
      const batch = await this.requireBatch(tx, id);
      if (batch.status !== "parsing") return;
      const symbols = await this.symbolMap(tx);
      const existing = await tx
        .select({ id: transactions.id, key: transactions.externalId })
        .from(transactions)
        .where(and(eq(transactions.accountId, batch.accountId), eq(transactions.source, "import")));
      const keys = new Map(existing.map((r) => [r.key, r.id]));
      await tx.delete(rows).where(eq(rows.batchId, id));
      const values = parsed.rows.map((r) => {
        const candidates = (r.isin && symbols.get(r.isin)) || symbols.get(r.symbol) || [];
        const instrumentId = candidates.length === 1 ? candidates[0] : undefined;
        const stored: Stored = {
          input: { ...r.input, ...(instrumentId ? { instrumentId } : {}) },
          symbol: r.symbol,
          key: r.key,
          ...(r.isin ? { isin: r.isin } : {}),
          ...(r.relatedKey ? { relatedKey: r.relatedKey } : {}),
          ...(r.pairedTo ? { pairedTo: r.pairedTo } : {}),
          ...(r.dividendGross ? { dividendGross: r.dividendGross } : {}),
          ...(r.dividendTax ? { dividendTax: r.dividendTax } : {}),
        };
        let status: string = r.status,
          reason = r.reason;
        if (keys.has(r.pairedTo ?? r.key)) {
          status = "duplicate";
          reason = "already_imported";
        } else if (
          status === "new" &&
          ["BUY", "SELL", "DIVIDEND"].includes(r.input.type ?? "") &&
          !instrumentId
        ) {
          status = "needs_mapping";
          reason = "instrument_not_resolved";
        }
        return {
          batchId: id,
          userId: context.userId!,
          rowNumber: r.rowNumber,
          sheet: r.sheet,
          raw: r.raw,
          normalized: storedSchema.parse(stored),
          status,
          statusReason: reason ?? null,
          dedupeKey: r.key,
          instrumentId: instrumentId ?? null,
          transactionId: keys.get(r.pairedTo ?? r.key) ?? null,
        };
      });
      for (let start = 0; start < values.length; start += 500)
        await tx.insert(rows).values(values.slice(start, start + 500));
      await tx
        .update(batches)
        .set({
          status: "parsed",
          parsedAt: this.portfolio.now().toISOString(),
          formatDetected: parsed.format,
          summary: { _source: { cash: parsed.cash, positions: parsed.positions } },
        })
        .where(eq(batches.id, id));
      await this.refresh(tx, id);
    });
  }
  prepare(stored: Stored, account: Parameters<typeof normalizeTransaction>[1]) {
    const input = { ...stored.input };
    if (
      input.type === "DIVIDEND" &&
      input.quantity &&
      input.price &&
      input.priceCurrency &&
      stored.dividendGross &&
      stored.dividendTax
    ) {
      const gross = grossValue(price(input.price, input.priceCurrency), quantity(input.quantity));
      const paid = money(stored.dividendGross, account.currency);
      const tax = money(stored.dividendTax, account.currency);
      input.tax = moneyToJson(
        input.priceCurrency === account.currency
          ? tax
          : convertMoney(
              tax,
              invertFxRate(
                fxRate({
                  base: input.priceCurrency,
                  quote: account.currency,
                  rate: divideMoney(paid, gross.amount).amount,
                  date: input.tradeDate!,
                  source: "implied",
                }),
              ),
            ),
      );
      input.tax.amount = new Decimal(input.tax.amount).toDecimalPlaces(8).toFixed();
    }
    return normalizeTransaction(input, account);
  }
  async refresh(tx: DatabaseTransaction, id: string) {
    const batch = await this.requireBatch(tx, id),
      all = await tx.select().from(rows).where(eq(rows.batchId, id)).orderBy(asc(rows.rowNumber));
    const source = snapshotSchema.parse((batch.summary as { _source: unknown })._source);
    const accountRow = await this.portfolio.requireAccount(tx, batch.accountId);
    const account = {
      ...accountRow,
      currency: currencyCode(accountRow.currency),
      accountType: accountDto(accountRow).accountType,
    };
    const state = await loadLedger(tx),
      byStatus: Record<string, number> = {};
    const dates: string[] = [];
    for (const row of all) {
      byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
      const d = storedSchema.parse(row.normalized).input.tradeDate;
      if (d) dates.push(d);
    }
    dates.sort();
    const expected =
      source.cash !== null
        ? money(source.cash, account.currency)
        : sumMoney(
            all.map((r) => {
              const raw = z.record(z.string(), z.string()).parse(r.raw);
              const amount = raw.amount
                ?.replace(/[\s\u00a0]/g, "")
                .replace("−", "-")
                .replace(",", ".");
              return money(/^-?\d+(\.\d+)?$/.test(amount ?? "") ? amount! : "0", account.currency);
            }),
            account.currency,
          );
    let ok = !all.some((r) => ["error", "needs_mapping"].includes(r.status));
    let computed = money("0", account.currency);
    const positions: {
      instrumentId: string;
      expectedQuantity: string;
      computedQuantity: string;
    }[] = [];
    try {
      const ids = new Map(all.map((r) => [r.dedupeKey, r.transactionId ?? r.id]));
      const pending = all
        .filter((r) => r.status === "new" || r.status === "unsupported")
        .flatMap((r) => {
          const stored = storedSchema.parse(r.normalized);
          if (!stored.input.type) return [];
          const input = this.prepare(stored, account);
          return [
            toCoreTransaction(
              {
                ...input,
                ...(stored.relatedKey ? { relatedTransactionId: ids.get(stored.relatedKey) } : {}),
              },
              r.id,
              account.broker,
            ),
          ];
        });
      const ledger = buildLedger({
        accounts: state.accounts,
        transactions: [...state.transactions, ...pending],
      });
      computed =
        ledger.cash.find(
          (c) => c.accountId === account.id && c.balance.currency === account.currency,
        )?.balance ?? computed;
      const symbols = await this.symbolMap(tx);
      for (const [symbol, expectedQuantity] of Object.entries(source.positions)) {
        const candidates = symbols.get(symbol) ?? [];
        if (candidates.length !== 1) {
          ok = false;
          continue;
        }
        const instrumentId = candidates[0]!,
          computedQuantity =
            ledger.positions
              .find((p) => p.accountId === account.id && p.instrumentId === instrumentId)
              ?.quantity.toFixed() ?? "0";
        positions.push({ instrumentId, expectedQuantity, computedQuantity });
        if (!new Decimal(expectedQuantity).equals(computedQuantity)) ok = false;
      }
    } catch {
      ok = false;
    }
    const difference = subtractMoney(computed, expected);
    if (!difference.amount.isZero()) ok = false;
    await tx
      .update(batches)
      .set({
        summary: {
          rowsTotal: all.length,
          byStatus,
          ...(dates.length ? { periodFrom: dates[0], periodTo: dates.at(-1) } : {}),
          _source: source,
        },
        reconciliation: {
          ok,
          cash: [
            {
              currency: account.currency,
              expected: moneyToJson(expected),
              computed: moneyToJson(computed),
              difference: moneyToJson(difference),
            },
          ],
          positions,
        },
      })
      .where(eq(batches.id, id));
  }
  async resolve(context: DatabaseContext, id: string, rowId: string, raw: unknown) {
    const resolution = resolutionSchema.parse(raw);
    return this.portfolio.mutate(context, async (tx) => {
      const batch = await this.requireBatch(tx, id);
      if (batch.status !== "parsed") throw new ProblemError("CONFLICT");
      const [row] = await tx
        .select()
        .from(rows)
        .where(and(eq(rows.batchId, id), eq(rows.id, rowId)));
      if (!row) throw new ProblemError("NOT_FOUND");
      const stored = storedSchema.parse(row.normalized);
      if (stored.pairedTo || row.status === "duplicate") throw new ProblemError("CONFLICT");
      const accountRow = await this.portfolio.requireAccount(tx, batch.accountId);
      const account = {
        ...accountRow,
        currency: currencyCode(accountRow.currency),
        accountType: accountRow.accountType as "regular" | "ike" | "ikze" | "demo",
      };
      let status = "skipped";
      if (resolution.action !== "skip") {
        stored.input = {
          ...stored.input,
          ...resolution.fields,
          ...(resolution.instrumentId ? { instrumentId: resolution.instrumentId } : {}),
        };
        if (stored.input.instrumentId) {
          const [instrument] = (
            await tx.execute(
              sql`SELECT id FROM market.instruments WHERE id=${stored.input.instrumentId}::uuid`,
            )
          ).rows;
          if (!instrument) throw new ProblemError("NOT_FOUND");
        }
        stored.input = this.prepare(stored, account);
        status = stored.input.category === "cfd_pl" ? "unsupported" : "new";
        if (resolution.rememberMapping && resolution.instrumentId && stored.symbol) {
          const name = `xtb:${createHash("sha256").update(stored.symbol).digest("hex")}`;
          await tx
            .insert(templates)
            .values({
              userId: context.userId!,
              name,
              sourceHint: "xtb-symbols",
              mapping: { [stored.symbol]: resolution.instrumentId },
            })
            .onConflictDoUpdate({
              target: [templates.userId, templates.name],
              set: {
                mapping: { [stored.symbol]: resolution.instrumentId },
                updatedAt: this.portfolio.now().toISOString(),
              },
            });
        }
      }
      const [updated] = await tx
        .update(rows)
        .set({
          status,
          statusReason: status === "skipped" ? "user_skipped" : null,
          normalized: stored,
          instrumentId: stored.input.instrumentId ?? null,
        })
        .where(eq(rows.id, rowId))
        .returning();
      await this.refresh(tx, id);
      return rowDto(updated!);
    });
  }
  async commit(context: DatabaseContext, id: string, raw: unknown, key: string) {
    const input = importCommitSchema.parse(raw);
    const result = await this.portfolio.mutate(
      context,
      async (tx) =>
        this.portfolio.replay(
          tx,
          context,
          key,
          `/portfolio/imports/${id}/commit`,
          input,
          200,
          async () => {
            let batch = await this.requireBatch(tx, id);
            if (batch.status !== "parsed") throw new ProblemError("CONFLICT");
            await this.refresh(tx, id);
            batch = await this.requireBatch(tx, id);
            const all = await tx
              .select()
              .from(rows)
              .where(eq(rows.batchId, id))
              .orderBy(asc(rows.rowNumber));
            if (all.some((r) => ["error", "needs_mapping"].includes(r.status)))
              throw new ProblemError("CONFLICT");
            if (!(batch.reconciliation as { ok: boolean }).ok && !input.acknowledgeDifferences)
              throw new ProblemError("RECONCILIATION_REQUIRED");
            const accountRow = await this.portfolio.requireAccount(tx, batch.accountId);
            if (accountRow.closedOn) throw new ProblemError("CONFLICT");
            const account = {
              ...accountRow,
              currency: currencyCode(accountRow.currency),
              accountType: accountRow.accountType as "regular" | "ike" | "ikze" | "demo",
            };
            const existing = await tx
              .select({ id: transactions.id, key: transactions.externalId })
              .from(transactions)
              .where(
                and(eq(transactions.accountId, batch.accountId), eq(transactions.source, "import")),
              );
            const ids = new Map(existing.map((r) => [r.key, r.id]));
            const pending = all.filter(
              (r) =>
                ["new", "unsupported"].includes(r.status) &&
                storedSchema.parse(r.normalized).input.type,
            );
            const generated = (
              await tx.execute(
                sql`SELECT uuidv7()::text AS id FROM generate_series(1,${pending.length})`,
              )
            ).rows;
            pending.forEach((r, i) => {
              if (!ids.has(r.dedupeKey)) ids.set(r.dedupeKey, String(generated[i]!.id));
            });
            const values = pending
              .filter((r) => !existing.some((e) => e.key === r.dedupeKey))
              .map((r) => {
                const stored = storedSchema.parse(r.normalized),
                  normalized = this.prepare(stored, account);
                return {
                  ...transactionValues(normalized),
                  id: ids.get(r.dedupeKey)!,
                  userId: context.userId!,
                  source: "import",
                  importBatchId: id,
                  externalId: r.dedupeKey,
                  relatedTransactionId: stored.relatedKey
                    ? (ids.get(stored.relatedKey) ?? null)
                    : (normalized.relatedTransactionId ?? null),
                };
              });
            // Insert ordinary operations before linked charges to satisfy the immediate FK.
            for (const linked of [false, true]) {
              const group = values.filter((v) => Boolean(v.relatedTransactionId) === linked);
              for (let start = 0; start < group.length; start += 500)
                await tx.insert(transactions).values(group.slice(start, start + 500));
            }
            await loadLedger(tx);
            for (const row of all) {
              const stored = storedSchema.parse(row.normalized),
                transactionId = ids.get(stored.pairedTo ?? row.dedupeKey);
              if (transactionId)
                await tx
                  .update(rows)
                  .set({
                    transactionId,
                    ...(existing.some((e) => e.id === transactionId)
                      ? { status: "duplicate" }
                      : {}),
                  })
                  .where(eq(rows.id, row.id));
            }
            const [updated] = await tx
              .update(batches)
              .set({ status: "committed", committedAt: this.portfolio.now().toISOString() })
              .where(eq(batches.id, id))
              .returning();
            return batchDto(updated!);
          },
        ),
      key,
    );
    await this.portfolio.enqueue({
      userId: context.userId!,
      accountIds: [result.value.accountId],
      fromDate: result.value.summary?.periodFrom ?? "1970-01-01",
      reason: "import",
    });
    return result;
  }
}
