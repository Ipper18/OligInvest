import { createHash } from "node:crypto";
import {
  addMoney,
  buildLedger,
  convertMoney,
  currencyCode,
  Decimal,
  daysBetween,
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
import { nameKey } from "../import/mbank.js";
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
    mic: z.string().optional(),
    candidates: z.array(z.uuid()).max(20).optional(),
    key: z.string(),
    relatedKey: z.string().optional(),
    pairedTo: z.string().optional(),
    dividendGross: z.string().optional(),
    dividendTax: z.string().optional(),
  })
  .strict();
const snapshotSchema = z
  .object({
    cash: z.string().nullable(),
    positions: z.record(z.string(), z.string()),
    reconcileCash: z.boolean().optional(),
  })
  .strict();
type Source = "xtb" | "mbank";
const sourceLabel: Record<Source, string> = { xtb: "XTB", mbank: "mBank eMakler" };
/** Remembered mapping key: XTB symbols are global, mBank names are scoped by exchange. */
const mappingKey = (stored: { symbol: string; mic?: string | undefined }, source: string) =>
  source === "mbank" ? `${stored.mic ?? ""}|${stored.symbol}` : stored.symbol;
const instrumentColumns = sql`i.id::text,coalesce(i.ticker,i.isin,i.id::text) AS ticker,i.name,i.isin,i.mic,i.currency,i.type,i.country,i.is_active AS "isActive",i.exchange_short_name AS "exchangeShortName"`;
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
function rowDto(row: typeof rows.$inferSelect, summaries = new Map<string, unknown>()) {
  const stored = row.normalized ? storedSchema.parse(row.normalized) : undefined;
  const normalized = stored?.input;
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
      candidates:
        !row.instrumentId && stored?.candidates?.length
          ? stored.candidates.flatMap((id) => (summaries.has(id) ? [summaries.get(id)] : []))
          : undefined,
      transactionId: row.transactionId,
    }),
  );
}
/** Completes an import row (dividend withholding in the declared currency) and validates it. */
export function prepareImportInput(
  stored: Stored,
  account: Parameters<typeof normalizeTransaction>[1],
) {
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
export class ImportRepository {
  constructor(
    readonly portfolio: PortfolioRepository,
    readonly enqueue: (payload: { userId: string; importId: string }) => Promise<void>,
    /** Feature flag lookup; mBank import stays behind `module.portfolio.import.mbank`. */
    readonly features: (context: DatabaseContext, key: string) => Promise<boolean> = async () =>
      false,
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
    if (!input.content.byteLength || !["auto", "xtb", "mbank"].includes(input.source))
      throw new ProblemError("IMPORT_FORMAT_UNKNOWN");
    const mbankEnabled = await this.features(context, "module.portfolio.import.mbank");
    const hash = createHash("sha256").update(input.content).digest("hex");
    const result = await this.portfolio.mutate(context, async (tx) => {
      const account = await this.portfolio.requireAccount(tx, input.accountId);
      if (account.closedOn) throw new ProblemError("CONFLICT");
      // `auto` follows the account's broker; the parser then verifies the file content.
      const source: Source =
        input.source === "auto"
          ? account.broker === "mbank"
            ? "mbank"
            : "xtb"
          : (input.source as Source);
      if (source === "mbank" && !mbankEnabled) throw new ProblemError("IMPORT_FORMAT_UNKNOWN");
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
          source,
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
      const summaries = new Map<string, unknown>();
      if (batchId) {
        const ids = [
          ...new Set(
            selected.flatMap((r) => {
              const row = r as typeof rows.$inferSelect;
              return !row.instrumentId && row.normalized
                ? (storedSchema.parse(row.normalized).candidates ?? [])
                : [];
            }),
          ),
        ];
        if (ids.length)
          for (const instrument of (
            await tx.execute(
              sql`SELECT ${instrumentColumns} FROM market.instruments i WHERE i.id=ANY(${sql.param(ids)}::uuid[])`,
            )
          ).rows)
            summaries.set(String(instrument.id), clean(instrument));
      }
      return {
        data: selected.map((r) =>
          batchId
            ? rowDto(r as typeof rows.$inferSelect, summaries)
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
      return {
        source: batch.source as Source,
        content: file.content,
        account: { id: account.id, currency: account.currency },
      };
    });
  }
  async fail(context: DatabaseContext, id: string) {
    await this.portfolio.mutate(context, async (tx) => {
      const batch = await this.requireBatch(tx, id);
      await tx
        .update(batches)
        .set({
          status: "failed",
          error: `Nie udało się bezpiecznie odczytać pliku ${sourceLabel[batch.source as Source] ?? batch.source}.`,
        })
        .where(and(eq(batches.id, id), sql`${batches.status} IN ('uploaded','parsing','failed')`));
    });
  }
  /** Instrument lookup tables for one broker; remembered user mappings take precedence. */
  async catalog(tx: DatabaseTransaction, source: string) {
    const instruments = (
      await tx.execute(
        sql`SELECT i.id::text,i.isin,i.name,i.ticker,i.exchange_short_name,i.mic,p.symbol FROM market.instruments i LEFT JOIN market.instrument_provider_symbols p ON p.instrument_id=i.id AND p.provider=${source}`,
      )
    ).rows;
    const map = new Map<string, string[]>(),
      names: { id: string; mic: string; keys: string[] }[] = [];
    const add = (key: string, id: string) =>
      map.set(key, [...new Set([...(map.get(key) ?? []), id])]);
    for (const r of instruments) {
      const id = String(r.id);
      if (source !== "mbank") {
        for (const value of [r.isin, r.symbol, r.name])
          if (typeof value === "string") add(value, id);
        continue;
      }
      if (typeof r.isin === "string") add(r.isin, id);
      // Tiers: provider symbol (`p:`), then GPW short name, full name or ticker within the exchange.
      if (typeof r.symbol === "string") {
        add(`p:${r.mic}|${nameKey(r.symbol)}`, id);
        add(`p:|${nameKey(r.symbol)}`, id);
      }
      const keys = [r.exchange_short_name, r.name, r.ticker].flatMap((v) =>
        typeof v === "string" && nameKey(v) ? [nameKey(v)] : [],
      );
      for (const key of keys) {
        add(`${r.mic}|${key}`, id);
        add(`|${key}`, id);
      }
      names.push({ id, mic: String(r.mic), keys });
    }
    const remembered = new Map<string, string>();
    for (const row of await tx
      .select()
      .from(templates)
      .where(eq(templates.sourceHint, `${source}-symbols`))) {
      const mapping = z.record(z.string(), z.uuid()).parse(row.mapping);
      for (const [symbol, id] of Object.entries(mapping)) {
        remembered.set(symbol, id);
        map.set(symbol, [id]);
      }
    }
    return { map, names, remembered };
  }
  async symbolMap(tx: DatabaseTransaction, source = "xtb") {
    return (await this.catalog(tx, source)).map;
  }
  /** Exact matches decide the instrument; several matches or none leave the choice to the user. */
  match(
    catalog: Awaited<ReturnType<ImportRepository["catalog"]>>,
    source: string,
    r: { symbol: string; isin?: string | undefined; mic?: string | undefined },
  ): { ids: string[]; exact: boolean } {
    if (source !== "mbank") {
      const ids = (r.isin && catalog.map.get(r.isin)) || catalog.map.get(r.symbol) || [];
      return { ids, exact: true };
    }
    const key = mappingKey(r, source);
    const remembered = catalog.remembered.get(key);
    if (remembered) return { ids: [remembered], exact: true };
    for (const tier of [r.isin, `p:${key}`, key])
      if (tier && catalog.map.get(tier)?.length)
        return { ids: catalog.map.get(tier)!.slice(0, 20), exact: true };
    if (r.isin || r.symbol.length < 3) return { ids: [], exact: false };
    const ids = catalog.names
      .filter(
        (n) =>
          (!r.mic || n.mic === r.mic) &&
          n.keys.some((k) => k.length >= 3 && (k.startsWith(r.symbol) || r.symbol.startsWith(k))),
      )
      .map((n) => n.id);
    return { ids: [...new Set(ids)].slice(0, 10), exact: false };
  }
  /**
   * mBank: settlements (`WYC: … PW: <ISIN>`) parsed earlier from the account's financial history
   * point at the ISIN of a trade with the same PLN amount settled within seven days.
   */
  async settlements(tx: DatabaseTransaction, accountId: string, format: string) {
    if (format !== "mbank.transactions") return () => [];
    const known = (
      await tx
        .select({ normalized: rows.normalized })
        .from(rows)
        .innerJoin(batches, eq(rows.batchId, batches.id))
        .where(
          and(
            eq(batches.accountId, accountId),
            eq(batches.formatDetected, "mbank.financial"),
            eq(rows.statusReason, "trade_settlement"),
          ),
        )
    ).map((r) => storedSchema.parse(r.normalized));
    return (r: ParsedRow) =>
      known.flatMap((s) =>
        s.isin &&
        s.input.tradeDate &&
        r.input.tradeDate &&
        r.input.amount &&
        s.input.amount?.amount === r.input.amount.amount &&
        daysBetween(r.input.tradeDate, s.input.tradeDate) >= 0 &&
        daysBetween(r.input.tradeDate, s.input.tradeDate) <= 7
          ? [s.isin]
          : [],
      );
  }
  async saveParsed(context: DatabaseContext, id: string, parsed: ParsedImport) {
    await this.portfolio.mutate(context, async (tx) => {
      const batch = await this.requireBatch(tx, id);
      if (batch.status !== "parsing") return;
      const catalog = await this.catalog(tx, batch.source);
      const existing = await tx
        .select({ id: transactions.id, key: transactions.externalId })
        .from(transactions)
        .where(and(eq(transactions.accountId, batch.accountId), eq(transactions.source, "import")));
      const keys = new Map(existing.map((r) => [r.key, r.id]));
      const settlements = await this.settlements(tx, batch.accountId, parsed.format);
      await tx.delete(rows).where(eq(rows.batchId, id));
      const values = parsed.rows.map((r) => {
        const found = this.match(catalog, batch.source, r);
        const instrumentId = found.exact && found.ids.length === 1 ? found.ids[0] : undefined;
        const instrumentRow = ["BUY", "SELL", "DIVIDEND"].includes(r.input.type ?? "");
        const candidates =
          instrumentRow && !instrumentId
            ? [
                ...new Set([
                  ...settlements(r).flatMap((isin) => catalog.map.get(isin) ?? []),
                  ...found.ids,
                ]),
              ].slice(0, 20)
            : [];
        const stored: Stored = {
          input: { ...r.input, ...(instrumentId ? { instrumentId } : {}) },
          symbol: r.symbol,
          key: r.key,
          ...(r.isin ? { isin: r.isin } : {}),
          ...(r.mic ? { mic: r.mic } : {}),
          ...(candidates.length ? { candidates } : {}),
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
          reason =
            found.exact && found.ids.length > 1
              ? "ambiguous_instrument"
              : "instrument_not_resolved";
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
          summary: {
            _source: {
              cash: parsed.cash,
              positions: parsed.positions,
              ...(parsed.reconcileCash === false ? { reconcileCash: false } : {}),
            },
          },
        })
        .where(eq(batches.id, id));
      await this.refresh(tx, id);
    });
  }
  prepare(stored: Stored, account: Parameters<typeof normalizeTransaction>[1]) {
    return prepareImportInput(stored, account);
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
      const symbols = await this.symbolMap(tx, batch.source);
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
    const reconcileCash = source.reconcileCash !== false;
    if (reconcileCash && !difference.amount.isZero()) ok = false;
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
          // Files without balances (mBank transaction history) report no cash comparison.
          cash: reconcileCash
            ? [
                {
                  currency: account.currency,
                  expected: moneyToJson(expected),
                  computed: moneyToJson(computed),
                  difference: moneyToJson(difference),
                },
              ]
            : [],
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
          const symbol = mappingKey(stored, batch.source);
          const name = `${batch.source}:${createHash("sha256").update(symbol).digest("hex")}`;
          await tx
            .insert(templates)
            .values({
              userId: context.userId!,
              name,
              sourceHint: `${batch.source}-symbols`,
              mapping: { [symbol]: resolution.instrumentId },
            })
            .onConflictDoUpdate({
              target: [templates.userId, templates.name],
              set: {
                mapping: { [symbol]: resolution.instrumentId },
                updatedAt: this.portfolio.now().toISOString(),
              },
            });
          // The remembered choice also settles the batch's other rows for the same security.
          for (const other of await tx
            .select()
            .from(rows)
            .where(
              and(
                eq(rows.batchId, id),
                sql`${rows.id}<>${rowId}::uuid`,
                sql`${rows.status} IN ('needs_mapping','error')`,
                sql`${rows.instrumentId} IS NULL`,
              ),
            )) {
            const sibling = storedSchema.parse(other.normalized);
            if (sibling.pairedTo || mappingKey(sibling, batch.source) !== symbol) continue;
            sibling.input = { ...sibling.input, instrumentId: resolution.instrumentId };
            let status = other.status;
            if (other.status === "needs_mapping")
              try {
                sibling.input = this.prepare(sibling, account);
                status = "new";
              } catch {
                continue;
              }
            await tx
              .update(rows)
              .set({
                status,
                statusReason: status === "new" ? null : other.statusReason,
                normalized: sibling,
                instrumentId: resolution.instrumentId,
              })
              .where(eq(rows.id, other.id));
          }
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
