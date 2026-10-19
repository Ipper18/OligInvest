import { addDays } from "@oliginvest/core";
import {
  CurrencyMismatchError,
  createProviderFetch,
  ProviderError,
  ProviderLimits,
} from "@oliginvest/data-providers";
import {
  FrankfurterProvider,
  fetchGpw,
  NbpProvider,
  nbpRanges,
  YahooProvider,
} from "@oliginvest/data-providers/adapters";
import type { AppDatabase } from "@oliginvest/db";
import type { Redis } from "ioredis";
import {
  BENCHMARK_CONTINUE_MS,
  BENCHMARK_HISTORY_DAYS,
  BENCHMARK_REFRESH_DAYS,
  BENCHMARKS,
  BENCHMARKS_PER_RUN,
} from "./benchmarks.js";
import { marketJobSchema } from "./contracts.js";
import {
  formatGpwCompleteness,
  GPW_COMPLETENESS_SESSIONS,
  type GpwCompletenessReport,
  summarizeGpwCompleteness,
} from "./gpw-completeness.js";
import { IngestionStore } from "./ingestion-store.js";
import { QUOTE_ATTEMPT_MS, QUOTES_PER_RUN, YAHOO_PER_MINUTE } from "./quote-cadence.js";
import { MarketRepository } from "./server/repository.js";

export * from "./gpw-completeness.js";
export { IngestionStore } from "./ingestion-store.js";
export const marketSchedules = [
  { job: "market.fx", cron: "20 12 * * 1-5", tz: "Europe/Warsaw" },
  { job: "market.gpw", cron: "30 18 * * 1-5", tz: "Europe/Warsaw" },
  { job: "market.quotes", cron: "* * * * *", tz: "Europe/Warsaw" },
  { job: "market.us-eod", cron: "30 23 * * 1-5", tz: "Europe/Warsaw" },
  // An hour after the archive fetch; the report covers the latest 20 GPW sessions (BL-213).
  { job: "market.gpw-completeness", cron: "30 19 * * 1-5", tz: "Europe/Warsaw" },
  // After both GPW (17:05) and US (22:00 Warsaw) closes; outside every quote session.
  { job: "market.benchmarks", cron: "45 23 * * 1-5", tz: "Europe/Warsaw" },
] as const;
export function createMarketJobs(options: {
  database: AppDatabase;
  queue: Redis;
  cache: Redis;
  observed(): Promise<string[]>;
  enqueue(name: string, payload: unknown, delay?: number): Promise<void>;
  /** Receives job reports (BL-213), e.g. for a structured log line. */
  report?(name: string, report: GpwCompletenessReport): void;
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
  // Budget every HTTP request; Yahoo costs one chart request per instrument.
  const request =
    (provider: string, perMinute: number): typeof fetch =>
    async (input, init) =>
      limits.run(provider, { perMinute }, () => guarded(input, init));
  const yahoo = new YahooProvider(
    request("yahoo", YAHOO_PER_MINUTE),
    (id) => repository.resolve(id),
    now,
  );
  const nbp = new NbpProvider(request("nbp", 6), now);
  const ecb = new FrankfurterProvider(request("ecb", 6), now);
  /** A currency drift is a § 14 BLOCK on the series; the drifted bars are never stored. */
  async function saveYahooBars(id: string, from: string, to: string) {
    try {
      await repository.saveBars(
        await limits.singleFlight(`bars:${id}:${from}:${to}`, () =>
          yahoo.getEodBars(id, { from, to }),
        ),
      );
    } catch (error) {
      if (!(error instanceof CurrencyMismatchError)) throw error;
      await store.recordCurrencyChange(id, to, error.expected, error.received);
    }
  }
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
        const clock = new Intl.DateTimeFormat("en-GB", {
          timeZone: "Europe/Warsaw",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).format(now());
        if (payload.scheduledAt && (date < repository.today() || clock > "14:00")) return;
        const from = payload.from ?? date,
          to = payload.to ?? date;
        try {
          for (const range of nbpRanges(from, to))
            await store.saveFx(await nbp.getTable(range.from, range.to));
        } catch (error) {
          if (error instanceof ProviderError && error.reason === "no_data") {
            if (payload.scheduledAt && clock >= "14:00") return;
            throw error;
          }
          if (failures === 2)
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
        const active = await store.activeIds(await options.observed(), now().toISOString());
        // At most one attempt per instrument and cycle; cache eviction only refreshes earlier.
        const ids: string[] = [];
        for (const id of active) {
          if (ids.length === QUOTES_PER_RUN) break;
          if (await options.cache.set(`qa:${id}`, "1", "PX", QUOTE_ATTEMPT_MS, "NX")) ids.push(id);
        }
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
          if (!payload.from && !(await store.sessionDates(instrument.mic, date, date)).length)
            continue;
          const from = payload.from ?? (await store.correctionStart(instrument.mic, date));
          await saveYahooBars(id, from, payload.to ?? date);
        }
        return;
      }
      case "market.gpw-completeness": {
        const counts = await store.gpwSessionCounts(date, GPW_COMPLETENESS_SESSIONS);
        const rows = [];
        for (const row of counts)
          rows.push({
            ...row,
            requested: Boolean(await options.queue.get(`quota:gpw:archive:${row.date}`)),
          });
        const report = summarizeGpwCompleteness(rows, date);
        // AOF-backed: the latest report and one per day for 90 days, readable without SQL.
        const text = JSON.stringify({ ...report, markdown: formatGpwCompleteness(report) });
        await options.queue.set("report:gpw-completeness:latest", text);
        await options.queue.set(`report:gpw-completeness:${date}`, text, "PX", 90 * 86_400_000);
        options.report?.(name, report);
        return;
      }
      case "market.benchmarks": {
        // Backfill ≥ 5 years once (AOF marker), then refresh a week; one marker per day keeps
        // continuation runs from re-reading finished series (holidays have no new bar).
        const due = [];
        for (const item of await store.ensureBenchmarks(BENCHMARKS, date))
          if (!(await options.queue.get(`benchmark:done:${item.id}:${date}`))) due.push(item);
        let failure: unknown;
        for (const item of due.slice(0, BENCHMARKS_PER_RUN)) {
          const backfilled = await options.queue.get(`benchmark:backfill:${item.id}`);
          const from =
            backfilled && item.last
              ? addDays(item.last, -BENCHMARK_REFRESH_DAYS)
              : addDays(date, -BENCHMARK_HISTORY_DAYS);
          try {
            await saveYahooBars(item.id, from, date);
            if (!backfilled) await options.queue.set(`benchmark:backfill:${item.id}`, from);
          } catch (error) {
            // Quota delays the whole job. Other failures (also 404 for an unknown symbol) end
            // the series for today, so continuations always progress; the job then fails
            // visibly and tomorrow's run retries from the same backfill or refresh start.
            if (error instanceof ProviderError && error.reason === "provider_quota") throw error;
            failure ??= error;
          }
          await options.queue.set(`benchmark:done:${item.id}:${date}`, "1", "PX", 2 * 86_400_000);
        }
        if (due.length > BENCHMARKS_PER_RUN)
          await options.enqueue("market.benchmarks", { date }, BENCHMARK_CONTINUE_MS);
        if (failure) throw failure;
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
