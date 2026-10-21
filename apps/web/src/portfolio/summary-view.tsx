import { portfolioMessages as m } from "@oliginvest/i18n";
import Link from "next/link";
import type { ReactNode } from "react";
import { Explainer } from "../education/explainer";
import { MetricTable as DataTable } from "../education/metric-table";
import { Amount, Freshness, ratio, TaxDisclaimer } from "./presentation";
import type { Resource } from "./resources";

const instrumentLink = (id: string, title: string) => (
  <Link prefetch={false} href={`/rynek/${id}`}>
    {title}
  </Link>
);
export function SummaryView({
  data,
  day,
  notice,
  dayNotice,
}: {
  data: Resource<"summary">;
  day: Resource<"day">;
  notice?: ReactNode;
  dayNotice?: ReactNode;
}) {
  return (
    <>
      {notice}
      <TaxDisclaimer view={data.view} />
      {!data.isComplete && <p className="oi-partial">{m.partial}</p>}
      {data.exclusions.count > 0 && (
        <p>
          {m.excluded} {data.exclusions.count}
        </p>
      )}
      <dl className="oi-kpis">
        {(["totalValue", "dayChange", "unrealizedPl", "cash"] as const).map((key) => (
          <div key={key} className="oi-kpi" data-onboarding={key}>
            <dt>
              {m[key]}
              <Explainer
                termKey={
                  {
                    totalValue: "wartosc",
                    dayChange: "wynik-dnia",
                    unrealizedPl: "pl",
                    cash: "gotowka",
                  }[key]
                }
                term={m[key]}
              />
            </dt>
            <dd>
              <Amount value={data[key]} signed={key === "dayChange" || key === "unrealizedPl"} />
            </dd>
          </div>
        ))}
      </dl>
      <p>{m.dayHelp}</p>
      {dayNotice}
      <DataTable
        caption={m.dayChange}
        headings={[m.instrument, m.dayChange, m.contributionRatio]}
        rows={[
          ...day.positions.map((p) => ({
            id: p.instrument.id,
            cells: [
              instrumentLink(p.instrument.id, p.instrument.ticker),
              <Amount key="change" value={p.change} signed />,
              ratio(p.contributionRatio),
            ],
          })),
          {
            id: "residual",
            cells: [
              m.residualChange,
              <Amount key="change" value={day.residualChange} signed />,
              m.not_applicable,
            ],
          },
        ]}
      />
      <Freshness meta={data.meta} />
      {!data.accounts?.length && <p>{m.emptyStart}</p>}
      <DataTable
        caption={m.accounts}
        headings={[m.account, m.totalValue, m.valueBase]}
        rows={(data.accounts ?? []).map((a) => ({
          id: a.accountId,
          cells: [
            <Link key={a.accountId} href={`/portfel/rachunki/${a.accountId}`}>
              {a.name}
            </Link>,
            <Amount key="total" value={a.totalValue} />,
            <Amount key="base" value={a.totalValueBase} />,
          ],
        }))}
      />
    </>
  );
}
