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
  async recordCurrencyChange(id: string, date: string, expected: string, received: string) {
    await this.repository.database.transaction(system, (tx) =>
      this.repository.recordQualityIssue(tx, id, date, "currency_change", { expected, received }),
    );
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
