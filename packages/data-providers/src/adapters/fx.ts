import { addDays, daysBetween } from "@oliginvest/core";
import { z } from "zod";
import {
  currencySchema,
  type DataProvider,
  decimalText,
  type FxRate,
  fxSchema,
  ProviderError,
} from "../contracts.js";
import { limitedText, parseDecimalJson } from "../transport.js";

const tableSchema = z.array(
  z
    .object({
      table: z.literal("A"),
      no: z.string(),
      effectiveDate: z.iso.date(),
      rates: z.array(
        z.object({ currency: z.string(), code: currencySchema, mid: decimalText }).strict(),
      ),
    })
    .strict(),
);
export class NbpProvider implements DataProvider {
  readonly meta = {
    id: "nbp",
    capabilities: ["fxRate"],
    markets: ["FX"],
    quota: { perMinute: 6 },
    delayMinutes: 0,
    license: "Kursy: NBP",
  } as const;
  constructor(
    private readonly request: typeof fetch,
    private readonly now = () => new Date(),
  ) {}
  async getTable(from: string, to: string): Promise<FxRate[]> {
    z.iso.date().parse(from);
    z.iso.date().parse(to);
    if (daysBetween(from, to) < 0 || daysBetween(from, to) > 92)
      throw new Error("NBP range exceeds 93 days");
    let text: string;
    try {
      text = await limitedText(
        await this.request(
          `https://api.nbp.pl/api/exchangerates/tables/A/${from}/${to}/?format=json`,
        ),
      );
    } catch (error) {
      if (error instanceof ProviderError && error.status === 404)
        throw new ProviderError("no_data");
      throw error;
    }
    return tableSchema.parse(parseDecimalJson(text)).flatMap((table) => {
      if (table.effectiveDate < from || table.effectiveDate > to)
        throw new ProviderError("provider_error");
      return table.rates
        .filter(({ code }) => code === "USD" || code === "EUR")
        .map(({ code, mid }) =>
          fxSchema.parse({
            base: code,
            quote: "PLN",
            date: table.effectiveDate,
            rate: mid,
            tableNo: table.no,
            meta: {
              source: "nbp",
              asOf: `${table.effectiveDate}T00:00:00Z`,
              delayMinutes: 0,
              stale: false,
              attribution: "Kursy: NBP",
            },
            fetchedAt: this.now().toISOString(),
          }),
        );
    });
  }
  async getFxRate(base: string, quote: string, date: string): Promise<FxRate[]> {
    if (!["USD", "EUR"].includes(base) || quote !== "PLN") throw new ProviderError("no_data");
    return (await this.getTable(date, date)).filter((rate) => rate.base === base);
  }
}
const ecbSchema = z.array(
  z
    .object({ date: z.iso.date(), base: currencySchema, quote: currencySchema, rate: decimalText })
    .strict(),
);
export class FrankfurterProvider implements DataProvider {
  readonly meta = {
    id: "ecb",
    capabilities: ["fxRate"],
    markets: ["FX"],
    quota: { perMinute: 6 },
    delayMinutes: 0,
    license: "Kursy: EBC (Frankfurter)",
  } as const;
  constructor(
    private readonly request: typeof fetch,
    private readonly now = () => new Date(),
  ) {}
  async getFxRate(base: string, quote: string, date: string): Promise<FxRate[]> {
    currencySchema.parse(base);
    currencySchema.parse(quote);
    z.iso.date().parse(date);
    const params = new URLSearchParams({ base, quotes: quote, date });
    const values = ecbSchema.parse(
      parseDecimalJson(
        await limitedText(
          await this.request(`https://api.frankfurter.dev/v2/providers/ecb/rates?${params}`),
        ),
      ),
    );
    return values.map((value) => {
      if (value.base !== base || value.quote !== quote || value.date > date)
        throw new ProviderError("provider_error");
      return fxSchema.parse({
        ...value,
        meta: {
          source: "ecb",
          asOf: `${value.date}T00:00:00Z`,
          delayMinutes: 0,
          stale: true,
          staleReason: "provider_error",
          attribution: "Kursy: EBC (Frankfurter)",
        },
        fetchedAt: this.now().toISOString(),
      });
    });
  }
}
export function nbpRanges(from: string, to: string): { from: string; to: string }[] {
  z.iso.date().parse(from);
  z.iso.date().parse(to);
  if (from > to) throw new Error("Invalid range");
  const result = [];
  for (let date = from; date <= to; date = addDays(date, 93))
    result.push({ from: date, to: addDays(date, 92) < to ? addDays(date, 92) : to });
  return result;
}
