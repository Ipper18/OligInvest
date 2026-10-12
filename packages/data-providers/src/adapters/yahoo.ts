import { addDays, marketPriceChange } from "@oliginvest/core";
import { z } from "zod";
import {
  type Bar,
  barSchema,
  type DataProvider,
  decimalText,
  ProviderError,
  type Quote,
  quoteSchema,
  type SymbolHit,
  symbolSchema,
} from "../contracts.js";
import { limitedText, parseDecimalJson } from "../transport.js";

export type YahooInstrument = { id: string; symbol: string; currency: string; mic: string };
type Resolve = (id: string) => Promise<YahooInstrument>;
const HOST = "https://query2.finance.yahoo.com";
// Yahoo tickers only (PKO.WA, ^GSPC, BRK-B); anything else never reaches the URL path.
const yahooSymbol = z.string().regex(/^[A-Za-z0-9^][A-Za-z0-9.^=-]{0,31}$/u);
const unixSeconds = z.string().regex(/^\d{1,12}$/u);
const record = z.record(z.string(), z.unknown());
const chartEnvelope = z
  .object({ chart: z.object({ error: z.null(), result: z.array(record).length(1) }).strict() })
  .strict();
const chartMeta = z
  .object({
    currency: z.string(),
    symbol: z.string(),
    price: decimalText.optional(),
    time: unixSeconds.optional(),
    prevClose: decimalText.optional(),
    volume: decimalText.optional(),
  })
  .strict();
const chartData = z
  .object({
    meta: record,
    // Yahoo omits the series when the range holds no session (holiday, pre-listing).
    timestamp: z.array(unixSeconds).optional(),
    indicators: z
      .object({
        quote: z
          .array(
            z
              .object({
                open: z.array(decimalText.nullable()).optional(),
                high: z.array(decimalText.nullable()).optional(),
                low: z.array(decimalText.nullable()).optional(),
                close: z.array(decimalText.nullable()).optional(),
                volume: z.array(decimalText.nullable()).optional(),
              })
              .strict(),
          )
          .length(1),
        adjclose: z.array(record).optional(),
      })
      .strict(),
    events: record.optional(),
  })
  .strict();
const searchHit = z
  .object({
    symbol: z.string(),
    exchange: z.string().optional(),
    quoteType: z.string().optional(),
    name: z.string().optional(),
  })
  .strict();
const MIC: Record<string, string> = {
  WSE: "XWAR",
  NYQ: "XNYS",
  NMS: "XNAS",
  NGM: "XNAS",
  NCM: "XNAS",
  PCX: "ARCX",
};
const TYPE: Record<string, SymbolHit["type"]> = { EQUITY: "stock", ETF: "etf", INDEX: "index" };
/** Parallel chart requests per quote run and a deadline inside the 30 s single-flight lease. */
const QUOTE_CONCURRENCY = 4;
const QUOTE_DEADLINE_MS = 20_000;

/**
 * Thin client of Yahoo's public chart (v8) and search (v1) endpoints on our transport: honest
 * User-Agent, host allowlist, no redirects, size limit and lossless JSON → Decimal. Neither
 * endpoint needs cookies or a crumb, so the adapter never requests them (BL-159, R-33).
 */
