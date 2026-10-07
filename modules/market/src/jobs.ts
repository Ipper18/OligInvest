import { addDays } from "@oliginvest/core";
import { createProviderFetch, ProviderLimits } from "@oliginvest/data-providers";
import {
  FrankfurterProvider,
  fetchGpw,
  NbpProvider,
  nbpRanges,
  YahooProvider,
} from "@oliginvest/data-providers/adapters";
import type { AppDatabase } from "@oliginvest/db";
import type { Redis } from "ioredis";
import { marketJobSchema } from "./contracts.js";
import { IngestionStore } from "./ingestion-store.js";
import { MarketRepository } from "./server/repository.js";

export { IngestionStore } from "./ingestion-store.js";
export const marketSchedules = [
  { job: "market.fx", cron: "20 12 * * 1-5", tz: "Europe/Warsaw" },
  { job: "market.gpw", cron: "30 18 * * 1-5", tz: "Europe/Warsaw" },
  { job: "market.quotes", cron: "*/5 * * * *", tz: "Europe/Warsaw" },
  { job: "market.us-eod", cron: "30 23 * * 1-5", tz: "Europe/Warsaw" },
] as const;
export function createMarketJobs(options: {
  database: AppDatabase;
  queue: Redis;
  cache: Redis;
  observed(): Promise<string[]>;
  enqueue(name: string, payload: unknown, delay?: number): Promise<void>;
  now?: () => Date;
  transport?: typeof fetch;
}) {
  const now = options.now ?? (() => new Date());
  const repository = new MarketRepository(options.database, now);
  const store = new IngestionStore(repository);
  const limits = new ProviderLimits(options.queue, options.cache, () => now().getTime());
  const guarded = createProviderFetch(
    "OligInvest/0.0.0 (+https://invest.oligi.pl)",
    options.transport,
  );
  // Budget every HTTP request, including SDK cookie and crumb calls.
  const request =
    (provider: string, perMinute: number): typeof fetch =>
    async (input, init) =>
      limits.run(provider, { perMinute }, () => guarded(input, init));
  const yahoo = new YahooProvider(request("yahoo", 12), (id) => repository.resolve(id), now);
  const nbp = new NbpProvider(request("nbp", 6), now);
  const ecb = new FrankfurterProvider(request("ecb", 6), now);
  async function dispatch(name: string, raw: unknown, failures = 0): Promise<void> {
    const payload = marketJobSchema.parse(raw);
    const date = payload.date ?? repository.today();
    switch (name) {
      case "market.search":
        if (!payload.query) throw new Error("QUERY_REQUIRED");
        await store.saveSymbols(
          await limits.singleFlight(`search:${Buffer.from(payload.query).toString("hex")}`, () =>
            yahoo.searchSymbols(payload.query ?? ""),
          ),
        );
        return;
      case "market.fx": {
        const from = payload.from ?? date,
          to = payload.to ?? date;
        try {
          for (const range of nbpRanges(from, to))
            await store.saveFx(await nbp.getTable(range.from, range.to));
        } catch (error) {
          if (failures >= 2)
            for (const currency of ["USD", "EUR"])
              await store.saveFx(await ecb.getFxRate(currency, "PLN", date));
          throw error;
        }
        return;
      }
      case "market.gpw":
      case "market.gpw-backfill": {
        const dates = await store.sessionDates("XWAR", payload.from ?? date, payload.to ?? date);
        for (const day of dates) {
          // AOF-backed claim: a crash or HTTP error must not repeat the archive request.
          if (await options.queue.get(`quota:gpw:archive:${day}`)) continue;
          const rows = await limits.singleFlight(`gpw:${day}`, () =>
            limits.run("gpw", { perMinute: 1 }, async () => {
              if (!(await options.queue.set(`quota:gpw:archive:${day}`, "requested", "NX")))
                return [];
              return fetchGpw(day, guarded);
            }),
          );
          await store.saveGpw(rows, now().toISOString());
        }
        return;
      }
      case "market.quotes": {
        const ids = await options.observed();
        if (!ids.length) return;
        const quotes = await limits.singleFlight("yahoo-quotes", () =>
          yahoo.getIntradayQuotes(ids),
        );
        await store.saveQuotes(quotes);
        const persisted = await repository.quotes({ userId: null, role: "system" }, ids);
        for (let index = 0; index < persisted.length; index += 200)
          await options.cache.publish(
            "sse:quotes",
            JSON.stringify({
              v: 1,
              quotes: persisted
                .slice(index, index + 200)
                .map((q) => ({
                  instrumentId: q.instrumentId,
                  price: q.price,
                  currency: q.currency,
                  ...q.meta,
                  ...(q.changeRatio === undefined ? {} : { changeRatio: q.changeRatio }),
                }))
                .map(({ attribution: _a, ...q }) => q),
            }),
          );
        return;
      }
      case "market.us-eod": {
        for (const id of await store.eodIds(
          payload.instrumentId ? [payload.instrumentId] : await options.observed(),
        )) {
          const instrument = await repository.resolve(id);
          const from = payload.from ?? (await store.correctionStart(instrument.mic, date));
          await repository.saveBars(
            await limits.singleFlight(`bars:${id}`, () =>
              yahoo.getEodBars(id, { from, to: payload.to ?? date }),
            ),
          );
        }
        return;
      }
      case "market.backfill":
        if (!payload.instrumentId) throw new Error("INSTRUMENT_REQUIRED");
        if ((await repository.resolve(payload.instrumentId)).mic === "XWAR")
          await options.enqueue("market.gpw-backfill", {
            from: payload.from ?? addDays(date, -1826),
            to: date,
          });
        else
          await options.enqueue("market.us-eod", {
            instrumentId: payload.instrumentId,
            from: payload.from ?? addDays(date, -1826),
            to: date,
          });
        return;
      default:
        throw new Error("UNKNOWN_MARKET_JOB");
    }
  }
  return { dispatch, repository, store };
}
