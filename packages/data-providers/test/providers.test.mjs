import { expect, test, vi } from "vitest";
import {
  MarketCache,
  ProviderError,
  ProviderRegistry,
  parseDecimalJson,
  quoteSchema,
} from "../dist/index.js";

const id = "0192f0c4-7b1e-7c3a-9f00-3d2a1b4c5d6e";
const quote = {
  instrumentId: id,
  price: "90071992547409.91",
  currency: "PLN",
  meta: { source: "gpw", asOf: "2026-10-05T15:05:00Z", delayMinutes: 0, stale: false },
  fetchedAt: "2026-10-05T15:10:00Z",
};
test("JSON decimal lexemes never pass through floating point", () => {
  expect(
    parseDecimalJson('{"price":90071992547409.91,"rate":1.234567890123456789,"count":2,"ok":true}'),
  ).toEqual({ price: "90071992547409.91", rate: "1.234567890123456789", count: "2", ok: true });
  expect(() => quoteSchema.parse({ ...quote, price: 1.1 })).toThrow();
  expect(() => quoteSchema.parse({ ...quote, unexpected: true })).toThrow();
});
test("provider failure retains original price, source and asOf with stale metadata", async () => {
  const registry = new ProviderRegistry();
  registry.register({
    meta: {
      id: "yahoo",
      capabilities: ["intradayQuote"],
      markets: ["XWAR"],
      quota: {},
      delayMinutes: 15,
      license: "personal use",
    },
    getIntradayQuotes: async () => {
      throw new ProviderError("provider_error");
    },
  });
  const result = await registry.quotes("XWAR", [id], async () => [quote]);
  expect(result[0]).toEqual({
    ...quote,
    meta: { ...quote.meta, stale: true, staleReason: "eod_only" },
  });
  expect(() => registry.register(registry.providers[0])).toThrow();
});
test("cache isolates users and never fetches a provider during a read", async () => {
  let now = 0;
  const entries = new Map();
  const redis = {
    get: async (key) => entries.get(key) ?? null,
    set: async (key, value) => {
      entries.set(key, value);
      return "OK";
    },
  };
  const cache = new MarketCache(redis, quoteSchema, () => now);
  const load = vi.fn(async () => quote);
  await cache.read(id, "q:one", load, 15_000, 300_000);
  now = 16_000;
  expect((await cache.read(id, "q:one", load, 15_000, 300_000)).price).toBe(quote.price);
  expect(load).toHaveBeenCalledTimes(1);
  await cache.read("0192f0c4-7b1e-7c3a-9f00-3d2a1b4c5d70", "q:one", load, 15_000, 300_000);
  expect(load).toHaveBeenCalledTimes(2);
  entries.clear();
  now = 40_000;
  await cache.read(id, "q:one", load, 15_000, 300_000);
  expect(load).toHaveBeenCalledTimes(3);
});
test("cache corruption or outage falls back to database", async () => {
  const cache = new MarketCache(
    {
      get: async () => "{bad",
      set: async () => {
        throw new Error("offline");
      },
    },
    quoteSchema,
  );
  expect(await cache.read(id, "q:one", async () => quote, 1, 1)).toEqual(quote);
});
