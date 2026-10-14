import { createHash } from "node:crypto";
import {
  addDays,
  dayChange,
  externalFlows,
  grossValue,
  isCoreError,
  isoDate,
  type Money,
  price,
  sumMoney,
  valuePortfolio,
} from "@oliginvest/core";
import type { DatabaseContext, DatabaseTransaction } from "@oliginvest/db";
import { metaSchema, summarySchema } from "@oliginvest/mod-market/contracts";
import { QUOTE_STALE_MS } from "@oliginvest/mod-market/server";
import { ProblemError } from "@oliginvest/platform";
import { and, asc, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { portfolioLotConsumptions, portfolioLots } from "../../db/schema.js";
import {
  cashBalanceSchema,
  dayChangeResponse,
  lotPage,
  portfolioSummary,
  realizedResponse,
} from "../contracts.js";
import { portfolioDate, valuationState } from "../recompute.js";
import { dayInstrument, projectDayBreakdown } from "./day-breakdown.js";
import { baseMoney, jsonMoney, projectPortfolio, type ReadQuote, readMeta } from "./read-model.js";
import { clean, type PortfolioRepository } from "./repository.js";

export type ReadQuery = {
  accountId?: string[] | undefined;
  asOf?: string | undefined;
  view?: "economic" | "tax" | undefined;
  groupBy?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  instrumentId?: string | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
  status?: "open" | "closed" | "all" | undefined;
};
export async function readPortfolio(
  repo: PortfolioRepository,
  context: DatabaseContext,
  operation: string,
  query: ReadQuery,
) {
  return repo.read(context, async (tx) => {
    if (operation === "listLots") return readLots(tx, context, query);
    const today = portfolioDate(repo.now()),
      date = isoDate(query.asOf ?? query.to ?? today);
    if (date > today || (query.from && query.from > date))
      throw new ProblemError("VALIDATION_FAILED");
    const state = await valuationState(tx, date);
    const accounts = state.accountRows.filter((a) =>
      query.accountId?.length ? query.accountId.includes(a.id) : a.accountType !== "demo",
    );
    const ids = new Set(accounts.map((a) => a.id));
    const ledger = state.ledgerOn(date);
    const previousLedger = state.ledgerOn(addDays(date, -1));
    const instrumentIds = [
      ...new Set([
        ...ledger.positions.filter((p) => ids.has(p.accountId)).map((p) => p.instrumentId),
        ...previousLedger.positions.filter((p) => ids.has(p.accountId)).map((p) => p.instrumentId),
        ...state.transactions
          .filter((t) => ids.has(t.accountId) && t.tradeDate === date)
          .flatMap((t) => {
            const id = dayInstrument(t, state.transactions);
            return id ? [id] : [];
          }),
      ]),
    ];
    const selected = {
      ...ledger,
      positions: ledger.positions.filter((p) => ids.has(p.accountId)),
      cash: ledger.cash.filter((p) => ids.has(p.accountId)),
      sales: ledger.sales.filter((p) => ids.has(p.accountId)),
    };
    const preferences = (
      await tx.execute(sql`SELECT pl_view AS view FROM identity.user_preferences`)
    ).rows[0];
    const view = query.view ?? z.enum(["economic", "tax"]).parse(preferences?.view ?? "economic");
    if (operation === "getRealizedPl") return projectRealized(selected.sales, state, query, view);
    const instruments = (
      await tx.execute(
        sql`SELECT id::text,coalesce(ticker,isin,id::text) AS ticker,name,isin,mic,currency,type,country,is_active AS "isActive",exchange_short_name AS "exchangeShortName" FROM market.instruments WHERE id=ANY(${sql.param(instrumentIds)}::uuid[])`,
      )
    ).rows.map((r) => summarySchema.parse(clean(r)));
    const quotes: ReadQuote[] = state
      .quotesOn(date)
      .filter((q) => instrumentIds.includes(q.instrumentId))
      .map((q) => {
        const bar = state.bars.findLast((b) => b.id === q.instrumentId && b.date <= date)!;
        return {
          ...q,
          meta: metaSchema.parse({
            source: bar.source,
            asOf: q.asOf,
            delayMinutes: 0,
            stale: !query.asOf,
            ...(!query.asOf ? { staleReason: "eod_only" } : {}),
            attribution: bar.source === "yahoo" ? "Dane: Yahoo Finance" : "Źródło: GPW",
          }),
        };
      });
    if (!query.asOf) {
      const rows = (
        await tx.execute(
          sql`SELECT q.instrument_id::text AS id,q.price::text,i.currency,q.source,q.as_of AS "asOf",q.fetched_at AS "fetchedAt",q.delay_minutes AS delay FROM market.quotes_latest q JOIN market.instruments i ON i.id=q.instrument_id WHERE q.instrument_id=ANY(${sql.param(instruments.map((i) => i.id))}::uuid[])`,
        )
      ).rows;
      for (const row of rows) {
        const asOf = new Date(String(row.asOf)).toISOString(),
          old = quotes.find((q) => q.instrumentId === row.id);
        if (old && old.asOf > asOf) continue;
        const stale =
          repo.now().getTime() - new Date(String(row.fetchedAt)).getTime() > QUOTE_STALE_MS;
        const q: ReadQuote = {
          instrumentId: String(row.id),
          price: price(String(row.price), String(row.currency)),
          asOf,
          meta: metaSchema.parse({
            source: row.source,
            asOf,
            delayMinutes: row.delay,
            stale,
            ...(stale ? { staleReason: "provider_error" } : {}),
            attribution: row.source === "yahoo" ? "Dane: Yahoo Finance" : "Źródło: GPW",
          }),
        };
        if (old) quotes.splice(quotes.indexOf(old), 1, q);
        else quotes.push(q);
      }
    }
    const coreAccounts = state.accounts.filter((a) => ids.has(a.id));
    const valuation = valuePortfolio({
      accounts: coreAccounts,
      positions: selected.positions,
      cash: selected.cash,
      quotes,
      fxRates: state.fx,
      date,
    });
    const model = projectPortfolio({
      accounts: coreAccounts,
      ledger: selected,
      quotes,
      instruments,
      fx: state.fx,
      date,
      view,
      groupBy: query.groupBy === "instrument" ? "instrument" : "account_instrument",
    });
    if (operation === "listPositions") return model;
    if (operation === "getCashBalances")
      return {
        data: selected.cash.map((c) => {
          const base = baseMoney(c.balance, state.fx, date);
          return cashBalanceSchema.parse({
            accountId: c.accountId,
            balance: jsonMoney(c.balance),
            ...(base ? { balanceBase: jsonMoney(base) } : {}),
            asOf: date,
          });
        }),
      };
    const prev = state.ledgerOn(addDays(date, -1));
    const previous = valuePortfolio({
      accounts: coreAccounts,
      positions: prev.positions,
      cash: prev.cash,
      quotes: state.quotesOn(addDays(date, -1)),
      fxRates: state.fx,
      date: addDays(date, -1),
    });
    let flows: Money | null = null;
    try {
      const items = externalFlows(
        state.transactions.filter((t) => ids.has(t.accountId) && t.tradeDate === date),
        {
          level: "portfolio",
          securityTransferValue: (t) => {
            if (!("instrumentId" in t) || !("quantity" in t)) return undefined;
            const q = quotes.find((q) => q.instrumentId === t.instrumentId);
            return q ? grossValue(q.price, t.quantity) : undefined;
          },
        },
      ).map((f) => baseMoney(f.amount, state.fx, date));
      if (items.every((v) => v !== null)) flows = sumMoney(items, "PLN");
    } catch (error) {
      if (!isCoreError(error) || error.code !== "missing_transfer_value") throw error;
    }
    const change =
      valuation.isComplete && previous.isComplete && flows
        ? dayChange({
            valueNow: valuation.total,
            valuePrevClose: previous.total,
            externalFlows: flows,
          })
        : null;
    const breakdown = projectDayBreakdown({
      previous,
      current: valuation,
      transactions: state.transactions.filter((t) => ids.has(t.accountId)),
      quotes,
      fx: state.fx,
      date,
      flows,
      change: change?.change ?? null,
    });
    const result = dayChangeResponse.parse({
      change: jsonMoney(change?.change ?? null),
      changeRatio: change?.ratio ?? null,
      previousValue: jsonMoney(previous.isComplete ? previous.total : null),
      currentValue: jsonMoney(valuation.isComplete ? valuation.total : null),
      flowsToday: jsonMoney(flows),
      residualChange: jsonMoney(breakdown.residualChange),
      positions: breakdown.positions.map((p) => ({
        instrument: instruments.find((i) => i.id === p.instrumentId),
        change: jsonMoney(p.change),
        contributionRatio: p.contributionRatio,
      })),
      meta: readMeta(quotes, Boolean(change)),
    });
    if (operation === "getDayChange") return result;
    return portfolioSummary.parse({
      totalValue: jsonMoney(valuation.total),
      marketValue: model.totals.marketValueBase,
      cash: jsonMoney(
        sumMoney(
          valuation.accounts.flatMap((a) => {
            const v = baseMoney(a.cash, state.fx, date);
            return v ? [v] : [];
          }),
          "PLN",
        ),
      ),
      unrealizedPl: model.totals.unrealizedPl,
      dayChange: result.change,
      dayChangeRatio: result.changeRatio,
      view,
      isComplete: valuation.isComplete,
      exclusions: model.totals.exclusions,
      meta: model.meta,
      accounts: valuation.accounts.map((a) => ({
        accountId: a.accountId,
        name: accounts.find((r) => r.id === a.accountId)!.name,
        totalValue: jsonMoney(a.total),
        totalValueBase: jsonMoney(a.totalReporting),
      })),
    });
  });
}

export function projectRealized(
  sales: ReturnType<Awaited<ReturnType<typeof valuationState>>["ledgerOn"]>["sales"],
  state: Pick<Awaited<ReturnType<typeof valuationState>>, "fx" | "taxSettings" | "transactions">,
  query: ReadQuery,
  view: "economic" | "tax",
) {
  const groupBy = query.groupBy ?? "month";
  const groups = new Map<
    string,
    {
      proceeds: Money | null;
      cost: Money | null;
      pl: Money | null;
      fx: Money | null;
      status: string;
    }[]
  >();
  const exclusions: z.infer<typeof realizedResponse>["exclusions"] = [];
  const complete: { proceeds: Money; cost: Money; pl: Money; fx: Money }[] = [];
  for (const sale of sales) {
    const transaction = state.transactions.find((t) => t.id === sale.transactionId);
    const date =
      view === "tax" && state.taxSettings?.dateBasis !== "trade"
        ? (sale.tax?.taxDate ?? transaction?.settleDate ?? sale.tradeDate)
        : sale.tradeDate;
    if ((query.from && date < query.from) || (query.to && date > query.to)) continue;
    const cost =
      view === "tax" ? (sale.tax?.costPln ?? null) : baseMoney(sale.costEconomic, state.fx, date);
    const proceeds =
      view === "tax"
        ? (sale.tax?.proceedsPln ?? null)
        : baseMoney(sale.proceedsEconomic, state.fx, date);
    const pl =
      view === "tax"
        ? (sale.tax?.realizedPlPln ?? null)
        : baseMoney(sale.realizedPlEconomic, state.fx, date);
    const status =
      view === "tax" && sale.taxStatus === "not_applicable"
        ? "not_applicable"
        : !sale.costEconomic
          ? "missing_cost"
          : view === "tax" && !sale.tax
            ? "missing_tax_data"
            : !cost || !proceeds || !pl
              ? "missing_fx"
              : "complete";
    const fx =
      view === "tax"
        ? (sale.tax?.fxCostsPln ?? null)
        : baseMoney(
            sumMoney(
              [sale.sellFxFee, ...sale.consumptions.map((c) => c.lotFxFee)],
              sale.sellFxFee.currency,
            ),
            state.fx,
            date,
          );
    if (status !== "complete")
      exclusions.push({
        transactionId: sale.transactionId,
        accountId: sale.accountId,
        instrumentId: sale.instrumentId,
        reason: status,
      });
    const key =
      groupBy === "instrument"
        ? sale.instrumentId
        : groupBy === "account"
          ? sale.accountId
          : date.slice(0, groupBy === "year" ? 4 : groupBy === "day" ? 10 : 7);
    const row = { proceeds, cost, pl, fx, status };
    groups.set(key, [...(groups.get(key) ?? []), row]);
    if (status === "complete" && proceeds && cost && pl && fx)
      complete.push({ proceeds, cost, pl, fx });
  }
  const sums = (rows: typeof complete) => ({
    proceeds: jsonMoney(
      sumMoney(
        rows.map((r) => r.proceeds),
        "PLN",
      ),
    ),
    cost: jsonMoney(
      sumMoney(
        rows.map((r) => r.cost),
        "PLN",
      ),
    ),
    realizedPl: jsonMoney(
      sumMoney(
        rows.map((r) => r.pl),
        "PLN",
      ),
    ),
    fxCosts: jsonMoney(
      sumMoney(
        rows.map((r) => r.fx),
        "PLN",
      ),
    ),
  });
  const priority = ["missing_cost", "missing_fx", "missing_tax_data", "not_applicable"];
  return realizedResponse.parse({
    view,
    groupBy,
    rows: [...groups]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, rows]) => {
        const status = priority.find((s) => rows.some((r) => r.status === s)) ?? "complete";
        return {
          key,
          label: key,
          status,
          ...(status === "complete"
            ? sums(
                rows.map((row) => ({
                  proceeds: row.proceeds!,
                  cost: row.cost!,
                  pl: row.pl!,
                  fx: row.fx!,
                })),
              )
            : { proceeds: null, cost: null, realizedPl: null }),
        };
      }),
    totals: sums(complete),
    isComplete: exclusions.length === 0,
    exclusions,
    ...(view === "tax"
      ? { taxSettings: state.taxSettings ?? { dateBasis: "settlement", includeFxFee: false } }
      : {}),
  });
}

