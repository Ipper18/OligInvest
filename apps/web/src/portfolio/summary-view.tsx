import { portfolioMessages as m } from "@oliginvest/i18n";
import type { DataTable } from "@oliginvest/ui/table";
import Link from "next/link";
import type { ReactNode } from "react";
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
  explain,
  Table,
}: {
  data: Resource<"summary">;
  day: Resource<"day">;
  notice?: ReactNode;
  dayNotice?: ReactNode;
  explain?: (key: "totalValue" | "dayChange" | "unrealizedPl" | "cash", term: string) => ReactNode;
  Table: typeof DataTable;
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
              {explain?.(key, m[key])}
            </dt>
            <dd>
              <Amount value={data[key]} signed={key === "dayChange" || key === "unrealizedPl"} />
              {key === "dayChange" &&
                !data.dayChange &&
                day.meta.staleReason === "market_closed" && <small>{m.dayNoSession}</small>}
            </dd>
          </div>
        ))}
      </dl>
      <p>{m.dayHelp}</p>
      {dayNotice}
      <Table
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
      <Table
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
