import {
  convertMoney,
  Decimal,
  divideMoney,
  type FxRateTable,
  grossValue,
  type IsoDate,
  type Ledger,
  type Money,
  moneyFromJson,
  moneyToJson,
  priceFxEffect,
  type Quote,
  subtractMoney,
  sumMoney,
  valuePortfolio,
} from "@oliginvest/core";
import type { metaSchema, summarySchema } from "@oliginvest/mod-market/contracts";
import type { z } from "zod";
import { parsePosition, positionsResponse } from "../contracts.js";

export type ReadQuote = Quote & { meta: z.infer<typeof metaSchema> };
export type ReadInput = {
  accounts: Parameters<typeof valuePortfolio>[0]["accounts"];
  ledger: Ledger;
  quotes: ReadQuote[];
  instruments: z.infer<typeof summarySchema>[];
  fx: FxRateTable;
  date: IsoDate;
  view: "economic" | "tax";
  groupBy: "account_instrument" | "instrument";
};
export const jsonMoney = (value: Money | null) =>
  value === null ? null : moneyToJson(value, { fractionDigits: 8 });
export function baseMoney(value: Money | null, fx: FxRateTable, date: IsoDate) {
  if (!value) return null;
  const rate = fx.onOrBefore(value.currency, "PLN", date);
  return rate ? convertMoney(value, rate) : null;
}
export function readMeta(quotes: ReadQuote[], complete = true): z.infer<typeof metaSchema> {
  const oldest = quotes.toSorted((a, b) => a.asOf.localeCompare(b.asOf))[0];
  const stale = quotes.find((q) => q.meta.stale);
  return {
    source: quotes.length === 1 ? quotes[0]!.meta.source : "mixed",
    asOf: oldest?.asOf ?? "1970-01-01T00:00:00Z",
    delayMinutes: Math.max(0, ...quotes.map((q) => q.meta.delayMinutes)),
    stale: !complete || Boolean(stale),
    ...(!complete
      ? { staleReason: "no_data" as const }
      : stale?.meta.staleReason
        ? { staleReason: stale.meta.staleReason }
        : {}),
    attribution: [...new Set(quotes.map((q) => q.meta.attribution).filter(Boolean))].join(" · "),
  };
}
export function projectPortfolio(input: ReadInput) {
  const { fx, date } = input;
  const valued = valuePortfolio({
    accounts: input.accounts,
    positions: input.ledger.positions,
    cash: input.ledger.cash,
    quotes: input.quotes,
    fxRates: fx,
    date,
  });
  const exclusions: { accountId: string; instrumentId: string }[] = [];
  const data = valued.accounts.flatMap((account) =>
    account.positions.map((p) => {
      const instrument = input.instruments.find((i) => i.id === p.instrumentId);
      if (!instrument) throw new Error("MISSING_INSTRUMENT");
      const original = input.ledger.positions.find(
        (i) => i.accountId === p.accountId && i.instrumentId === p.instrumentId,
      )!;
      const cost = input.view === "tax" ? original.taxCost : baseMoney(p.cost, fx, date);
      const value = baseMoney(p.marketValue, fx, date);
      const pl = value && cost ? subtractMoney(value, cost) : null;
      if (!cost) exclusions.push({ accountId: p.accountId, instrumentId: p.instrumentId });
      const market = p.price ? grossValue(p.price, p.quantity) : null;
      const effects =
        input.view === "economic" &&
        cost &&
        value &&
        market &&
        original.costInstrument &&
        !original.costInstrument.amount.isZero()
          ? priceFxEffect({
              cost,
              costInstrument: original.costInstrument,
              value,
              valueInstrument: market,
            })
          : null;
      const meta = readMeta(
        input.quotes.filter((q) => q.instrumentId === p.instrumentId),
        value !== null,
      );
      return parsePosition(
        {
          accountId: p.accountId,
          instrument,
          quantity: p.quantity.toFixed(),
          costBasis: jsonMoney(cost),
          averageCost:
            cost && !p.quantity.isZero() ? jsonMoney(divideMoney(cost, p.quantity)) : null,
          ...(p.price ? { price: p.price.amount.toFixed(), priceCurrency: p.price.currency } : {}),
          marketValue: jsonMoney(market),
          marketValueBase: jsonMoney(value),
          unrealizedPl: jsonMoney(pl),
          unrealizedPlInstrumentCurrency: jsonMoney(
            input.view === "economic" && market && original.costInstrument
              ? subtractMoney(market, original.costInstrument)
              : null,
          ),
          unrealizedPlRatio:
            pl && cost && !cost.amount.isZero()
              ? divideMoney(pl, cost.amount).amount.toNumber()
              : null,
          priceEffect: jsonMoney(effects?.priceEffect ?? null),
          fxEffect: jsonMoney(effects?.fxEffect ?? null),
          weight:
            valued.isComplete && value && !valued.total.amount.isZero()
              ? divideMoney(value, valued.total.amount).amount.toNumber()
              : null,
          meta,
        },
        "account_instrument",
      );
    }),
  );
  const sum = (key: "marketValueBase" | "costBasis" | "unrealizedPl") =>
    jsonMoney(
      sumMoney(
        data.flatMap((p) => (p[key] ? [moneyFromJson(p[key]!)] : [])),
        "PLN",
      ),
    );
  const totals = {
    marketValueBase: sum("marketValueBase"),
    costBasis: sum("costBasis"),
    unrealizedPl: sum("unrealizedPl"),
    exclusions: { count: exclusions.length, positions: exclusions },
  };
  const grouped = new Map<string, typeof data>();
  for (const p of data) grouped.set(p.instrument.id, [...(grouped.get(p.instrument.id) ?? []), p]);
  const combined =
    input.groupBy === "instrument"
      ? [...grouped.values()].map((rows) => {
          const { accountId: _account, ...first } = rows[0]!;
          const sumField = (
            key:
              | "marketValue"
              | "marketValueBase"
              | "costBasis"
              | "unrealizedPl"
              | "unrealizedPlInstrumentCurrency"
              | "priceEffect"
              | "fxEffect",
          ) => {
            const values = rows.map((r) => r[key]);
            if (values.some((v) => !v)) return null;
            return jsonMoney(
              sumMoney(
                values.map((v) => moneyFromJson(v!)),
                values[0]!.currency,
              ),
            );
          };
          const cost = sumField("costBasis"),
            value = sumField("marketValueBase"),
            pl = sumField("unrealizedPl");
          const q = rows.reduce((total, r) => total.plus(r.quantity), new Decimal(0));
          return parsePosition(
            {
              ...first,
              quantity: q.toFixed(),
              costBasis: cost,
              marketValue: sumField("marketValue"),
              marketValueBase: value,
              unrealizedPl: pl,
              unrealizedPlInstrumentCurrency: sumField("unrealizedPlInstrumentCurrency"),
              meta: readMeta(
                input.quotes.filter((quote) => quote.instrumentId === first.instrument.id),
                value !== null,
              ),
              averageCost:
                cost && !q.isZero() ? jsonMoney(divideMoney(moneyFromJson(cost), q)) : null,
              unrealizedPlRatio:
                pl && cost && !new Decimal(cost.amount).isZero()
                  ? divideMoney(moneyFromJson(pl), cost.amount).amount.toNumber()
                  : null,
              priceEffect: sumField("priceEffect"),
              fxEffect: sumField("fxEffect"),
              weight:
                valued.isComplete && value && !valued.total.amount.isZero()
                  ? divideMoney(moneyFromJson(value), valued.total.amount).amount.toNumber()
                  : null,
            },
            "instrument",
          );
        })
      : data;
  return positionsResponse.parse({
    data: combined,
    totals,
    view: input.view,
    isComplete: valued.isComplete,
    meta: readMeta(input.quotes, valued.isComplete),
  });
}
