import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { YahooProvider } from "../dist/adapters/index.js";
import {
  CurrencyMismatchError,
  createProviderFetch,
  ProviderError,
  ProviderRegistry,
} from "../dist/index.js";

const UA = "OligInvest/0.0.0 (+https://invest.oligi.pl)";
const id = "0192f0c4-7b1e-7c3a-9f00-3d2a1b4c5d6e";
const fixture = (name) =>
  readFileSync(new URL(`./fixtures/yahoo/${name}.json`, import.meta.url), "utf8");
const usd = { id, symbol: "SYNTH", currency: "USD", mic: "XNAS" };
const pln = (n = 0) => ({
  id: `0192f0c4-7b1e-7c3a-9f00-3d2a1b4c5d${(0x70 + n).toString(16)}`,
  symbol: "SYNTH.WA",
  currency: "PLN",
  mic: "XWAR",
});
const now = () => new Date("2026-10-05T15:30:00Z");
// Synthetic HTTP only: any request outside the recorded routes fails the test.
function network(routes) {
  return vi.fn(async (input) => {
    const url = new URL(String(input));
    for (const [pattern, reply] of routes)
      if (pattern.test(`${url.hostname}${url.pathname}`)) return reply(url);
    throw new Error(`Unexpected synthetic URL ${url.href}`);
  });
}
const provider = (transport, resolve = async () => usd) =>
  new YahooProvider(createProviderFetch(UA, transport), resolve, now);
