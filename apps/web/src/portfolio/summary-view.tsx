import { appMessages, portfolioMessages as m } from "@oliginvest/i18n";
import { AllocationBar, Panel, StatTile } from "@oliginvest/ui";
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
  unavailable = false,
  exposure,
}: {
  data: Resource<"summary">;
  day: Resource<"day">;
  notice?: ReactNode;
  dayNotice?: ReactNode;
  explain?: (key: "totalValue" | "dayChange" | "unrealizedPl" | "cash", term: string) => ReactNode;
  Table: typeof DataTable;
  unavailable?: boolean;
  exposure?: readonly { label: string; weight: number }[];
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
          <StatTile
            key={key}
            marker={key}
            label={m[key]}
            hero={key === "totalValue"}
            explainer={explain?.(key, m[key])}
            value={
              <>
                <Amount
                  value={data[key]}
                  stale={unavailable || data.meta.stale}
                  signed={key === "dayChange" || key === "unrealizedPl"}
                />
                {key === "dayChange" &&
                  !data.dayChange &&
                  day.meta.staleReason === "market_closed" && <small>{m.dayNoSession}</small>}
              </>
            }
          />
        ))}
      </dl>
      {(unavailable || data.meta.stale) && (
        <p className="oi-stale-banner" role="status">
          {appMessages.staleValues}
        </p>
      )}
      <div className="oi-dashboard-grid">
        <Panel>
          <p className="oi-help">{m.dayHelp}</p>
          {dayNotice}
          <Table
            caption={m.dayChange}
            headings={[m.instrument, m.dayChange, m.contributionRatio]}
            rows={[
              ...day.positions.map((p) => ({
                id: p.instrument.id,
                cells: [
                  instrumentLink(p.instrument.id, p.instrument.ticker),
                  <Amount
                    key="change"
                    value={p.change}
                    signed
                    stale={unavailable || day.meta.stale}
                  />,
                  ratio(unavailable || day.meta.stale ? null : p.contributionRatio),
                ],
              })),
              {
                id: "residual",
                cells: [
                  m.residualChange,
                  <Amount
                    key="change"
                    value={day.residualChange}
                    signed
                    stale={unavailable || day.meta.stale}
                  />,
                  m.not_applicable,
                ],
              },
            ]}
          />
          <Freshness meta={day.meta} />
        </Panel>
        <Panel>
          <h2>{appMessages.currencyExposure}</h2>
          {exposure?.length && !unavailable && !data.meta.stale ? (
            <AllocationBar items={exposure} />
          ) : (
            <p className="oi-help">{appMessages.exposurePending}</p>
          )}
        </Panel>
        <Panel className="oi-span-all">
          {!data.accounts?.length && (
            <div className="oi-empty-state">
              <h2>{appMessages.emptyPortfolio}</h2>
              <p>{m.emptyStart}</p>
              <Link className="oi-button oi-button-primary" href="/portfel/import">
                {appMessages.startImport}
              </Link>
            </div>
          )}
          <Table
            caption={m.accounts}
            headings={[m.account, m.totalValue, m.valueBase]}
            rows={(data.accounts ?? []).map((a) => ({
              id: a.accountId,
              cells: [
                <Link key={a.accountId} href={`/portfel/rachunki/${a.accountId}`}>
                  {a.name}
                </Link>,
                <Amount key="total" value={a.totalValue} stale={unavailable || data.meta.stale} />,
                <Amount
                  key="base"
                  value={a.totalValueBase}
                  stale={unavailable || data.meta.stale}
                />,
              ],
            }))}
          />
          <Freshness meta={data.meta} />
        </Panel>
      </div>
    </>
  );
}
