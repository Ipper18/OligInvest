import {
  addDays,
  buildLedger,
  convertMoney,
  createFxRateTable,
  dayChange,
  externalFlows,
  fxRate,
  grossValue,
  isoDate,
  moneyToJson,
  price,
  settlementCycleDays,
  settlementDate,
  settlementRegionForMic,
  sumMoney,
  type Transaction,
  valuePortfolio,
} from "@oliginvest/core";
import type { DatabaseContext, DatabaseTransaction } from "@oliginvest/db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  portfolioCashBalancesDaily as cashTable,
  portfolioLotConsumptions as consumptionsTable,
  portfolioLots as lotsTable,
  portfolioPositionsDaily as positionsTable,
  portfolioValuationsDaily as valuationsTable,
} from "../db/schema.js";
import { recomputeJob } from "./contracts.js";
import { loadLedger, type PortfolioRepository } from "./server/repository.js";

export const portfolioDate = (now: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
async function valuationState(tx: DatabaseTransaction, to: string) {
  const state = await loadLedger(tx);
  const instrumentIds = [
    ...new Set(state.rows.flatMap((r) => (r.instrumentId ? [r.instrumentId] : []))),
  ];
  const rates = (
    await tx.execute(
      sql`SELECT base,quote,rate_date::text AS date,rate::text,source FROM market.fx_rates WHERE rate_date<=${to}::date ORDER BY rate_date`,
    )
  ).rows;
  const rateSchema = z
    .object({
      base: z.string(),
      quote: z.string(),
      date: z.iso.date(),
      rate: z.string(),
      source: z.enum(["nbp", "ecb"]),
    })
    .strict();
  const parsed = rates.map((r) => rateSchema.parse(r));
  const preferred = new Map<string, (typeof parsed)[number]>();
  for (const r of parsed) {
    const key = `${r.base}:${r.quote}:${r.date}`;
    if (!preferred.has(key) || r.source === "nbp") preferred.set(key, r);
  }
  const fx = createFxRateTable([...preferred.values()].map(fxRate)),
    taxRates = createFxRateTable(parsed.filter((r) => r.source === "nbp").map(fxRate));
  const bars = (
    await tx.execute(
      sql`SELECT b.instrument_id::text AS id,b.session_date::text AS date,b.close::text AS price,i.currency,b.source FROM market.bars_daily b JOIN market.instruments i ON i.id=b.instrument_id WHERE b.instrument_id=ANY(${sql.param(instrumentIds)}::uuid[]) AND session_date<=${to}::date ORDER BY session_date`,
    )
  ).rows.map((r) =>
    z
      .object({
        id: z.uuid(),
        date: z.iso.date(),
        price: z.string(),
        currency: z.string(),
        source: z.string(),
      })
      .strict()
      .parse(r),
  );
  const preferences = (
    await tx.execute(
      sql`SELECT tax_date_basis AS "dateBasis",tax_include_fx_fee AS "includeFxFee" FROM identity.user_preferences`,
    )
  ).rows[0];
  const taxSettings = preferences
    ? z
        .object({ dateBasis: z.enum(["settlement", "trade"]), includeFxFee: z.boolean() })
        .strict()
        .parse(preferences)
    : undefined;
  const instruments = (
    await tx.execute(
      sql`SELECT id::text,mic FROM market.instruments WHERE id=ANY(${sql.param(instrumentIds)}::uuid[])`,
    )
  ).rows;
  const calendar = (
    await tx.execute(
      sql`SELECT mic,session_date::text AS date,is_open AS "isOpen",notes FROM market.trading_calendar WHERE session_date<=${addDays(to, 31)}::date`,
    )
  ).rows;
  const mics = new Map(instruments.map((r) => [String(r.id), String(r.mic)]));
  const days = new Map(calendar.map((r) => [`${r.mic}:${r.date}`, r]));
  const transactions = state.transactions.map((t): Transaction => {
    if (t.settleDate || !("instrumentId" in t)) return t;
    const mic = mics.get(t.instrumentId),
      region = mic ? settlementRegionForMic(mic) : undefined;
    if (!region) return t;
    try {
      return {
        ...t,
        settleDate: settlementDate(
          t.tradeDate,
          settlementCycleDays(region, t.tradeDate),
          (date) => {
            const day = days.get(`${mic}:${date}`);
            if (!day) throw new Error("MISSING_CALENDAR");
            return Boolean(day.isOpen) && !String(day.notes ?? "").includes("[settlement:closed]");
          },
        ),
      };
    } catch {
      return t;
    }
  });
  const quotesOn = (date: string) => {
    const selected = new Map<string, (typeof bars)[number]>();
    for (const bar of bars) {
      if (bar.date > date) break;
      selected.set(bar.id, bar);
    }
    return [...selected.values()].map((bar) => ({
      instrumentId: bar.id,
      price: price(bar.price, bar.currency),
      asOf: `${bar.date}T00:00:00.000Z`,
    }));
  };
  const ledgerOn = (date: string) =>
    buildLedger({
      accounts: state.accounts,
      transactions: transactions.filter((t) => t.tradeDate <= date),
      taxRates,
      ...(taxSettings ? { taxSettings } : {}),
    });
  return { ...state, transactions, fx, ledgerOn, quotesOn };
}
function transferValue(
  t: Transaction,
  quotes: ReturnType<Awaited<ReturnType<typeof valuationState>>["quotesOn"]>,
) {
  if (!("quantity" in t) || !("instrumentId" in t)) return undefined;
  const quote = quotes.find((q) => q.instrumentId === t.instrumentId);
  return quote ? grossValue(quote.price, t.quantity) : undefined;
}

/** Rebuild derived state atomically under the same owner lock as operation mutations. */
export async function recomputePortfolio(
  repository: PortfolioRepository,
  raw: unknown,
  publish: (userId: string, event: unknown) => Promise<void>,
  now = () => new Date(),
) {
  const payload = recomputeJob.parse(raw),
    context = { userId: payload.userId, role: "user" as const },
    today = portfolioDate(now());
  const accountIds = await repository.mutate(context, async (tx) => {
    const state = await valuationState(tx, today),
      ledger = state.ledgerOn(today);
    // Replaying all accounts also updates the counterpart of linked security transfers.
    await tx.delete(lotsTable);
    const generated = (
      await tx.execute(
        sql`SELECT uuidv7()::text AS id FROM generate_series(1,${ledger.lots.length})`,
      )
    ).rows;
    const lotIds = new Map(ledger.lots.map((lot, i) => [lot.key, String(generated[i]!.id)]));
    const lotRows = ledger.lots.map((lot) => ({
      id: lotIds.get(lot.key)!,
      userId: payload.userId,
      accountId: lot.accountId,
      instrumentId: lot.instrumentId,
      openTransactionId: lot.openTransactionId,
      acquiredOn: lot.acquiredOn,
      quantityOpen: lot.quantityAcquired.toFixed(),
      quantityRemaining: lot.quantityRemaining.toFixed(),
      costTotal: lot.cost?.amount.toFixed() ?? null,
      costCurrency:
        lot.cost?.currency ?? state.accounts.find((a) => a.id === lot.accountId)!.currency,
      costTotalInstrumentCcy: lot.costInstrument?.amount.toFixed() ?? null,
      costTotalTaxPln: lot.taxCost?.amount.toFixed() ?? null,
      fxFeeTotal: lot.fxFee.amount.toFixed(),
      splitFactor: lot.splitFactor.toFixed(),
      closedOn: lot.closedOn,
      transferRate: lot.transferRate
        ? { ...lot.transferRate, rate: lot.transferRate.rate.toFixed() }
        : null,
      computedAt: now().toISOString(),
    }));
    for (let i = 0; i < lotRows.length; i += 500)
      await tx.insert(lotsTable).values(lotRows.slice(i, i + 500));
    const consumptions = ledger.sales
      .flatMap((sale) => sale.consumptions)
      .map((c) => ({
        userId: payload.userId,
        lotId: lotIds.get(c.lotKey)!,
        closeTransactionId: c.closeTransactionId,
        quantity: c.quantity.toFixed(),
        costEconomic: c.costEconomic?.amount.toFixed() ?? null,
        proceedsEconomic: c.proceedsEconomic.amount.toFixed(),
        realizedPlEconomic: c.realizedPlEconomic?.amount.toFixed() ?? null,
        costTaxPln: c.tax?.costPln.amount.toFixed() ?? null,
        proceedsTaxPln: c.tax?.proceedsPln.amount.toFixed() ?? null,
        realizedPlTaxPln: c.tax?.realizedPlPln.amount.toFixed() ?? null,
        fxCostPln: c.tax?.fxCostPln.amount.toFixed() ?? null,
        closedOn: c.closedOn,
      }));
    for (let i = 0; i < consumptions.length; i += 500)
      await tx.insert(consumptionsTable).values(consumptions.slice(i, i + 500));
    const first = state.transactions.map((t) => t.tradeDate).sort()[0] ?? today;
    const from = payload.fromDate < first ? first : payload.fromDate;
    await tx.delete(positionsTable).where(sql`valuation_date>=${payload.fromDate}::date`);
    await tx.delete(cashTable).where(sql`valuation_date>=${payload.fromDate}::date`);
    await tx.delete(valuationsTable).where(sql`valuation_date>=${payload.fromDate}::date`);
    const positions: (typeof positionsTable.$inferInsert)[] = [],
      cash: (typeof cashTable.$inferInsert)[] = [],
      values: (typeof valuationsTable.$inferInsert)[] = [];
    for (let date = from; date <= today; date = addDays(date, 1)) {
      const current = state.ledgerOn(date),
        quotes = state.quotesOn(date),
        valuation = valuePortfolio({
          accounts: state.accounts,
          positions: current.positions,
          cash: current.cash,
          quotes,
          fxRates: state.fx,
          date: isoDate(date),
        });
      let flows: ReturnType<typeof externalFlows> = [],
        flowsComplete = true;
      try {
        flows = externalFlows(
          state.transactions.filter((t) => t.tradeDate <= date),
          {
            level: "account",
            securityTransferValue: (t) => transferValue(t, state.quotesOn(t.tradeDate)),
          },
        );
      } catch {
        flowsComplete = false;
      }
      for (const account of valuation.accounts) {
        const fx = state.fx.onOrBefore(account.currency, "PLN", date);
        const converted = flows
          .filter((f) => f.accountId === account.accountId && f.date === date)
          .flatMap((f) => {
            const rate = state.fx.onOrBefore(f.amount.currency, account.currency, date);
            if (!rate) {
              flowsComplete = false;
              return [];
            }
            return [convertMoney(f.amount, rate)];
          });
        const flow = sumMoney(converted, account.currency);
        values.push({
          userId: payload.userId,
          accountId: account.accountId,
          valuationDate: date,
          marketValue: account.marketValue.amount.toFixed(),
          cash: account.cash.amount.toFixed(),
          totalValue: account.total.amount.toFixed(),
          totalValuePln: account.totalReporting?.amount.toFixed() ?? "0",
          externalFlow: flow.amount.toFixed(),
          externalFlowPln: fx ? convertMoney(flow, fx).amount.toFixed() : "0",
          fxRateToPln: fx?.rate.toFixed() ?? null,
          asOf: valuation.asOf ?? `${date}T23:59:59.000Z`,
          isComplete: account.isComplete && flowsComplete,
        });
        for (const p of account.positions)
          positions.push({
            userId: payload.userId,
            accountId: p.accountId,
            instrumentId: p.instrumentId,
            valuationDate: date,
            quantity: p.quantity.toFixed(),
            costBasis: p.cost?.amount.toFixed() ?? null,
            price: p.price?.amount.toFixed() ?? null,
            priceCurrency: p.price?.currency ?? null,
            priceAsOf: p.priceAsOf,
            fxRateToAccount: p.fxRate?.rate.toFixed() ?? null,
            marketValue: p.marketValue?.amount.toFixed() ?? null,
            marketValuePln:
              p.marketValue && fx ? convertMoney(p.marketValue, fx).amount.toFixed() : null,
            unrealizedPlPln:
              p.unrealizedPl && fx ? convertMoney(p.unrealizedPl, fx).amount.toFixed() : null,
          });
      }
      for (const balance of current.cash)
        cash.push({
          userId: payload.userId,
          accountId: balance.accountId,
          valuationDate: date,
          currency: balance.balance.currency,
          balance: balance.balance.amount.toFixed(),
        });
    }
    for (let i = 0; i < positions.length; i += 500)
      await tx.insert(positionsTable).values(positions.slice(i, i + 500));
    for (let i = 0; i < cash.length; i += 500)
      await tx.insert(cashTable).values(cash.slice(i, i + 500));
    for (let i = 0; i < values.length; i += 500)
      await tx.insert(valuationsTable).values(values.slice(i, i + 500));
    return state.accounts.map((a) => a.id);
  });
  await publish(payload.userId, {
    event: "portfolio.valuation.updated",
    data: { v: 1, accountIds, valuationAsOf: now().toISOString(), reason: payload.reason },
  });
}

/** Current quote valuation is read-only and stays within the authenticated owner's context. */
export async function livePortfolioValuation(
  repository: PortfolioRepository,
  context: DatabaseContext,
  now = () => new Date(),
) {
  return repository.read(context, async (tx) => {
    const date = portfolioDate(now()),
      state = await valuationState(tx, date),
      ledger = state.ledgerOn(date);
    const latest = (
      await tx.execute(
        sql`SELECT q.instrument_id::text AS id,q.price::text,i.currency,q.as_of AS "asOf",q.source FROM market.quotes_latest q JOIN market.instruments i ON i.id=q.instrument_id WHERE q.instrument_id=ANY(${sql.param([...new Set(ledger.positions.map((p) => p.instrumentId))])}::uuid[])`,
      )
    ).rows;
    const selected = new Map(state.quotesOn(date).map((q) => [q.instrumentId, q]));
    for (const q of latest) {
      const asOf = new Date(String(q.asOf)).toISOString();
      const old = selected.get(String(q.id));
      if (!old || asOf > old.asOf)
        selected.set(String(q.id), {
          instrumentId: String(q.id),
          price: price(String(q.price), String(q.currency)),
          asOf,
        });
    }
    const valuation = valuePortfolio({
      accounts: state.accounts,
      positions: ledger.positions,
      cash: ledger.cash,
      quotes: [...selected.values()],
      fxRates: state.fx,
      date: isoDate(date),
    });
    const previous = state.ledgerOn(addDays(date, -1)),
      previousValue = valuePortfolio({
        accounts: state.accounts,
        positions: previous.positions,
        cash: previous.cash,
        quotes: state.quotesOn(addDays(date, -1)),
        fxRates: state.fx,
        date: addDays(date, -1),
      });
    let summary:
      | {
          totalValue: ReturnType<typeof moneyToJson>;
          dayChange: ReturnType<typeof moneyToJson>;
          dayChangeRatio: number;
          source: string;
        }
      | undefined;
    if (valuation.isComplete && previousValue.isComplete) {
      try {
        const flows = externalFlows(state.transactions, {
          level: "portfolio",
          securityTransferValue: (t) => transferValue(t, state.quotesOn(t.tradeDate)),
        })
          .filter((f) => f.date === date)
          .map((f) => {
            const rate = state.fx.onOrBefore(f.amount.currency, "PLN", date);
            if (!rate) throw new Error("MISSING_FX");
            return convertMoney(f.amount, rate);
          });
        const change = dayChange({
          valueNow: valuation.total,
          valuePrevClose: previousValue.total,
          externalFlows: sumMoney(flows, "PLN"),
        });
        if (change.ratio !== null)
          summary = {
            totalValue: moneyToJson(valuation.total),
            dayChange: moneyToJson(change.change),
            dayChangeRatio: change.ratio,
            source: [...new Set(latest.map((q) => String(q.source)))].join(",") || "eod",
          };
      } catch {
        /* The client refreshes the complete REST state when flow valuation is unavailable. */
      }
    }
    return {
      v: 1 as const,
      accountIds: state.accounts.map((a) => a.id),
      valuationAsOf: valuation.asOf ?? now().toISOString(),
      reason: "quotes" as const,
      ...(summary ? { summary } : {}),
    };
  });
}