export class YahooProvider implements DataProvider {
  readonly meta = {
    id: "yahoo",
    capabilities: ["eodBars", "intradayQuote", "symbolSearch"],
    markets: ["XWAR", "XNYS", "XNAS", "ARCX"],
    quota: { perMinute: 30 },
    delayMinutes: 15,
    license: "Dane: Yahoo Finance",
  } as const;
  /** Round-robin position, so a quota cut never starves the same instruments every run. */
  private cursor = "";
  constructor(
    private readonly request: typeof fetch,
    private readonly resolve: Resolve,
    private readonly now = () => new Date(),
  ) {}
  private async json(path: string, params: Record<string, string>): Promise<unknown> {
    try {
      const response = await this.request(`${HOST}${path}?${new URLSearchParams(params)}`, {
        headers: { Accept: "application/json" },
      });
      return parseDecimalJson(await limitedText(response, 10_000_000));
    } catch (error) {
      if (error instanceof ProviderError)
        throw error.status === 404 ? new ProviderError("no_data") : error;
      throw new ProviderError("provider_error");
    }
  }
  private async chart(symbol: string, params: Record<string, string>) {
    const raw = await this.json(`/v8/finance/chart/${encodeURIComponent(symbol)}`, params);
    const parsed = chartEnvelope.safeParse(raw);
    const data = parsed.success ? chartData.safeParse(parsed.data.chart.result[0]) : parsed;
    if (!data.success) throw new ProviderError("provider_error");
    const values = data.data.meta;
    const meta = chartMeta.safeParse({
      currency: values.currency,
      symbol: values.symbol,
      price: values.regularMarketPrice,
      time: values.regularMarketTime,
      // range=1d carries previousClose; chartPreviousClose is the close before the range.
      prevClose: values.previousClose ?? values.chartPreviousClose,
      volume: values.regularMarketVolume,
    });
    if (!meta.success || meta.data.symbol !== symbol) throw new ProviderError("provider_error");
    return { ...data.data, meta: meta.data };
  }
  private async quote(item: YahooInstrument): Promise<Quote> {
    const { meta } = await this.chart(yahooSymbol.parse(item.symbol), {
      range: "1d",
      interval: "1d",
      includePrePost: "false",
    });
    if (meta.currency !== item.currency || !meta.price || !meta.time)
      throw new ProviderError("provider_error");
    return quoteSchema.parse({
      instrumentId: item.id,
      price: meta.price,
      currency: meta.currency,
      ...(meta.prevClose ? { prevClose: meta.prevClose } : {}),
      ...(meta.volume ? { volume: meta.volume } : {}),
      ...(meta.prevClose ? marketPriceChange(meta.price, meta.prevClose) : {}),
      meta: {
        source: "yahoo",
        asOf: new Date(Number(meta.time) * 1000).toISOString(),
        delayMinutes: this.meta.delayMinutes,
        stale: false,
        attribution: this.meta.license,
      },
      fetchedAt: this.now().toISOString(),
    });
  }
  /**
   * One chart request per instrument (the batched v7 quote endpoint requires a cookie and crumb).
   * A quota cut or the deadline returns the quotes fetched so far; the rest keep their last value
   * and turn stale. Without any quote the first error is thrown, never a made-up price.
   */
  async getIntradayQuotes(ids: string[]): Promise<Quote[]> {
    const unique = [...new Set(ids.map((id) => z.uuid().parse(id)))].sort();
    const start = unique.findIndex((id) => id > this.cursor);
    const ordered = start > 0 ? [...unique.slice(start), ...unique.slice(0, start)] : unique;
    const instruments = await Promise.all(ordered.map((id) => this.resolve(id)));
    const deadline = performance.now() + QUOTE_DEADLINE_MS;
    const output: Quote[] = [];
    let failure: unknown;
    for (let index = 0; index < instruments.length; index += QUOTE_CONCURRENCY) {
      if (performance.now() > deadline) break;
      const batch = instruments.slice(index, index + QUOTE_CONCURRENCY);
      const results = await Promise.allSettled(batch.map((item) => this.quote(item)));
      let cut = false;
      results.forEach((result, position) => {
        const quota =
          result.status === "rejected" &&
          result.reason instanceof ProviderError &&
          result.reason.reason === "provider_quota";
        if (result.status === "fulfilled") output.push(result.value);
        else failure ??= result.reason;
        if (quota) cut = true;
        else if (!cut) this.cursor = batch[position]?.id ?? this.cursor;
      });
      if (cut) break;
    }
    if (!output.length && failure) {
      throw failure instanceof ProviderError ? failure : new ProviderError("provider_error");
    }
    return output;
  }
  async getEodBars(id: string, range: { from: string; to: string }): Promise<Bar[]> {
    z.iso.date().parse(range.from);
    z.iso.date().parse(range.to);
    const instrument = await this.resolve(z.uuid().parse(id));
    const seconds = (date: string) => String(Date.parse(`${date}T00:00:00Z`) / 1000);
    const data = await this.chart(yahooSymbol.parse(instrument.symbol), {
      period1: seconds(range.from),
      period2: seconds(addDays(range.to, 1)),
      interval: "1d",
      includePrePost: "false",
    });
    if (data.meta.currency !== instrument.currency) throw new ProviderError("provider_error");
    const timestamps = data.timestamp ?? [];
    const values = data.indicators.quote[0];
    const column = (name: "open" | "high" | "low" | "close" | "volume") => {
      const series = values?.[name] ?? (timestamps.length ? undefined : []);
      if (!series || series.length !== timestamps.length) throw new ProviderError("provider_error");
      return series;
    };
    const [open, high, low, close, volume] = (
      ["open", "high", "low", "close", "volume"] as const
    ).map(column);
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: instrument.mic === "XWAR" ? "Europe/Warsaw" : "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return timestamps.flatMap((ts, index) => {
      const last = close?.[index];
      if (last == null) return [];
      const date = day.format(new Date(Number(ts) * 1000));
      if (date < range.from || date > range.to) return [];
      return [
        barSchema.parse({
          instrumentId: id,
          date,
          open: open?.[index] ?? null,
          high: high?.[index] ?? null,
          low: low?.[index] ?? null,
          close: last,
          volume: volume?.[index] ?? "0",
          noTrades: volume?.[index] === "0",
          currency: instrument.currency,
          meta: {
            source: "yahoo",
            asOf: new Date(Number(ts) * 1000).toISOString(),
            delayMinutes: 0,
            stale: false,
            attribution: this.meta.license,
          },
          fetchedAt: this.now().toISOString(),
        }),
      ];
    });
  }
  async searchSymbols(query: string): Promise<SymbolHit[]> {
    z.string().min(1).max(100).parse(query);
    const raw = await this.json("/v1/finance/search", {
      q: query,
      quotesCount: "20",
      newsCount: "0",
      listsCount: "0",
      enableFuzzyQuery: "false",
    });
    const quotes = record.and(z.object({ quotes: z.array(record) })).safeParse(raw);
    if (!quotes.success) throw new ProviderError("provider_error");
    const result: SymbolHit[] = [];
    for (const values of quotes.data.quotes) {
      const hit = searchHit.safeParse({
        symbol: values.symbol,
        exchange: values.exchange,
        quoteType: values.quoteType,
        name: values.longname ?? values.shortname,
      });
      if (!hit.success) throw new ProviderError("provider_error");
      const mic = MIC[hit.data.exchange ?? ""];
      const type = TYPE[hit.data.quoteType ?? ""];
      if (!mic || !type || !hit.data.name) continue;
      result.push(
        symbolSchema.parse({
          symbol: hit.data.symbol,
          name: hit.data.name,
          mic,
          currency: mic === "XWAR" ? "PLN" : "USD",
          type,
        }),
      );
    }
    return result;
  }
}
