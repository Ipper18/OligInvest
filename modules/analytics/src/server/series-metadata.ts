import { type AnalyticsResult, analyticsSeriesMetadataSchema } from "@oliginvest/contracts";
import type { DatabaseTransaction } from "@oliginvest/db";
import { sql } from "drizzle-orm";
import { z } from "zod";

type Result = Extract<AnalyticsResult, { status: "done" }>;
type Window = {
  key: string;
  ids: string[];
  from: string;
  to: string;
  monthly: boolean;
  nbpOnly?: boolean;
};
const uuid = z.uuid();
const period = /^(\d{4}-\d{2})\.\.(\d{4}-\d{2})$/;
function monthEnd(month: string) {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return date.toISOString().slice(0, 10);
}

/** Historical provenance at finalization, from local market tables only. */
export async function collectSeriesMetadata(tx: DatabaseTransaction, result: Result) {
  const windows: Window[] = [];
  if (result.result.kind === "stress_test") {
    const ids = [
      ...new Set(
        result.result.scenarios.flatMap((s) =>
          s.positions.flatMap((p) =>
            p.series === "instrument"
              ? [p.instrumentId]
              : p.series === "proxy" && p.proxyInstrumentId
                ? [p.proxyInstrumentId]
                : [],
          ),
        ),
      ),
    ];
    for (const scenario of result.result.scenarios) {
      if (
        scenario.kind !== "historical" ||
        scenario.status !== "ok" ||
        !scenario.periodFrom ||
        !scenario.periodTo
      )
        continue;
      const start = new Date(`${scenario.periodFrom}T00:00:00Z`);
      start.setUTCDate(start.getUTCDate() - 10);
      windows.push({
        key: scenario.key,
        ids,
        from: start.toISOString().slice(0, 10),
        to: scenario.periodTo,
        monthly: false,
        nbpOnly: true,
      });
    }
    const months = period.exec(result.reproducibility.dataVersion.monthly ?? "");
    if (months)
      windows.push({
        key: "monthly",
        ids: [
          ...new Set([
            ...ids,
            ...result.result.scenarios.flatMap((s) =>
              s.shockInstrumentId ? [s.shockInstrumentId] : [],
            ),
          ]),
        ],
        from: `${months[1]}-01`,
        to: monthEnd(String(months[2])),
        monthly: true,
      });
  } else {
    for (const [id, range] of Object.entries(result.reproducibility.dataVersion)) {
      const months = period.exec(range);
      if (uuid.safeParse(id).success && months)
        windows.push({
          key: "monthly",
          ids: [id],
          from: `${months[1]}-01`,
          to: monthEnd(String(months[2])),
          monthly: true,
        });
    }
  }
  const entries: z.infer<typeof analyticsSeriesMetadataSchema> = [];
  for (const window of windows) {
    if (!window.ids.length) continue;
    const rows = (
      await tx.execute(sql`
      WITH raw_bars AS (
        SELECT instrument_id,session_date,source,CASE WHEN ${window.monthly} THEN date_trunc('month',session_date)::date ELSE session_date END AS bucket
        FROM market.bars_daily WHERE instrument_id=ANY(${sql.param(window.ids)}::uuid[])
          AND session_date BETWEEN ${window.from}::date AND ${window.to}::date
      ), bars AS (
        SELECT DISTINCT ON (instrument_id,bucket) instrument_id,session_date,source FROM raw_bars ORDER BY instrument_id,bucket,session_date DESC
      ), raw_rates AS (
        SELECT base,rate_date,source,CASE WHEN ${window.monthly} THEN date_trunc('month',rate_date)::date ELSE rate_date END AS bucket
        FROM market.fx_rates WHERE quote='PLN' AND base IN (SELECT currency FROM market.instruments WHERE id=ANY(${sql.param(window.ids)}::uuid[]) AND currency<>'PLN')
          AND rate_date BETWEEN ${window.from}::date AND ${window.to}::date AND (NOT ${window.nbpOnly ?? false} OR source='nbp')
      ), rates AS (
        SELECT DISTINCT ON (base,bucket) base,rate_date,source FROM raw_rates ORDER BY base,bucket,rate_date DESC,(source='nbp') DESC
      )
      SELECT b.instrument_id::text AS "seriesKey",b.source,max(b.session_date)::text AS date,
        (SELECT min(q.severity) FROM market.data_quality_issues q WHERE q.instrument_id=b.instrument_id AND q.status='open' AND q.severity IN ('BLOCK','WARN')) AS quality
      FROM bars b GROUP BY b.instrument_id,b.source
      UNION ALL SELECT 'fx:'||base,source,max(rate_date)::text,NULL FROM rates GROUP BY base,source
    `)
    ).rows;
    for (const row of rows)
      entries.push(
        ...analyticsSeriesMetadataSchema.parse([
          {
            seriesKey: `${window.key}:${row.seriesKey}`,
            meta: {
              source: row.source,
              asOf: `${row.date}T00:00:00Z`,
              delayMinutes: 0,
              stale: row.quality === "BLOCK",
              ...(row.quality ? { qualityStatus: row.quality } : {}),
              ...(row.quality === "BLOCK" ? { staleReason: "data_quality_hold" } : {}),
            },
          },
        ]),
      );
  }
  // The rate is supplied manually by the administrator; never label it as a direct NBP feed.
  if (typeof result.assumptions.cashRateDate === "string") {
    const date = z.iso.date().parse(result.assumptions.cashRateDate);
    const rows = (
      await tx.execute(
        sql`SELECT s.source,o.obs_date::text AS date FROM market.macro_observations o JOIN market.macro_series s ON s.id=o.series_id WHERE s.code='NBP:REF_RATE' AND o.obs_date=${date}::date`,
      )
    ).rows;
    for (const row of rows)
      entries.push(
        ...analyticsSeriesMetadataSchema.parse([
          {
            seriesKey: "NBP:REF_RATE",
            meta: {
              source: row.source === "admin" ? "computed" : row.source,
              asOf: `${row.date}T00:00:00Z`,
              delayMinutes: 0,
              stale: false,
              ...(row.source === "admin"
                ? { attribution: "Stopa NBP: dane wprowadzone przez administratora" }
                : {}),
            },
          },
        ]),
      );
  }
  return analyticsSeriesMetadataSchema.parse([
    ...new Map(entries.map((entry) => [JSON.stringify(entry), entry])).values(),
  ]);
}