async function readLots(tx: DatabaseTransaction, context: DatabaseContext, query: ReadQuery) {
  const accountIds = (
    await tx.execute(
      sql`SELECT id::text FROM portfolio.accounts WHERE ${query.accountId?.length ? sql`id=ANY(${sql.param(query.accountId)}::uuid[])` : sql`account_type<>'demo'`}`,
    )
  ).rows.map((r) => String(r.id));
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify([context.userId, accountIds.toSorted(), query.instrumentId, query.status]),
    )
    .digest("hex");
  let after: string | undefined;
  if (query.cursor) {
    try {
      after = z
        .object({ id: z.uuid(), fingerprint: z.literal(fingerprint) })
        .strict()
        .parse(JSON.parse(Buffer.from(query.cursor, "base64url").toString())).id;
    } catch {
      throw new ProblemError("VALIDATION_FAILED");
    }
  }
  const rows = await tx
    .select()
    .from(portfolioLots)
    .where(
      and(
        inArray(portfolioLots.accountId, accountIds),
        ...(query.instrumentId ? [sql`instrument_id=${query.instrumentId}::uuid`] : []),
        ...(after ? [sql`id>${after}::uuid`] : []),
        ...(query.status === "all"
          ? []
          : [query.status === "closed" ? sql`quantity_remaining=0` : sql`quantity_remaining>0`]),
      ),
    )
    .orderBy(asc(portfolioLots.id))
    .limit((query.limit ?? 50) + 1);
  const chosen = rows.slice(0, query.limit ?? 50),
    hasMore = rows.length > chosen.length;
  const consumptions = chosen.length
    ? await tx
        .select()
        .from(portfolioLotConsumptions)
        .where(
          inArray(
            portfolioLotConsumptions.lotId,
            chosen.map((r) => r.id),
          ),
        )
    : [];
  const amount = (v: string | null, currency: string) =>
    v === null ? null : { amount: v, currency };
  return lotPage.parse({
    data: chosen.map((l) => ({
      id: l.id,
      accountId: l.accountId,
      instrumentId: l.instrumentId,
      openTransactionId: l.openTransactionId,
      acquiredOn: l.acquiredOn,
      quantityOpen: l.quantityOpen,
      quantityRemaining: l.quantityRemaining,
      costTotal: amount(l.costTotal, l.costCurrency),
      costTotalTax: amount(l.costTotalTaxPln, "PLN"),
      feesTotal: amount(l.feesTotal, l.costCurrency),
      splitFactor: l.splitFactor,
      ...(l.closedOn ? { closedOn: l.closedOn } : {}),
      consumptions: consumptions
        .filter((c) => c.lotId === l.id)
        .map((c) => ({
          closeTransactionId: c.closeTransactionId,
          quantity: c.quantity,
          closedOn: c.closedOn,
          costEconomic: amount(c.costEconomic, l.costCurrency),
          proceedsEconomic: amount(c.proceedsEconomic, l.costCurrency),
          realizedPlEconomic: amount(c.realizedPlEconomic, l.costCurrency),
          costTax: amount(c.costTaxPln, "PLN"),
          proceedsTax: amount(c.proceedsTaxPln, "PLN"),
          realizedPlTax: amount(c.realizedPlTaxPln, "PLN"),
        })),
    })),
    method: "fifo",
    page: {
      hasMore,
      ...(hasMore
        ? {
            nextCursor: Buffer.from(
              JSON.stringify({ id: chosen.at(-1)!.id, fingerprint }),
            ).toString("base64url"),
          }
        : {}),
    },
  });
}
