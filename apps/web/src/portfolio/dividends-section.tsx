import {
  type CurrencyCode,
  createFormatters,
  formatMessage,
  getPerformanceCopy,
} from "@oliginvest/i18n";
import { AssumptionsBlock, DataFreshness, Disclaimer } from "@oliginvest/ui";
import { getLocalization } from "@oliginvest/ui/localization-server";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { createDividendsSchema } from "../modules";
import { DomainError, domainRequest } from "./resources";

type Money = { amount: string; currency: string } | null;

function Table({
  caption,
  headers,
  children,
}: {
  caption: string;
  headers: string[];
  children: ReactNode;
}) {
  return (
    <section
      className="oi-table-scroll"
      aria-label={caption}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: Horizontal scrolling must be available from the keyboard, as in DataTable.
      tabIndex={0}
    >
      <table className="oi-data-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            {headers.map((title) => (
              <th scope="col" key={title}>
                {title}
              </th>
            ))}
          </tr>
        </thead>
        {children}
      </table>
    </section>
  );
}

// Server-rendered, collapsed tables only: no client JavaScript on /portfel/wyniki for this section.
export async function DividendsSection({
  filter,
}: {
  filter: { accountId?: string | undefined; from?: string | undefined; to?: string | undefined };
}) {
  const localization = await getLocalization();
  const copy = getPerformanceCopy(localization.locale).dividends;
  const { formatMoney, formatPercent, formatDate, formatQuantity, formatFxRate } =
    createFormatters(localization);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) if (value) query.set(key, value);
  const result = await domainRequest(`/portfolio/dividends?${query}`)
    .then((v) => createDividendsSchema().parse(v))
    .catch((error) => {
      if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
      throw error;
    });
  const amount = (value: Money) =>
    value ? formatMoney(value.amount, value.currency as CurrencyCode) : copy.unavailable;
  type Totals = (typeof result)["totals"];
  // A missing top-up is "not applicable" only when no payment is taxable, otherwise unknown.
  const topUp = (totals: Totals) =>
    totals.estimatedTopUpPln
      ? amount(totals.estimatedTopUpPln)
      : totals.taxablePayments === 0 && totals.payments > 0
        ? copy.taxStatuses.not_applicable
        : copy.unavailable;
  const totalCells = (totals: Totals) => (
    <>
      <td className="num">{formatQuantity(String(totals.payments))}</td>
      <td className="num">{amount(totals.grossPln)}</td>
      <td className="num">{amount(totals.withholdingTaxPln)}</td>
      <td className="num">{amount(totals.netPln)}</td>
      <td className="num">{topUp(totals)}</td>
    </>
  );
  const totalHeaders = [copy.payments, copy.grossPln, copy.withholdingPln, copy.netPln, copy.topUp];
  const rate = (row: (typeof result.rows)[number]) => {
    if (row.gross.currency === result.currency) return copy.base;
    if (!row.fxRate) return copy.unavailable;
    const values = { rate: formatFxRate(row.fxRate.rate), date: formatDate(row.fxRate.rateDate) };
    return row.fxRate.tableNo
      ? formatMessage(copy.rateDetails, { ...values, table: row.fxRate.tableNo })
      : formatMessage(copy.rateNoTable, values);
  };
  const gaps = result.gaps.map((g) =>
    formatMessage(copy.gapCount, {
      reason: copy.gaps[g.reason],
      count: formatQuantity(String(g.payments)),
    }),
  );
  return (
    <section aria-label={copy.title} id="dividends">
      <h2>
        {copy.title} — {result.currency}
      </h2>
      <DataFreshness kind="eod" sessionDate={result.to} meta={result.meta} />
      <AssumptionsBlock summary={copy.assumptions}>
        <p>{copy.explanation}</p>
        <p>{copy.topUpExplanation}</p>
        <p>{formatMessage(copy.yieldExplanation, { date: formatDate(result.to) })}</p>
        <p>
          {result.from
            ? formatMessage(copy.range, {
                from: formatDate(result.from),
                to: formatDate(result.to),
              })
            : formatMessage(copy.rangeAll, { to: formatDate(result.to) })}
        </p>
      </AssumptionsBlock>
      {result.status !== "ok" && (
        <p className="oi-partial" role="status">
          {copy[result.status === "no_data" ? "empty" : "incomplete"]}
        </p>
      )}
      {result.status !== "no_data" && (
        <>
          <details>
            <summary>{copy.summaryTable}</summary>
            <Table caption={copy.summaryTable} headers={["", ...totalHeaders]}>
              <tbody>
                <tr>
                  <th scope="row">{copy.total}</th>
                  {totalCells(result.totals)}
                </tr>
              </tbody>
            </Table>
            {result.totals.taxExemptPayments > 0 && (
              <p>
                {formatMessage(copy.taxExempt, {
                  count: formatQuantity(String(result.totals.taxExemptPayments)),
                })}
              </p>
            )}
          </details>
          <details>
            <summary>{copy.yearTable}</summary>
            <Table caption={copy.yearTable} headers={[copy.year, ...totalHeaders]}>
              <tbody>
                {result.byYear.map((y) => (
                  <tr key={y.year}>
                    <th scope="row">{y.year}</th>
                    {totalCells(y.totals)}
                  </tr>
                ))}
              </tbody>
            </Table>
          </details>
          <details>
            <summary>{copy.instrumentTable}</summary>
            <Table
              caption={copy.instrumentTable}
              headers={[
                copy.instrument,
                ...totalHeaders,
                copy.trailingGross,
                copy.cost,
                copy.yieldOnCost,
              ]}
            >
              <tbody>
                {result.byInstrument.map((i) => (
                  <tr key={i.instrument.id}>
                    <th scope="row">{i.instrument.ticker}</th>
                    {totalCells(i.totals)}
                    <td className="num">{amount(i.yieldOnCost.trailingGrossPln)}</td>
                    <td className="num">{amount(i.yieldOnCost.costPln)}</td>
                    <td className="num">
                      {i.yieldOnCost.ratio !== null
                        ? formatPercent(i.yieldOnCost.ratio)
                        : `${copy.unavailable} (${copy.yieldReasons[i.yieldOnCost.reason ?? "missing_cost"]})`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </details>
          <details>
            <summary>{copy.paymentsTable}</summary>
            <Table
              caption={copy.paymentsTable}
              headers={[
                copy.instrument,
                copy.payDate,
                copy.gross,
                copy.withholding,
                copy.net,
                copy.credited,
                copy.rate,
                copy.grossPln,
                copy.withholdingPln,
                copy.netPln,
                copy.topUp,
                copy.status,
              ]}
            >
              <tbody>
                {result.rows.map((row) => (
                  <tr key={row.transactionId}>
                    <th scope="row">{row.instrument.ticker}</th>
                    <td>{formatDate(row.payDate)}</td>
                    <td className="num">{amount(row.gross)}</td>
                    <td className="num">{amount(row.withholdingTax)}</td>
                    <td className="num">{amount(row.net)}</td>
                    <td className="num">{amount(row.credited)}</td>
                    <td>{rate(row)}</td>
                    <td className="num">{amount(row.grossPln)}</td>
                    <td className="num">{amount(row.withholdingTaxPln)}</td>
                    <td className="num">{amount(row.netPln)}</td>
                    <td className="num">
                      {row.tax.status === "not_applicable"
                        ? copy.taxStatuses.not_applicable
                        : amount(row.tax.estimatedTopUpPln)}
                    </td>
                    <td>{copy.taxStatuses[row.tax.status]}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </details>
          <details>
            <summary>{copy.currencyTable}</summary>
            <Table
              caption={copy.currencyTable}
              headers={[copy.currency, copy.payments, copy.gross, copy.withholding, copy.net]}
            >
              <tbody>
                {result.totalsByCurrency.map((c) => (
                  <tr key={c.currency}>
                    <th scope="row">{c.currency}</th>
                    <td className="num">{formatQuantity(String(c.payments))}</td>
                    <td className="num">{amount(c.gross)}</td>
                    <td className="num">{amount(c.withholdingTax)}</td>
                    <td className="num">{amount(c.net)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </details>
        </>
      )}
      {gaps.length > 0 && (
        <>
          <h3>{copy.gapsTitle}</h3>
          <ul>
            {gaps.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </>
      )}
      <Disclaimer disclaimerKey="tax_view" version="2026-09" />
    </section>
  );
}
