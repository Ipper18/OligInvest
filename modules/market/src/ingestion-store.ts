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
            sql`INSERT INTO market.instruments(isin,mic,exchange_short_name,name,type,currency,country) VALUES(${row.isin},'XWAR',${row.name},${row.name},'stock',${row.currency},'PL') ON CONFLICT(isin,mic) WHERE isin IS NOT NULL DO UPDATE SET exchange_short_name=EXCLUDED.exchange_short_name RETURNING id::text,currency`,
          )
        ).rows[0];
        if (!found) throw new Error("GPW_CATALOG_WRITE_FAILED");
        const id = String(found.id);
        if (found.currency !== row.currency) {
          await this.repository.recordQualityIssue(tx, id, row.date, "currency_change");
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
  async correctionStart(mic: string, date: string) {
    const dates = await this.sessionDates(mic, addDays(date, -31), date);
    return dates.slice(-5)[0] ?? date;
  }
}
