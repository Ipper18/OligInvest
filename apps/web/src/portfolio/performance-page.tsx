import {
  createFormatters,
  portfolioMessages as defaultM,
  getPerformanceCopy,
} from "@oliginvest/i18n";
import { AssumptionsBlock, DataFreshness, Disclaimer } from "@oliginvest/ui";
import { getLocalization } from "@oliginvest/ui/localization-server";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireMe } from "../auth/session";
import { createPerformanceSchema } from "../modules";
import type { SearchParams } from "./page";
import { PortfolioHeader } from "./page-header";
import { DomainError, domainRequest, fetchResource } from "./resources";

const querySchema = z
  .object({
    accountId: z.uuid().optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    currency: z.enum(["base", "account"]).default("base"),
    view: z.enum(["economic", "tax"]).optional(),
    groupBy: z.enum(["day", "month", "year", "instrument", "account"]).default("month"),
  })
  .strict();

export async function PerformancePage({ searchParams }: { searchParams: SearchParams }) {
  const performanceSchema = createPerformanceSchema();
  const [me, localization, search] = await Promise.all([
    requireMe(),
    getLocalization(),
    searchParams,
  ]);
  const m = (localization.copies["portfolioMessages"] as typeof defaultM | undefined) ?? defaultM;
  const copy = getPerformanceCopy(localization.locale);
  const { formatPercent, formatDate } = createFormatters(localization);
  const parsed = querySchema.safeParse(
    Object.fromEntries(Object.entries(search).filter(([, v]) => v !== "")),
  );
  if (!parsed.success) notFound();
  const {
    currency: requestedCurrency,
    view = me.preferences.plView,
    groupBy,
    ...filter
  } = parsed.data;
  const currency = filter.accountId ? requestedCurrency : "base";
  const args = { ...filter, view, groupBy };
  const query = new URLSearchParams({ currency });
  for (const [key, value] of Object.entries(filter)) if (value) query.set(key, value);
  const [accounts, realized, performance] = await Promise.all([
    fetchResource("accounts"),
    fetchResource("realized", args),
    domainRequest(`/portfolio/performance?${query}`)
      .then((value) => performanceSchema.parse(value))
      .catch((error) => {
        if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
        throw error;
      }),
  ]);
  const { RealizedScreen } = await import("./screens");
  const ratio = (value: string | null | undefined) =>
    value == null ? m.unavailable : formatPercent(value);
  return (
    <section>
      <PortfolioHeader
        title={copy.title}
        current="realized"
        filters={{ accounts: accounts.data, args, view: true }}
      >
        <label>
          {m.from}
          <input type="date" name="from" defaultValue={filter.from} />
        </label>
        <label>
          {m.to}
          <input type="date" name="to" defaultValue={filter.to} />
        </label>
        <label>
          {copy.currency}
          <select name="currency" defaultValue={currency}>
            <option value="base">{copy.base}</option>
            <option value="account" disabled={!filter.accountId}>
              {copy.account}
            </option>
          </select>
        </label>
        <label>
          {m.groupBy}
          <select name="groupBy" defaultValue={groupBy}>
            {(["day", "month", "year", "instrument", "account"] as const).map((key) => (
              <option key={key} value={key}>
                {m[key]}
              </option>
            ))}
          </select>
        </label>
      </PortfolioHeader>
      <h2>
        {copy.returns} — {performance.currency}
      </h2>
      <p>
        {formatDate(performance.from)} – {formatDate(performance.to)}
      </p>
      <DataFreshness kind="eod" sessionDate={performance.to} meta={performance.meta} />
      <AssumptionsBlock summary={copy.assumptions}>
        <p>{copy.explanation}</p>
        <p>{copy.range}</p>
      </AssumptionsBlock>
      {performance.total.twr === null && (
        <p className="oi-partial" role="status">
          {copy.gaps}
        </p>
      )}
      <section
        className="oi-table-scroll"
        aria-label={copy.returns}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Horizontal scrolling must be available from the keyboard, as in DataTable.
        tabIndex={0}
      >
        <table className="oi-data-table">
          <caption>{copy.returns}</caption>
          <thead>
            <tr>
              {[copy.period, copy.twr, copy.annualized, copy.xirr, m.status].map((title) => (
                <th scope="col" key={title}>
                  {title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[{ ...performance.total, key: "total" as const }, ...performance.periods].map(
              (row) => (
                <tr key={row.key}>
                  <th scope="row">{row.key === "total" ? copy.total : copy.periods[row.key]}</th>
                  <td className="num">{ratio(row.twr)}</td>
                  <td className="num">{ratio(row.twrAnnualized)}</td>
                  <td className="num">{ratio(row.xirr)}</td>
                  <td>{row.xirrStatus ? copy.statuses[row.xirrStatus] : m.unavailable}</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </section>
      <Disclaimer disclaimerKey="general" version="2026-09" />
      <h2>{m.realized}</h2>
      <RealizedScreen userId={me.id} args={args} accounts={accounts.data} initial={realized} />
    </section>
  );
}
