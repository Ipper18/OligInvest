import { addDays, marketPriceChange } from "@oliginvest/core";
import YahooFinance from "yahoo-finance2";
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
const record = z.record(z.string(), z.unknown());
const chartEnvelope = z
  .object({ chart: z.object({ error: z.null(), result: z.array(record).min(1) }).strict() })
  .strict();
const chartData = z
  .object({
    meta: record,
    timestamp: z.array(z.string().regex(/^\d+$/u)),
    indicators: z
      .object({
        quote: z
          .array(
            z
              .object({
                open: z.array(decimalText.nullable()),
                high: z.array(decimalText.nullable()),
                low: z.array(decimalText.nullable()),
                close: z.array(decimalText.nullable()),
                volume: z.array(decimalText.nullable()),
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
// The SDK validates the full response; decimal prices are taken from its original HTTP body,
// never from its floating-point result. Per-call capture avoids cross-request contamination.
export class YahooProvider implements DataProvider {
  readonly meta = {
    id: "yahoo",
    capabilities: ["eodBars", "intradayQuote", "symbolSearch"],
    markets: ["XWAR", "XNYS", "XNAS", "ARCX"],
    quota: { perMinute: 12 },
    delayMinutes: 15,
    license: "Dane: Yahoo Finance",
  } as const;
  private readonly client: InstanceType<typeof YahooFinance>;
  constructor(
    private readonly request: typeof fetch,
    private readonly resolve: Resolve,
    private readonly now = () => new Date(),
  ) {
    const silent = () => {};
    this.client = new YahooFinance({
      fetch: request,
      versionCheck: false,
      logger: { info: silent, warn: silent, error: silent, debug: silent, dir: silent },
      suppressNotices: ["yahooSurvey"],
    });
  }
  private async capture<T>(method: (request: typeof fetch) => Promise<T>): Promise<unknown> {
    let body: unknown;
    const capture: typeof fetch = async (input, init) => {
      const response = await this.request(input, init);
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input : input.url,
      );
      if (/\/finance\/(chart|quote|search)/u.test(url.pathname)) {
        const text = await limitedText(response, 10_000_000);
        body = parseDecimalJson(text);
        return new Response(text, { status: response.status, headers: response.headers });
      }
      return response;
    };
    try {
      await method(capture);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError("provider_error");
    }
    if (!body) throw new ProviderError("no_data");
    return body;
  }
  async getIntradayQuotes(ids: string[]): Promise<Quote[]> {
    const instruments = await Promise.all(ids.map((id) => this.resolve(z.uuid().parse(id))));
    const output: Quote[] = [];
    for (let index = 0; index < instruments.length; index += 50) {
      const batch = instruments.slice(index, index + 50);
      const raw = await this.capture((request) =>
        this.client.quote(
          batch.map((item) => item.symbol),
          {},
          { fetch: request },
        ),
      );
      const envelope = z
        .object({ quoteResponse: z.object({ result: z.array(record), error: z.null() }).strict() })
        .strict()
        .parse(raw);
      for (const data of envelope.quoteResponse.result) {
        const item = batch.find((entry) => entry.symbol === data.symbol);
        if (!item) continue;
        const fields = z
          .object({
            currency: z.string(),
            price: decimalText,
            prevClose: decimalText.optional(),
            volume: decimalText.optional(),
            time: z.string().regex(/^\d+$/u),
          })
          .strict()
          .parse({
            currency: data.currency,
            price: data.regularMarketPrice,
            prevClose: data.regularMarketPreviousClose,
            volume: data.regularMarketVolume,
            time: data.regularMarketTime,
          });
        if (fields.currency !== item.currency) throw new ProviderError("provider_error");
        const change = fields.prevClose ? marketPriceChange(fields.price, fields.prevClose) : {};
        output.push(
          quoteSchema.parse({
            instrumentId: item.id,
            price: fields.price,
            currency: fields.currency,
            ...(fields.prevClose ? { prevClose: fields.prevClose } : {}),
            ...(fields.volume ? { volume: fields.volume } : {}),
            ...change,
            meta: {
              source: "yahoo",
              asOf: new Date(Number(fields.time) * 1000).toISOString(),
              delayMinutes: 15,
              stale: false,
              attribution: this.meta.license,
            },
            fetchedAt: this.now().toISOString(),
          }),
        );
      }
    }
    return output;
  }
  async getEodBars(id: string, range: { from: string; to: string }): Promise<Bar[]> {
    z.iso.date().parse(range.from);
    z.iso.date().parse(range.to);
    const instrument = await this.resolve(z.uuid().parse(id));
    const raw = await this.capture((request) =>
      this.client.chart(
        instrument.symbol,
        { period1: range.from, period2: addDays(range.to, 1), interval: "1d", return: "object" },
        { fetch: request },
      ),
    );
    const data = chartData.parse(chartEnvelope.parse(raw).chart.result[0]);
    if (data.meta.currency !== instrument.currency || data.meta.symbol !== instrument.symbol)
      throw new ProviderError("provider_error");
    const values = data.indicators.quote[0];
    if (!values) return [];
    if (Object.values(values).some((column) => column.length !== data.timestamp.length))
      throw new ProviderError("provider_error");
    return data.timestamp.flatMap((ts, index) => {
      const close = values.close[index];
      if (close == null) return [];
      const date = new Intl.DateTimeFormat("en-CA", {
        timeZone: instrument.mic === "XWAR" ? "Europe/Warsaw" : "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(Number(ts) * 1000));
      if (date < range.from || date > range.to) return [];
      return [
        barSchema.parse({
          instrumentId: id,
          date,
          open: values.open[index],
          high: values.high[index],
          low: values.low[index],
          close,
          volume: values.volume[index] ?? "0",
          noTrades: values.volume[index] === "0",
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
    const data = await this.client.search(query, { newsCount: 0, quotesCount: 20 });
    const result: SymbolHit[] = [];
    for (const item of data.quotes) {
      const values = record.parse(item);
      const mic = (
        { WSE: "XWAR", NYQ: "XNYS", NMS: "XNAS", NGM: "XNAS", NCM: "XNAS", PCX: "ARCX" } as Record<
          string,
          string
        >
      )[String(values.exchange)];
      const type = ({ EQUITY: "stock", ETF: "etf", INDEX: "index" } as Record<string, string>)[
        String(values.quoteType)
      ];
      if (!mic || !type) continue;
      result.push(
        symbolSchema.parse({
          symbol: values.symbol,
          name: values.longname ?? values.shortname,
          mic,
          currency: mic === "XWAR" ? "PLN" : "USD",
          type,
        }),
      );
    }
    return result;
  }
}
