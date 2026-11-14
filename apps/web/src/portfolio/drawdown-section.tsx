import { createFormatters, getPerformanceCopy } from "@oliginvest/i18n";
import { AssumptionsBlock, DataFreshness } from "@oliginvest/ui";
import { getLocalization } from "@oliginvest/ui/localization-server";
import { notFound } from "next/navigation";
import { createDrawdownSchema } from "../modules";
import { DrawdownChart } from "./drawdown-chart";
import { DomainError, domainRequest } from "./resources";

export async function DrawdownSection({
  filter,
  page = 1,
  navigationQuery,
}: {
  filter: { accountId?: string | undefined; from?: string | undefined; to?: string | undefined };
  page?: number;
  navigationQuery: string;
}) {
  const localization = await getLocalization();
  const copy = getPerformanceCopy(localization.locale).drawdown;
  const { formatPercent, formatDate, formatQuantity } = createFormatters(localization);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) if (value) query.set(key, value);
  const result = await domainRequest(`/portfolio/drawdown?${query}`)
    .then((v) => createDrawdownSchema().parse(v))
    .catch((error) => {
      if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
      throw error;
    });
  const date = (value: string | null) => (value ? formatDate(value) : copy.unavailable);
  const days = (value: number | null) =>
    value === null ? copy.unavailable : formatQuantity(String(value));
  const current = Math.min(page, Math.max(1, Math.ceil(result.underwater.t.length / 100)));
  const link = (next: number) => {
    const params = new URLSearchParams(navigationQuery);
    params.set("drawdownPage", String(next));
    return `?${params}#drawdown-table`;
  };
  return (
    <section aria-label={copy.title}>
      <h2>
        {copy.title} — {result.currency}
      </h2>
      <DataFreshness kind="eod" sessionDate={result.to} meta={result.meta} />
      <AssumptionsBlock summary={copy.assumptions}>
        <p>{copy.explanation}</p>
        <p>
          {formatDate(result.from)} – {formatDate(result.to)}
        </p>
      </AssumptionsBlock>
      {result.maxDrawdown === null ? (
        <p role="status">{copy[result.status === "no_data" ? "empty" : "incomplete"]}</p>
      ) : (
        <>
          <dl>
            <dt>{copy.maximum}</dt>
            <dd>{formatPercent(result.maxDrawdown)}</dd>
            <dt>{copy.peak}</dt>
            <dd>{date(result.peakDate)}</dd>
            <dt>{copy.trough}</dt>
            <dd>{date(result.troughDate)}</dd>
            <dt>{copy.duration}</dt>
            <dd>{days(result.durationDays)}</dd>
            <dt>{copy.recovery}</dt>
            <dd>
              {result.troughDate && !result.recoveryDate
                ? copy.unrecovered
                : date(result.recoveryDate)}
            </dd>
            <dt>{copy.recoveryDays}</dt>
            <dd>{days(result.recoveryDays)}</dd>
          </dl>
          {result.maxDrawdown === "0" && <p>{copy.noDecline}</p>}
          {result.decimated && <p>{copy.decimated}</p>}
          <DrawdownChart
            series={result.underwater}
            label={copy.chart}
            unavailable={copy.chartUnavailable}
          />
          <details id="drawdown-table" open={page > 1}>
            <summary>{copy.table}</summary>
            <table className="oi-data-table">
              <caption>{copy.table}</caption>
              <thead>
                <tr>
                  <th scope="col">{copy.date}</th>
                  <th scope="col">{copy.depth}</th>
                </tr>
              </thead>
              <tbody>
                {result.underwater.t.slice((current - 1) * 100, current * 100).map((t, i) => (
                  <tr key={t}>
                    <th scope="row">{formatDate(new Date(t * 1000).toISOString().slice(0, 10))}</th>
                    <td>{formatPercent(result.underwater.drawdown[(current - 1) * 100 + i]!)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {current > 1 && <a href={link(current - 1)}>{copy.previous}</a>}
            {current * 100 < result.underwater.t.length && (
              <a href={link(current + 1)}>{copy.next}</a>
            )}
          </details>
        </>
      )}
    </section>
  );
}