let realFetch;
beforeEach(() => {
  realFetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network disabled in CI"));
});
afterEach(() => {
  expect(realFetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

test("EOD bars come from chart v8 with lossless decimals and no cookie or crumb request", async () => {
  const transport = network([
    [/\/v8\/finance\/chart\/SYNTH$/u, () => new Response(fixture("chart-eod"))],
  ]);
  const bars = await provider(transport).getEodBars(id, { from: "2026-10-01", to: "2026-10-05" });
  expect(bars.map((bar) => [bar.date, bar.close, bar.volume, bar.noTrades])).toEqual([
    ["2026-10-01", "9.75", "1200", false],
    ["2026-10-05", "10.123456789", "1000", false],
  ]);
  expect(bars[1]).toMatchObject({
    open: "10.25",
    high: "10.75",
    low: "10",
    currency: "USD",
    meta: {
      source: "yahoo",
      asOf: "2026-10-05T13:30:00.000Z",
      delayMinutes: 0,
      stale: false,
      attribution: "Dane: Yahoo Finance",
    },
    fetchedAt: "2026-10-05T15:30:00.000Z",
  });
  expect(transport).toHaveBeenCalledTimes(1);
  const [input, options] = transport.mock.calls[0];
  const url = new URL(String(input));
  expect(url.hostname).toBe("query2.finance.yahoo.com");
  expect(Object.fromEntries(url.searchParams)).toEqual({
    period1: String(Date.parse("2026-10-01T00:00:00Z") / 1000),
    period2: String(Date.parse("2026-10-06T00:00:00Z") / 1000),
    interval: "1d",
    includePrePost: "false",
  });
  expect(options.headers["User-Agent"]).toBe(UA);
  expect(options.headers).not.toHaveProperty("cookie");
  expect(options.redirect).toBe("error");
});

test("delayed quote uses chart meta: price, previous close, volume and source metadata", async () => {
  const transport = network([
    [/\/v8\/finance\/chart\/SYNTH\.WA$/u, () => new Response(fixture("chart-quote-xwar"))],
  ]);
  const [quote] = await provider(transport, async () => pln()).getIntradayQuotes([pln().id]);
  expect(quote).toEqual({
    instrumentId: pln().id,
    price: "90071992547409.91",
    currency: "PLN",
    prevClose: "90071992547409.41",
    volume: "123456",
    change: "0.5",
    changeRatio: expect.any(Number),
    meta: {
      source: "yahoo",
      asOf: "2026-10-05T15:15:00.000Z",
      delayMinutes: 15,
      stale: false,
      attribution: "Dane: Yahoo Finance",
    },
    fetchedAt: "2026-10-05T15:30:00.000Z",
  });
  expect(Object.fromEntries(new URL(String(transport.mock.calls[0][0])).searchParams)).toEqual({
    range: "1d",
    interval: "1d",
    includePrePost: "false",
  });
});

test("quota cut returns the quotes fetched so far and stops requesting", async () => {
  let budget = 2;
  const transport = network([
    [
      /\/v8\/finance\/chart\//u,
      () => {
        if (budget-- <= 0) throw new ProviderError("provider_quota", 1000, 429);
        return new Response(fixture("chart-quote-xwar"));
      },
    ],
  ]);
  const instruments = [0, 1, 2, 3, 4].map(pln);
  const ids = instruments.map((item) => item.id);
  const yahoo = new YahooProvider(transport, async (key) => instruments.find((i) => i.id === key));
  const first = await yahoo.getIntradayQuotes(ids);
  expect(first.map((q) => q.instrumentId)).toEqual(ids.slice(0, 2));
  // Four parallel requests, then the cut: the fifth instrument is never requested.
  expect(transport).toHaveBeenCalledTimes(4);
  budget = 0;
  await expect(yahoo.getIntradayQuotes(ids)).rejects.toMatchObject({ reason: "provider_quota" });
});

test("symbol search maps supported exchanges and skips the rest", async () => {
  const transport = network([[/\/v1\/finance\/search$/u, () => new Response(fixture("search"))]]);
  expect(await provider(transport).searchSymbols("synth")).toEqual([
    {
      symbol: "SYNTH.WA",
      name: "Synthetic Spolka SA",
      mic: "XWAR",
      currency: "PLN",
      type: "stock",
    },
    { symbol: "SYNE", name: "Synthetic ETF", mic: "ARCX", currency: "USD", type: "etf" },
  ]);
  const url = new URL(String(transport.mock.calls[0][0]));
  expect(url.hostname).toBe("query2.finance.yahoo.com");
  expect(url.searchParams.get("q")).toBe("synth");
  expect(url.searchParams.get("newsCount")).toBe("0");
});

test("unknown symbol, schema drift and foreign currency fail closed", async () => {
  const notFound = network([
    [/\/chart\//u, () => new Response(fixture("chart-not-found"), { status: 404 })],
  ]);
  await expect(
    provider(notFound).getEodBars(id, { from: "2026-10-05", to: "2026-10-05" }),
  ).rejects.toMatchObject({ reason: "no_data" });
  const drift = JSON.parse(fixture("chart-eod"));
  drift.chart.result[0].indicators.quote[0].close = [null, { value: 1 }, 2];
  const drifted = network([[/\/chart\//u, () => new Response(JSON.stringify(drift))]]);
  await expect(
    provider(drifted).getEodBars(id, { from: "2026-10-01", to: "2026-10-05" }),
  ).rejects.toMatchObject({ reason: "provider_error" });
  const wrongCurrency = network([[/\/chart\//u, () => new Response(fixture("chart-quote-xwar"))]]);
  await expect(
    provider(wrongCurrency, async () => ({ ...pln(), currency: "EUR" })).getIntradayQuotes([
      pln().id,
    ]),
  ).rejects.toMatchObject({ reason: "provider_error" });
  const oversized = network([[/\/chart\//u, () => new Response("x".repeat(10_000_001))]]);
  await expect(
    provider(oversized).getEodBars(id, { from: "2026-10-05", to: "2026-10-05" }),
  ).rejects.toMatchObject({ reason: "provider_error" });
});

test("crafted symbols never reach the URL and cookie hosts stay outside the allowlist", async () => {
  const transport = vi.fn();
  for (const symbol of ["../v7/finance/quote", "SYNTH?crumb=x", "SYN TH", ""])
    await expect(
      provider(transport, async () => ({ ...usd, symbol })).getEodBars(id, {
        from: "2026-10-05",
        to: "2026-10-05",
      }),
    ).rejects.toThrow();
  const request = createProviderFetch(UA, transport);
  for (const url of [
    "https://fc.yahoo.com/",
    "https://finance.yahoo.com/quote/SYNTH",
    "https://query1.finance.yahoo.com/v1/test/getcrumb",
  ])
    await expect(request(url)).rejects.toMatchObject({ reason: "provider_disabled" });
  expect(transport).not.toHaveBeenCalled();
});

test("Yahoo outage degrades to the last known quote flagged stale, never a made-up price", async () => {
  const yahoo = provider(async () => {
    throw new Error("network unavailable");
  });
  await expect(
    yahoo.getEodBars(id, { from: "2026-10-05", to: "2026-10-05" }),
  ).rejects.toMatchObject({ reason: "provider_error" });
  const registry = new ProviderRegistry();
  registry.register(yahoo);
  const last = {
    instrumentId: id,
    price: "10.5",
    currency: "USD",
    meta: { source: "yahoo", asOf: "2026-10-05T13:30:00Z", delayMinutes: 15, stale: false },
    fetchedAt: "2026-10-05T13:45:00Z",
  };
  expect(await registry.quotes("XNAS", [id], async () => [last])).toEqual([
    { ...last, meta: { ...last.meta, stale: true, staleReason: "provider_error" } },
  ]);
});
test("index levels with zero volume are not no-trade candles; other types keep the flag", async () => {
  const body = JSON.parse(fixture("chart-eod"));
  body.chart.result[0].indicators.quote[0].close[1] = 10.1;
  const transport = network([[/\/v8\/finance\/chart\/SYNTH$/u, () => Response.json(body)]]);
  const range = { from: "2026-10-01", to: "2026-10-05" };
  const flags = async (type) =>
    (await provider(transport, async () => ({ ...usd, type })).getEodBars(id, range)).map(
      (bar) => bar.noTrades,
    );
  expect(await flags("index")).toEqual([false, false, false]);
  expect(await flags("stock")).toEqual([false, true, false]);
});
test("EOD currency drift names both currencies for the § 14 BLOCK", async () => {
  const transport = network([
    [/\/v8\/finance\/chart\/SYNTH$/u, () => new Response(fixture("chart-eod"))],
  ]);
  const failure = provider(transport, async () => ({ ...usd, currency: "EUR" })).getEodBars(id, {
    from: "2026-10-01",
    to: "2026-10-05",
  });
  await expect(failure).rejects.toBeInstanceOf(CurrencyMismatchError);
  await expect(failure).rejects.toMatchObject({
    reason: "provider_error",
    expected: "EUR",
    received: "USD",
  });
});
