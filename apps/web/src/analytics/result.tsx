import type { AnalyticsRunView } from "@oliginvest/contracts";
import { analyticsMessages as defaultM, localizeWarning } from "@oliginvest/i18n/analytics";
import { AssumptionsBlock, DataFreshness, Disclaimer, Panel } from "@oliginvest/ui";
import { useCopy, useFormatters } from "@oliginvest/ui/localization";
import { DataTable } from "@oliginvest/ui/table";
import Link from "next/link";
import type { ReactNode } from "react";
import { ChartLoader } from "./chart-loader";

function pageRows<T>(rows: T[], page: number, size: number) {
  const offset = Math.min(page, Math.max(0, Math.ceil(rows.length / size) - 1)) * size;
  return rows.slice(offset, offset + size);
}
function useResultFormatters() {
  const m = useCopy("analyticsMessages", defaultM);
  const { formatMoney, formatPercent } = useFormatters();
  const money = (value: number | string | null | undefined) =>
    value == null ? m.noValue : formatMoney(String(value), "PLN");
  const percent = (value: number | null | undefined) =>
    value == null ? m.noValue : formatPercent(String(value));
  const label = (key: string) => (m.labels as Record<string, string>)[key] ?? key;
  const RATE_KEYS = new Set([
    "annualCostRate",
    "inflationRate",
    "taxRate",
    "cashShare",
    "cashRateAnnual",
  ]);
  function valueText(value: unknown, key: string): string {
    if (value == null) return m.noValue;
    if (typeof value === "boolean") return value ? m.yes : m.no;
    if (typeof value === "number" && RATE_KEYS.has(key)) return percent(value);
    if (typeof value === "string") return (m.values as Record<string, string>)[value] ?? value;
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  }
  return { money, percent, label, valueText };
}
export function Values({ values }: { values: Record<string, unknown> }) {
  const { label, valueText } = useResultFormatters();
  return (
    <dl>
      {Object.entries(values).map(([key, value]) => (
        <div key={key}>
          <dt>{label(key)}</dt>
          <dd className="oi-wrap">{valueText(value, key)}</dd>
        </div>
      ))}
    </dl>
  );
}
export function Table({
  caption,
  headings,
  rows,
}: {
  caption: string;
  headings: string[];
  rows: ReactNode[][];
}) {
  return (
    <DataTable
      caption={caption}
      headings={headings}
      rows={rows.map((cells, index) => ({ id: String(index), cells }))}
    />
  );
}
export function Result({
  run,
  page = 0,
  real = false,
  sourcePage = 0,
  positionPage = 0,
}: {
  run: AnalyticsRunView;
  page?: number;
  real?: boolean;
  sourcePage?: number;
  positionPage?: number;
}) {
  const { formatDateTime } = useFormatters();

  const { money, percent } = useResultFormatters();
  const m = useCopy("analyticsMessages", defaultM);

  const result = run.result;
  const mc = result?.kind === "monte_carlo" ? result : undefined;
  const fan = mc && real ? mc.real : mc?.nominal;
  return (
    <>
      <Panel>
        <h2>{m.how}</h2>
        <p>{mc ? m.howMc : result?.kind === "goal" ? m.howGoal : m.howStress}</p>
        {mc && <p data-warning-code="CRISIS_TESTS_SEPARATE">{m.crisis}</p>}
      </Panel>
      {mc && fan && (
        <>
          <Panel>
            <h2>{m.fan}</h2>
            <nav aria-label={m.fan}>
              <Link prefetch={false} href={`?value=nominal`}>
                {m.nominal}
              </Link>
              {" · "}
              <Link prefetch={false} href={`?value=real`}>
                {m.real}
              </Link>
            </nav>
            <h3>{real ? m.real : m.nominal}</h3>
            <ChartLoader series={{ months: mc.months, ...fan }} />
            <Table
              caption={m.fan}
              headings={[m.month, m.p5, m.p25, m.p50, m.p75, m.p95]}
              rows={mc.months
                .slice(page * 60, page * 60 + 60)
                .map((month, i) => [
                  month,
                  ...(["p5", "p25", "p50", "p75", "p95"] as const).map((p) =>
                    money(fan[p][page * 60 + i]),
                  ),
                ])}
            />
            {page > 0 && (
              <Link href={`?page=${page - 1}&value=${real ? "real" : "nominal"}`}>
                {m.previous}
              </Link>
            )}
            {(page + 1) * 60 < mc.months.length && (
              <Link href={`?page=${page + 1}&value=${real ? "real" : "nominal"}`}>{m.next}</Link>
            )}
            <h3>{m.probability}</h3>
            <p>{mc.goalProbability == null ? m.noGoal : percent(mc.goalProbability)}</p>
          </Panel>
          <Panel>
            <h2>{m.drawdown}</h2>
            <p>{m.drawdownText}</p>
            <Table
              caption={m.drawdown}
              headings={[m.p5, m.p50, m.p95]}
              rows={[
                [
                  percent(mc.maxDrawdownPercentiles.p5),
                  percent(mc.maxDrawdownPercentiles.p50),
                  percent(mc.maxDrawdownPercentiles.p95),
                ],
              ]}
            />
          </Panel>
          <Panel>
            <h2>{m.sensitivity}</h2>
            <Table
              caption={m.sensitivity}
              headings={[m.scenario, m.block, m.annualCost, m.endRange, m.probability]}
              rows={mc.sensitivity.map((row) => [
                m.scenarios[row.scenario],
                "meanBlockMonths" in row ? row.meanBlockMonths : m.noValue,
                percent(row.annualCostRate),
                `${money(row.endValueP5)} – ${money(row.endValueP50)}`,
                percent(row.goalProbability),
              ])}
            />
          </Panel>
        </>
      )}
      {result?.kind === "goal" && (
        <Panel>
          <h2>{m.types.goal}</h2>
          <dl>
            <dt>{m.target}</dt>
            <dd>{money(result.target.amount)}</dd>
            <dt>{m.goalReal}</dt>
            <dd>{money(result.targetReal.amount)}</dd>
            <dt>{m.horizon}</dt>
            <dd>{result.horizonYears}</dd>
          </dl>
          <Table
            caption={m.contribution}
            headings={[m.probability, m.contribution, m.details]}
            rows={[...result.requirements]
              .sort((a, b) => b.probability - a.probability)
              .map((row) => [
                percent(row.probability),
                row.monthlyContribution ? money(row.monthlyContribution.amount) : m.outOfRange,
                row.alreadyMet ? m.alreadyMet : "—",
              ])}
          />
          <Table
            caption={m.sensitivity}
            headings={[m.scenario, m.block, m.probability, m.contribution]}
            rows={result.sensitivity.flatMap((row) =>
              [...row.requirements]
                .sort((a, b) => b.probability - a.probability)
                .map((entry) => [
                  m.scenarios[row.scenario],
                  "meanBlockMonths" in row ? row.meanBlockMonths : "—",
                  percent(entry.probability),
                  entry.monthlyContribution
                    ? money(entry.monthlyContribution.amount)
                    : m.outOfRange,
                ]),
            )}
          />
        </Panel>
      )}
      {result?.kind === "stress_test" &&
        result.scenarios.map((scenario) => (
          <Panel key={scenario.key}>
            <h2>{scenario.name}</h2>
            {scenario.periodFrom && scenario.periodTo && (
              <p>
                {scenario.periodFrom} – {scenario.periodTo}
              </p>
            )}
            {scenario.kind === "hypothetical" && (
              <Values
                values={{
                  ...(scenario.shockKind ? { shockKind: m.shockKinds[scenario.shockKind] } : {}),
                  ...(scenario.shock != null ? { shock: percent(scenario.shock) } : {}),
                  ...(scenario.shockCurrency ? { shockCurrency: scenario.shockCurrency } : {}),
                  ...(scenario.shockInstrumentId
                    ? { shockInstrumentId: scenario.shockInstrumentId }
                    : {}),
                  ...(scenario.correlation != null ? { correlation: scenario.correlation } : {}),
                }}
              />
            )}
            {scenario.baselineRange && (
              <p>
                {m.baseline}: {percent(scenario.baselineRange.low)} –{" "}
                {percent(scenario.baselineRange.high)}
              </p>
            )}
            {scenario.status !== "ok" || !scenario.returnRange ? (
              <p>{m.unavailableScenario}</p>
            ) : (
              <>
                <Table
                  caption={m.range}
                  headings={[m.range, m.basis, m.coverage, m.ownHistory]}
                  rows={[
                    [
                      `${percent(scenario.returnRange.low)} – ${percent(scenario.returnRange.high)}`,
                      m.bases[scenario.returnRange.basis],
                      percent(scenario.coverageRatio),
                      percent(scenario.ownHistoryRatio),
                    ],
                  ]}
                />
                <Table
                  caption={m.positions}
                  headings={[m.instrument, m.series, m.liquidity]}
                  rows={pageRows(scenario.positions, positionPage, 50).map((p) => [
                    p.proxyInstrumentId
                      ? `${p.instrumentId} / ${p.proxyInstrumentId}`
                      : p.instrumentId,
                    m.seriesKinds[p.series],
                    p.illiquid ? m.yes : m.no,
                  ])}
                />
                {positionPage > 0 && (
                  <Link href={`?positions=${positionPage - 1}`}>{m.previous}</Link>
                )}
                {(positionPage + 1) * 50 < scenario.positions.length && (
                  <Link href={`?positions=${positionPage + 1}`}>{m.next}</Link>
                )}
              </>
            )}
          </Panel>
        ))}
      <Panel>
        <h2>{m.warnings}</h2>
        {run.warnings?.map((warning) => (
          <p key={`${warning.code}-${warning.message}`} data-warning-code={warning.code}>
            {warning.code === "CRISIS_TESTS_UNAVAILABLE" || warning.code === "CRISIS_TESTS_SEPARATE"
              ? m.crisis
              : localizeWarning(warning.code, warning.message, m.warningTemplates)}
          </p>
        ))}
        <AssumptionsBlock summary={m.assumptions}>
          <Values values={run.assumptions ?? {}} />
        </AssumptionsBlock>
      </Panel>
      <Panel>
        <h2>{m.sources}</h2>
        {run.seriesMetadata?.length ? (
          <>
            <p>{m.metadataNote}</p>
            {run.seriesMetadata.slice(sourcePage * 50, sourcePage * 50 + 50).map((entry) => (
              <div key={`${entry.seriesKey}-${entry.meta.source}-${entry.meta.asOf}`}>
                <h3 className="oi-wrap">{entry.seriesKey}</h3>
                <DataFreshness
                  meta={{
                    ...entry.meta,
                    attribution:
                      entry.meta.attribution ??
                      (m.sourceAttributions as Record<string, string>)[entry.meta.source],
                  }}
                  kind="delayed"
                />
              </div>
            ))}
            {sourcePage > 0 && <Link href={`?sources=${sourcePage - 1}`}>{m.previous}</Link>}
            {(sourcePage + 1) * 50 < run.seriesMetadata.length && (
              <Link href={`?sources=${sourcePage + 1}`}>{m.next}</Link>
            )}
          </>
        ) : (
          <p data-missing-metadata>{m.missingMetadata}</p>
        )}
      </Panel>
      <Panel>
        <h2>{m.reproduce}</h2>
        <p>{m.reproduceNote}</p>
        <dl>
          <dt>{m.seed}</dt>
          <dd>{run.reproducibility?.seed ?? m.noValue}</dd>
          <dt>{m.algorithm}</dt>
          <dd>{run.reproducibility?.algorithmVersion ?? m.noValue}</dd>
        </dl>
        <details>
          <summary>{m.params}</summary>
          <Values values={run.params} />
        </details>
        <details>
          <summary>{m.dataVersion}</summary>
          <Values values={run.reproducibility?.dataVersion ?? {}} />
        </details>
        <details>
          <summary>{m.libraries}</summary>
          <Values values={run.reproducibility?.libraries ?? {}} />
        </details>
        <p>{formatDateTime(run.createdAt)}</p>
      </Panel>
      <Disclaimer disclaimerKey="analysis" version={run.compliance.disclaimerVersion} />
    </>
  );
}
