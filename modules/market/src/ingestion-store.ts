import { addDays } from "@oliginvest/core";
import {
  type Bar,
  type FxRate,
  fxSchema,
  type Quote,
  type SymbolHit,
  symbolSchema,
} from "@oliginvest/data-providers";
import type { GpwRecord } from "@oliginvest/data-providers/adapters";
import type { DatabaseTransaction } from "@oliginvest/db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { BenchmarkDefinition } from "./benchmarks.js";
import type { MarketRepository } from "./server/repository.js";

const system = { userId: null, role: "system" } as const;
export class IngestionStore {
  constructor(readonly repository: MarketRepository) {}
  async sessionDates(mic: string, from: string, to: string) {
    return this.repository.database.transaction(system, async (tx) =>
      (
        await tx.execute(
          sql`SELECT session_date::text AS date FROM market.trading_calendar WHERE mic=${mic} AND is_open AND session_date BETWEEN ${from}::date AND ${to}::date ORDER BY session_date`,
        )
      ).rows.map((row) => String(row.date)),
    );
  }
  async latestMacroDate(code: string) {
    return this.repository.database.transaction(system, async (tx) => {
      const row = (
        await tx.execute(
          sql`SELECT max(o.obs_date)::text AS date FROM market.macro_observations o JOIN market.macro_series s ON s.id=o.series_id WHERE s.code=${code}`,
        )
      ).rows[0];
      return row?.date ? z.iso.date().parse(row.date) : undefined;
    });
  }
  /** Upsert a macro series (catalog row + observations); a revised value replaces the old one. */
  async saveMacroObservations(
    series: { code: string; name: string; unit: string; frequency: string; source: string },
    input: { date: string; value: string }[],
  ) {
    const rows = z
      .array(
        z
          .object({ date: z.iso.date(), value: z.string().regex(/^-?\d{1,12}(\.\d{1,8})?$/) })
          .strict(),
      )
      .parse(input);
    await this.repository.database.transaction(system, async (tx) => {
      const found = (
        await tx.execute(
          sql`INSERT INTO market.macro_series(code,name,unit,frequency,source) VALUES(${series.code},${series.name},${series.unit},${series.frequency},${series.source}) ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name RETURNING id::text`,
        )
      ).rows[0];
      const id = z.uuid().parse(found?.id);
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        await tx.execute(
          sql`INSERT INTO market.macro_observations(series_id,obs_date,value) SELECT ${id}::uuid,d::date,v::numeric FROM unnest(${sql.param(chunk.map((r) => r.date))}::text[],${sql.param(chunk.map((r) => r.value))}::text[]) AS t(d,v) ON CONFLICT(series_id,obs_date) DO UPDATE SET value=EXCLUDED.value`,
        );
      }
    });
  }
  async saveFx(input: FxRate[]) {
    const rates = z.array(fxSchema).parse(input);
    await this.repository.database.transaction(system, async (tx) => {
      for (const rate of rates)
        await tx.execute(
          sql`INSERT INTO market.fx_rates(base,quote,rate_date,rate,source,table_no,fetched_at) VALUES(${rate.base},${rate.quote},${rate.date}::date,${rate.rate},${rate.meta.source},${rate.tableNo ?? null},${rate.fetchedAt}::timestamptz) ON CONFLICT(base,quote,rate_date,source) DO UPDATE SET rate=EXCLUDED.rate,table_no=EXCLUDED.table_no,fetched_at=EXCLUDED.fetched_at`,
        );
    });
  }
  async saveGpw(rows: GpwRecord[], fetchedAt: string) {
    const bars: Bar[] = [];
    await this.repository.database.transaction(system, async (tx) => {
      for (const row of rows) {
        // The archive's short name is not a ticker; identify by ISIN + MIC.
        const found = (
          await tx.execute(
            sql`INSERT INTO market.instruments(isin,mic,exchange_short_name,name,type,currency,country) VALUES(${row.isin},'XWAR',${row.name},${row.name},'stock',${row.currency},'PL') ON CONFLICT(isin,mic) WHERE isin IS NOT NULL DO UPDATE SET exchange_short_name=EXCLUDED.exchange_short_name RETURNING id::text,currency,(xmax=0) AS inserted`,
          )
        ).rows[0];
        if (!found) throw new Error("GPW_CATALOG_WRITE_FAILED");
        const id = String(found.id);
        if (found.inserted) await this.recordIsinChange(tx, id, row);
        if (found.currency !== row.currency) {
          await this.repository.recordQualityIssue(tx, id, row.date, "currency_change", {
            expected: String(found.currency),
            received: row.currency,
          });
          continue;
        }
        await tx.execute(
          sql`INSERT INTO market.instrument_provider_symbols(provider,symbol,instrument_id) VALUES('gpw',${row.isin},${id}::uuid) ON CONFLICT(provider,symbol) DO NOTHING`,
        );
        const { name: _n, isin: _i, ...bar } = row;
        bars.push({
          ...bar,
          instrumentId: id,
          adjustmentFactor: "1",
          fetchedAt,
          meta: {
            source: "gpw",
            asOf: `${row.date}T00:00:00Z`,
            delayMinutes: 0,
            stale: false,
            attribution: "Źródło: GPW",
          },
        });
      }
    });
    await this.repository.saveBars(bars);
    const dates = [...new Set(rows.map((row) => row.date))];
    if (dates.length) await this.recordMissingGpwSessions(dates);
  }
  /**
   * A new ISIN under the short name of another listed XWAR instrument is an ISIN change (or a
   * reused name) until an administrator links or dismisses it: BLOCK both series (§ 14).
   */
  private async recordIsinChange(tx: DatabaseTransaction, id: string, row: GpwRecord) {
    const previous = (
      await tx.execute(
        sql`SELECT id::text,isin FROM market.instruments WHERE mic='XWAR' AND exchange_short_name=${row.name} AND id<>${id}::uuid AND isin IS NOT NULL AND isin<>${row.isin} AND is_active`,
      )
    ).rows;
    for (const other of previous) {
      await this.repository.recordQualityIssue(tx, String(other.id), row.date, "isin_change", {
        isin: String(other.isin),
        newIsin: row.isin,
      });
      await this.repository.recordQualityIssue(tx, id, row.date, "isin_change", {
        isin: row.isin,
        previousIsin: String(other.isin),
      });
    }
  }
  /**
   * GPW instruments whose latest earlier bar came from the archive but which are missing from
   * this session's file (suspension, delisting or an incomplete file) get a calendar gap.
   */
  async recordMissingGpwSessions(dates: string[]) {
    await this.repository.database.transaction(system, async (tx) => {
      for (const day of z.array(z.iso.date()).parse(dates)) {
        const missing = (
          await tx.execute(sql`SELECT i.id::text FROM market.instruments i
          JOIN LATERAL (SELECT source FROM market.bars_daily WHERE instrument_id=i.id AND session_date<${day}::date ORDER BY session_date DESC LIMIT 1) b ON b.source='gpw'
          WHERE i.mic='XWAR' AND i.is_active AND (i.delisted_on IS NULL OR i.delisted_on>${day}::date)
          AND NOT EXISTS(SELECT 1 FROM market.bars_daily x WHERE x.instrument_id=i.id AND x.session_date=${day}::date)`)
        ).rows;
        for (const row of missing) await this.repository.recordGaps(tx, String(row.id), day, day);
      }
    });
  }
  /** Rows per source for the last `limit` open XWAR sessions up to `date` (BL-213). */
  async gpwSessionCounts(date: string, limit: number) {
    return this.repository.database.transaction(system, async (tx) =>
      (
        await tx.execute(sql`SELECT c.session_date::text AS date,
          (SELECT count(*)::int FROM market.bars_daily b WHERE b.session_date=c.session_date AND b.source='gpw') AS automatic,
          (SELECT count(*)::int FROM market.bars_daily b WHERE b.session_date=c.session_date AND b.source='gpw_manual') AS manual
          FROM market.trading_calendar c WHERE c.mic='XWAR' AND c.is_open AND c.session_date<=${date}::date
          ORDER BY c.session_date DESC LIMIT ${limit}`)
      ).rows.map((row) => ({
        date: String(row.date),
        automatic: Number(row.automatic),
        manual: Number(row.manual),
      })),
    );
  }
  async recordCurrencyChange(id: string, date: string, expected: string, received: string) {
    await this.repository.database.transaction(system, (tx) =>
      this.repository.recordQualityIssue(tx, id, date, "currency_change", { expected, received }),
    );
  }
  /**
   * Idempotent catalog of FR-01.09 benchmarks: an existing Yahoo mapping wins (never two
   * instruments for one symbol); otherwise the instrument is upserted by (MIC, ticker) and joins
   * the `benchmarks` universe. Returns each benchmark's instrument and stored bar range.
   */
  async ensureBenchmarks(definitions: readonly BenchmarkDefinition[], today: string) {
    return this.repository.database.transaction(system, async (tx) => {
      const universe = (
        await tx.execute(
          sql`INSERT INTO market.universes(code,name,description) VALUES('benchmarks','Indeksy i benchmarki','FR-01.09: indeksy i zamienniki ETF') ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name RETURNING id::text`,
        )
      ).rows[0];
      if (!universe) throw new Error("BENCHMARK_UNIVERSE_WRITE_FAILED");
      const output: Array<{
        definition: BenchmarkDefinition;
        id: string;
        first?: string;
        last?: string;
      }> = [];
      for (const definition of definitions) {
        let id = (
          await tx.execute(
            sql`SELECT instrument_id::text AS id FROM market.instrument_provider_symbols WHERE provider='yahoo' AND symbol=${definition.yahoo}`,
          )
        ).rows[0]?.id;
        if (!id) {
          id = (
            await tx.execute(
              sql`INSERT INTO market.instruments(mic,ticker,name,type,currency,country) VALUES(${definition.mic},${definition.ticker},${definition.name},${definition.type},${definition.currency},${definition.country}) ON CONFLICT(mic,ticker) WHERE ticker IS NOT NULL DO UPDATE SET updated_at=now() RETURNING id::text,currency`,
            )
          ).rows[0]?.id;
          if (!id) throw new Error("BENCHMARK_CATALOG_WRITE_FAILED");
          await tx.execute(
            sql`INSERT INTO market.instrument_provider_symbols(provider,symbol,instrument_id) VALUES('yahoo',${definition.yahoo},${String(id)}::uuid) ON CONFLICT(provider,symbol) DO NOTHING`,
          );
        }
        await tx.execute(sql`INSERT INTO market.universe_members(universe_id,instrument_id,valid_from)
          SELECT ${String(universe.id)}::uuid,${String(id)}::uuid,${today}::date WHERE NOT EXISTS(
            SELECT 1 FROM market.universe_members WHERE universe_id=${String(universe.id)}::uuid AND instrument_id=${String(id)}::uuid AND valid_to IS NULL)
          ON CONFLICT DO NOTHING`);
        const range = (
          await tx.execute(
            sql`SELECT min(session_date)::text AS first,max(session_date)::text AS last FROM market.bars_daily WHERE instrument_id=${String(id)}::uuid`,
          )
        ).rows[0];
        output.push({
          definition,
          id: z.uuid().parse(id),
          ...(range?.first ? { first: String(range.first), last: String(range.last) } : {}),
        });
      }
      return output;
    });
  }
  async saveSymbols(input: SymbolHit[]) {
    await this.repository.database.transaction(system, async (tx) => {
      for (const hit of z.array(symbolSchema).parse(input)) {
        const ticker = hit.symbol.endsWith(".WA") ? hit.symbol.slice(0, -3) : hit.symbol;
        // Do not guess that a Yahoo name matches a GPW ISIN.
        const row = (
          await tx.execute(
            sql`INSERT INTO market.instruments(isin,mic,ticker,name,type,currency) VALUES(${hit.isin ?? null},${hit.mic},${ticker},${hit.name},${hit.type},${hit.currency}) ON CONFLICT(mic,ticker) WHERE ticker IS NOT NULL DO UPDATE SET updated_at=now() RETURNING id::text,currency`,
          )
        ).rows[0];
        if (!row || row.currency !== hit.currency) continue;
        await tx.execute(
          sql`INSERT INTO market.instrument_provider_symbols(provider,symbol,instrument_id) VALUES('yahoo',${hit.symbol},${String(row.id)}::uuid) ON CONFLICT(provider,symbol) DO NOTHING`,
        );
      }
    });
  }
  async saveQuotes(quotes: Quote[]) {
    await this.repository.database.transaction(system, async (tx) => {
      for (const quote of quotes) await this.repository.saveQuote(tx, quote);
    });
  }
  async eodIds(ids: string[]) {
    return this.repository.database.transaction(system, async (tx) =>
      (
        await tx.execute(
          sql`SELECT id::text FROM market.instruments WHERE id=ANY(${sql.param(ids)}::uuid[]) AND mic IN ('XNYS','XNAS','ARCX') AND is_active`,
        )
      ).rows.map((row) => String(row.id)),
    );
  }
  async activeIds(ids: string[], asOf: string) {
    return this.repository.database.transaction(system, async (tx) =>
      (
        await tx.execute(sql`
      SELECT i.id::text FROM market.instruments i JOIN market.trading_calendar c ON c.mic=i.mic
      AND c.session_date=(${asOf}::timestamptz AT TIME ZONE c.timezone)::date
      WHERE i.id=ANY(${sql.param(ids)}::uuid[]) AND i.is_active AND c.is_open
      AND (${asOf}::timestamptz AT TIME ZONE c.timezone)::time BETWEEN c.open_time AND c.close_time
    `)
      ).rows.map((row) => z.uuid().parse(row.id)),
    );
  }
  async correctionStart(mic: string, date: string) {
    const dates = await this.sessionDates(mic, addDays(date, -31), date);
    return dates.slice(-5)[0] ?? date;
  }
}
