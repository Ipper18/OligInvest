import {
  type CurrencyCode,
  createFormatters,
  formatMessage,
  getPerformanceCopy,
} from "@oliginvest/i18n";
import { AssumptionsBlock, DataFreshness } from "@oliginvest/ui";
import { getLocalization } from "@oliginvest/ui/localization-server";
import { notFound } from "next/navigation";
import { createCurrencyExposureSchema } from "../modules";
import { DomainError, domainRequest } from "./resources";

type Money = { amount: string; currency: string } | null;

// Server-rendered tables only: no client JavaScript on /portfel/wyniki for this section.
export async function CurrencyExposureSection({
  filter,
}: {
  filter: { accountId?: string | undefined; to?: string | undefined };
}) {
  const localization = await getLocalization();
  const copy = getPerformanceCopy(localization.locale).exposure;
  const { formatMoney, formatPercent, formatDate, formatQuantity, formatFxRate } =
    createFormatters(localization);
  const query = new URLSearchParams();
  if (filter.accountId) query.set("accountId", filter.accountId);
  if (filter.to) query.set("asOf", filter.to);
  const result = await domainRequest(`/portfolio/currency-exposure?${query}`)
    .then((v) => createCurrencyExposureSchema().parse(v))
    .catch((error) => {
      if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
      throw error;
    });
  const amount = (value: Money, signed = false) =>
    value
      ? formatMoney(value.amount, value.currency as CurrencyCode, { signed })
      : copy.unavailable;
  const rate = (slice: (typeof result.slices)[number]) => {
    if (slice.currency === result.currency) return copy.base;
    if (!slice.fxRate) return copy.unavailable;
    const values = {
      rate: formatFxRate(slice.fxRate.rate),
      date: formatDate(slice.fxRate.rateDate),
    };
    const text = slice.fxRate.tableNo
      ? formatMessage(copy.rateDetails, { ...values, table: slice.fxRate.tableNo })
      : formatMessage(copy.rateNoTable, values);
    return slice.fxRate.source === "nbp" ? text : `${text} (${copy[slice.fxRate.source]})`;
  };
  const { rows, total, exclusions } = result.decomposition;
  const counts = new Map<keyof typeof copy.reasons, number>();
  for (const e of exclusions) counts.set(e.reason, (counts.get(e.reason) ?? 0) + 1);
  const reasons = [...counts].map(([reason, count]) =>
    formatMessage(copy.reasonCount, {
      reason: copy.reasons[reason],
      count: formatQuantity(String(count)),
    }),
  );
  return (
    <section aria-label={copy.title} id="currency-exposure">
      <h2>
        {copy.title} — {result.currency}
      </h2>
      <DataFreshness kind="eod" sessionDate={result.meta.asOf.slice(0, 10)} meta={result.meta} />
      <AssumptionsBlock summary={copy.assumptions}>
        <p>{copy.explanation}</p>
        <p>{copy.decompositionExplanation}</p>
        <p>{formatMessage(copy.date, { date: formatDate(result.date) })}</p>
      </AssumptionsBlock>
      {result.status !== "ok" && (
        <p className="oi-partial" role="status">
          {copy[result.status === "no_data" ? "empty" : "incomplete"]}
        </p>
      )}
      {result.slices.length > 0 && (
        <details>
          <summary>{copy.exposureTable}</summary>
          <section
            className="oi-table-scroll"
            aria-label={copy.exposureTable}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: Horizontal scrolling must be available from the keyboard, as in DataTable.
            tabIndex={0}
          >
            <table className="oi-data-table">
              <caption>{copy.exposureTable}</caption>
              <thead>
                <tr>
                  {[
                    copy.currency,
                    copy.valueInCurrency,
                    copy.securities,
                    copy.cash,
                    copy.value,
                    copy.weight,
                    copy.rate,
                    copy.status,
                  ].map((title) => (
                    <th scope="col" key={title}>
                      {title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.slices.map((slice) => (
                  <tr key={slice.currency}>
                    <th scope="row">{slice.currency}</th>
                    <td className="num">{amount(slice.valueInCurrency)}</td>
                    <td className="num">{amount(slice.securities)}</td>
                    <td className="num">{amount(slice.cash)}</td>
                    <td className="num">{amount(slice.value)}</td>
                    <td className="num">
                      {slice.weight === null ? copy.unavailable : formatPercent(slice.weight)}
                    </td>
                    <td>{rate(slice)}</td>
                    <td>{copy.statuses[slice.status]}</td>
                  </tr>
                ))}
              </tbody>
              {result.total && (
                <tfoot>
                  <tr>
                    <th scope="row">{copy.portfolioTotal}</th>
                    <td />
                    <td />
                    <td />
                    <td className="num">{amount(result.total)}</td>
                    <td />
                    <td />
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </section>
        </details>
      )}
      {result.status !== "no_data" && (
        <details>
          <summary>{copy.decompositionTable}</summary>
          {rows.length === 0 ? (
            <p role="status">{copy.noForeign}</p>
          ) : (
            <section
              className="oi-table-scroll"
              aria-label={copy.decompositionTable}
              // biome-ignore lint/a11y/noNoninteractiveTabindex: Horizontal scrolling must be available from the keyboard, as in DataTable.
              tabIndex={0}
            >
              <table className="oi-data-table">
                <caption>{copy.decompositionTable}</caption>
                <thead>
                  <tr>
                    {[
                      copy.currency,
                      copy.positions,
                      copy.unrealizedPl,
                      copy.priceEffect,
                      copy.fxEffect,
                      copy.status,
                    ].map((title) => (
                      <th scope="col" key={title}>
                        {title}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.currency}>
                      <th scope="row">{row.currency}</th>
                      <td className="num">{formatQuantity(String(row.positions))}</td>
                      <td className="num">{amount(row.unrealizedPl, true)}</td>
                      <td className="num">{amount(row.priceEffect, true)}</td>
                      <td className="num">{amount(row.fxEffect, true)}</td>
                      <td>{copy.statuses[row.status]}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">{copy.total}</th>
                    <td />
                    <td className="num">{amount(total.unrealizedPl, true)}</td>
                    <td className="num">{amount(total.priceEffect, true)}</td>
                    <td className="num">{amount(total.fxEffect, true)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </section>
          )}
          {!result.decomposition.isComplete && rows.length > 0 && (
            <p role="status">{copy.decompositionIncomplete}</p>
          )}
          {reasons.length > 0 && (
            <>
              <h3>{copy.exclusions}</h3>
              <ul>
                {reasons.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            </>
          )}
        </details>
      )}
    </section>
  );
}
