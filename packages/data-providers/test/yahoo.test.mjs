import { expect, test, vi } from "vitest";
import { YahooProvider } from "../dist/adapters/index.js";

const id = "0192f0c4-7b1e-7c3a-9f00-3d2a1b4c5d6e";
const period = { timezone: "EDT", start: 1791207000, end: 1791230400, gmtoffset: -14400 };
function fixture(currency = "USD") {
  return JSON.stringify({
    chart: {
      error: null,
      result: [
        {
          meta: {
            currency,
            symbol: "SYNTH",
            exchangeName: "NMS",
            instrumentType: "EQUITY",
            firstTradeDate: 1600000000,
            regularMarketTime: 1791230400,
            gmtoffset: -14400,
            timezone: "EDT",
            exchangeTimezoneName: "America/New_York",
            regularMarketPrice: 10,
            priceHint: 2,
            currentTradingPeriod: { pre: period, regular: period, post: period },
            dataGranularity: "1d",
            range: "",
            validRanges: ["1d"],
          },
          timestamp: [1791207000],
          indicators: {
            quote: [{ open: [10], high: [11], low: [9], close: ["EXACT_DECIMAL"], volume: [1000] }],
          },
        },
      ],
    },
  }).replace('"EXACT_DECIMAL"', "10.123456789");
}
test("real Yahoo SDK with synthetic HTTP preserves original decimal price", async () => {
  const network = vi.fn(async (input) => {
    const url = String(input);
    if (url.includes("finance.yahoo.com/quote/"))
      return new Response("synthetic", {
        headers: { "set-cookie": "A3=synthetic; Domain=.yahoo.com; Path=/; Secure" },
      });
    if (url.includes("getcrumb")) return new Response("synthetic-crumb");
    if (url.includes("/chart/SYNTH")) return new Response(fixture());
    throw new Error("Unexpected synthetic URL");
  });
  const provider = new YahooProvider(network, async () => ({
    id,
    symbol: "SYNTH",
    currency: "USD",
    mic: "XNAS",
  }));
  const result = await provider.getEodBars(id, { from: "2026-10-05", to: "2026-10-05" });
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({
    close: "10.123456789",
    currency: "USD",
    meta: { source: "yahoo", delayMinutes: 0, stale: false },
  });
});
test("Yahoo outage fails the adapter without substituting a made-up price", async () => {
  const provider = new YahooProvider(
    async () => {
      throw new Error("network unavailable");
    },
    async () => ({ id, symbol: "SYNTH", currency: "USD", mic: "XNAS" }),
  );
  await expect(
    provider.getEodBars(id, { from: "2026-10-05", to: "2026-10-05" }),
  ).rejects.toMatchObject({ reason: "provider_error" });
});
