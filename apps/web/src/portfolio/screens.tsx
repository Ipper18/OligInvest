"use client";
import {
  type CurrencyCode,
  formatDate,
  formatMessage,
  formatQuantity,
  portfolioMessages as m,
} from "@oliginvest/i18n";
import { ChangeValue, Disclosure, MoneyValue, StatTile } from "@oliginvest/ui";
import Link from "next/link";
import { Explainer } from "../education/explainer";
import { metricKeys } from "../education/metric-keys";
import { MetricTable as DataTable } from "../education/metric-table";
import { Amount, Freshness, ratio, TaxDisclaimer } from "./presentation";
import { QueryNotice, useResource } from "./query";
import type { ReadArgs, Resource } from "./resources";

type Props<K extends "summary" | "positions" | "transactions" | "accounts" | "lots" | "realized"> =
  {
    userId: string;
    args: ReadArgs;
    initial: Resource<K>;
    accounts: Resource<"accounts">["data"];
  };
const accountName = (accounts: Resource<"accounts">["data"], id?: string) =>
  accounts.find((a) => a.id === id)?.name ?? m.allAccounts;
const instrumentLink = (id: string, title: string) => (
  <Link prefetch={false} href={`/rynek/${id}`}>
    {title}
  </Link>
);
type Position = Resource<"positions">["data"][number];
const currencies = ["PLN", "USD", "EUR"];
// Last known price stays visible with an explicit "nieaktualne" tag; offline it is hidden.
function LastPrice({ position, unavailable }: { position: Position; unavailable: boolean }) {
  const { price, priceCurrency } = position;
  if (unavailable || !price || !priceCurrency)
    return <span className="num oi-flat">{m.unavailable}</span>;
  return (
    <span className="oi-price">
      {currencies.includes(priceCurrency) ? (
        <MoneyValue value={price} currency={priceCurrency as CurrencyCode} />
      ) : (
        <span className="num">
          {price} {priceCurrency}
        </span>
      )}
      {position.meta.stale && <span className="oi-tag-stale">{m.staleTag}</span>}
    </span>
  );
}
const plRatio = (position: Position, stale: boolean) => (
  <ChangeValue
    value={position.unrealizedPlRatio == null ? null : String(position.unrealizedPlRatio)}
    stale={stale}
  />
);
export function PositionsScreen({
  userId,
  args,
  initial,
  accounts,
  initialCash,
  initialDay,
}: Props<"positions"> & { initialCash: Resource<"cash">; initialDay: Resource<"day"> }) {
  const query = useResource(userId, "positions", args, initial),
    data = query.data;
  const accountArgs = args.accountId ? { accountId: args.accountId } : {};
  const cash = useResource(userId, "cash", accountArgs, initialCash);
  // "Dziś" per instrument is the price change of the day from GET /portfolio/day-change.
  const day = useResource(userId, "day", accountArgs, initialDay);
  const dayStale = day.unavailable || day.data.meta.stale;
  const dayRatio = new Map(
    day.data.positions.map((d) => [d.instrument.id, d.priceChangeRatio ?? null]),
  );
  const today = (p: Position) => {
    const value = dayRatio.get(p.instrument.id);
    return <ChangeValue value={value == null ? null : String(value)} stale={dayStale} />;
  };
  const stale = (p: Position) => query.unavailable || p.meta.stale;
  const totalsStale = query.unavailable || data.meta.stale;
  const listing = (p: Position) =>
    [
      p.instrument.ticker,
      p.instrument.exchangeShortName ?? p.instrument.mic,
      p.accountId && accountName(accounts, p.accountId),
    ]
      .filter(Boolean)
      .join(" · ");
  const key = (p: Position) => `${p.accountId ?? "all"}:${p.instrument.id}`;
  return (
    <>
      <QueryNotice
        failed={query.isError || cash.isError || day.isError}
        retry={() => {
          void cash.refetch();
          void day.refetch();
          return query.refetch();
        }}
      />
      <TaxDisclaimer view={data.view} />
      {!data.isComplete && <p className="oi-partial">{m.partial}</p>}
      {data.totals.exclusions.count > 0 && (
        <p>
          {m.excluded} {data.totals.exclusions.count}
        </p>
      )}
      <dl className="oi-kpis oi-kpis-compact">
        <StatTile
          label={m.valueBase}
          value={<Amount value={data.totals.marketValueBase} stale={totalsStale} />}
        />
        <StatTile
          label={m.unrealizedPl}
          explainer={<Explainer termKey={metricKeys.unrealizedPl} term={m.unrealizedPl} />}
          value={<Amount value={data.totals.unrealizedPl} signed stale={totalsStale} />}
        />
        <StatTile
          label={m.dayChange}
          explainer={<Explainer termKey={metricKeys.dayChange} term={m.dayChange} />}
          value={<Amount value={day.data.change} signed stale={dayStale} />}
        />
        <StatTile label={m.positions} value={formatQuantity(String(data.data.length))} />
      </dl>
      {data.data.length === 0 ? (
        <p className="oi-panel">{m.empty}</p>
      ) : (
        <>
          {data.data.length > 100 ? (
            <DataTable
              caption={m.positions}
              headings={[
                m.instrument,
                m.quantity,
                m.lastPrice,
                m.valueBase,
                m.cost,
                m.weight,
                m.today,
                m.result,
              ]}
              rows={[
                ...data.data.map((p) => ({
                  id: key(p),
                  cells: [
                    <span key="instrument" className="oi-instrument-label">
                      {instrumentLink(p.instrument.id, p.instrument.name)}
                      <small>{listing(p)}</small>
                    </span>,
                    <span key="quantity" className="num">
                      {formatQuantity(p.quantity)}
                    </span>,
                    <LastPrice key="price" position={p} unavailable={query.unavailable} />,
                    <Amount key="value" value={p.marketValueBase} stale={stale(p)} />,
                    <Amount key="cost" value={p.costBasis} unknownCost />,
                    <span key="weight" className="num">
                      {ratio(stale(p) ? null : p.weight)}
                    </span>,
                    today(p),
                    <span key="result" className="oi-stack">
                      <Amount value={p.unrealizedPl} signed stale={stale(p)} />
                      {plRatio(p, stale(p))}
                    </span>,
                  ],
                })),
                {
                  id: "total",
                  cells: [
                    m.total,
                    null,
                    null,
                    <Amount key="value" value={data.totals.marketValueBase} stale={totalsStale} />,
                    <Amount
                      key="cost"
                      value={data.totals.costBasis}
                      unknownCost
                      stale={totalsStale}
                    />,
                    null,
                    null,
                    <Amount
                      key="result"
                      value={data.totals.unrealizedPl}
                      signed
                      stale={totalsStale}
                    />,
                  ],
                },
              ]}
            />
          ) : (
            <>
              <section
                className="oi-table-scroll oi-positions-table"
                aria-label={m.positions}
                // biome-ignore lint/a11y/noNoninteractiveTabindex: Scrollable table must be reachable from the keyboard.
                tabIndex={0}
              >
                <table className="oi-data-table">
                  <caption className="oi-sr">{m.positions}</caption>
                  <thead>
                    <tr>
                      {[
                        m.instrument,
                        m.quantity,
                        m.lastPrice,
                        m.valueBase,
                        m.cost,
                        m.weight,
                        m.today,
                        m.result,
                      ].map((heading) => (
                        <th key={heading} scope="col">
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.data.map((p) => (
                      <tr key={key(p)}>
                        <th scope="row">
                          <span className="oi-instrument-label">
                            {instrumentLink(p.instrument.id, p.instrument.name)}
                            <small>{listing(p)}</small>
                          </span>
                        </th>
                        <td className="num">{formatQuantity(p.quantity)}</td>
                        <td>
                          <LastPrice position={p} unavailable={query.unavailable} />
                        </td>
                        <td>
                          <Amount value={p.marketValueBase} stale={stale(p)} />
                        </td>
                        <td>
                          <Amount value={p.costBasis} unknownCost />
                        </td>
                        <td className="num">{ratio(stale(p) ? null : p.weight)}</td>
                        <td>{today(p)}</td>
                        <td>
                          <span className="oi-stack">
                            <Amount value={p.unrealizedPl} signed stale={stale(p)} />
                            {plRatio(p, stale(p))}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row">{m.total}</th>
                      <td />
                      <td />
                      <td>
                        <Amount value={data.totals.marketValueBase} stale={totalsStale} />
                      </td>
                      <td>
                        <Amount value={data.totals.costBasis} unknownCost stale={totalsStale} />
                      </td>
                      <td />
                      <td />
                      <td>
                        <Amount value={data.totals.unrealizedPl} signed stale={totalsStale} />
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </section>
              <ul className="oi-position-cards" aria-label={m.positions}>
                {data.data.map((p) => (
                  <li key={key(p)}>
                    <details>
                      <summary>
                        <span className="oi-instrument-label">
                          <strong>{p.instrument.name}</strong>
                          <small>
                            {p.instrument.ticker} ·{" "}
                            {formatMessage(m.units, { value: formatQuantity(p.quantity) })}
                          </small>
                        </span>
                        <span className="oi-stack">
                          <Amount value={p.marketValueBase} stale={stale(p)} />
                          {plRatio(p, stale(p))}
                        </span>
                      </summary>
                      <dl className="oi-position-facts">
                        <div>
                          <dt>{m.lastPrice}</dt>
                          <dd>
                            <LastPrice position={p} unavailable={query.unavailable} />
                          </dd>
                        </div>
                        <div>
                          <dt>{m.weight}</dt>
                          <dd className="num">{ratio(stale(p) ? null : p.weight)}</dd>
                        </div>
                        <div>
                          <dt>{m.cost}</dt>
                          <dd>
                            <Amount value={p.costBasis} unknownCost />
                          </dd>
                        </div>
                        <div>
                          <dt>{m.today}</dt>
                          <dd>{today(p)}</dd>
                        </div>
                        <div>
                          <dt>{m.result}</dt>
                          <dd>
                            <Amount value={p.unrealizedPl} signed stale={stale(p)} />
                          </dd>
                        </div>
                        <div>
                          <dt>{m.account}</dt>
                          <dd>{accountName(accounts, p.accountId)}</dd>
                        </div>
                      </dl>
                      {instrumentLink(p.instrument.id, m.instrumentCard)}
                    </details>
                  </li>
                ))}
              </ul>
            </>
          )}
          <Disclosure summary={m.resultBreakdown}>
            <DataTable
              caption={m.resultBreakdown}
              headings={[m.instrument, m.averageCost, m.localPl, m.priceEffect, m.fxEffect]}
              rows={data.data.map((p) => ({
                id: key(p),
                cells: [
                  instrumentLink(p.instrument.id, p.instrument.ticker),
                  <Amount key="average" value={p.averageCost} unknownCost />,
                  <Amount
                    key="local"
                    value={p.unrealizedPlInstrumentCurrency}
                    signed
                    stale={stale(p)}
                  />,
                  <Amount key="price" value={p.priceEffect} signed stale={stale(p)} />,
                  <Amount key="fx" value={p.fxEffect} signed stale={stale(p)} />,
                ],
              }))}
            />
          </Disclosure>
        </>
      )}
      <Freshness meta={data.meta} />
      <p className="oi-help">{m.fifoHelp}</p>
      <DataTable
        caption={m.cash}
        headings={[m.account, m.cash, m.valueBase, m.date]}
        rows={cash.data.data.map((c) => ({
          id: `${c.accountId}:${c.balance.currency}`,
          cells: [
            accountName(accounts, c.accountId),
            <Amount key="cash" value={c.balance} />,
            <Amount key="base" value={c.balanceBase} />,
            formatDate(c.asOf),
          ],
        }))}
      />
    </>
  );
}
export function PageLinks({
  page,
  args,
}: {
  page: { hasMore: boolean; nextCursor?: string | undefined };
  args: ReadArgs;
}) {
  const params = new URLSearchParams(
    Object.entries(args).filter((p): p is [string, string] => Boolean(p[1])),
  );
  params.delete("cursor");
  const first = `?${params}`;
  if (page.nextCursor) params.set("cursor", page.nextCursor);
  return (
    <div className="oi-actions">
      {args.cursor && <Link href={first}>{m.first}</Link>}
      {page.hasMore && page.nextCursor && <Link href={`?${params}`}>{m.next}</Link>}
    </div>
  );
}
export function TransactionsScreen({ userId, args, initial, accounts }: Props<"transactions">) {
  const query = useResource(userId, "transactions", args, initial);
  return (
    <>
      <QueryNotice failed={query.isError} retry={query.refetch} />
      <DataTable
        caption={m.transactions}
        headings={[m.date, m.type, m.account, m.quantity, m.amount, m.edit]}
        rows={query.data.data.map((t) => ({
          id: t.id,
          cells: [
            formatDate(t.tradeDate),
            m.types[t.type],
            accountName(accounts, t.accountId),
            t.quantity ? formatQuantity(t.quantity) : m.unavailable,
            <Amount key="amount" value={t.amount} signed />,
            <Link key="edit" href={`/portfel/operacje/${t.id}`}>
              {m.edit}
            </Link>,
          ],
        }))}
      />
      <PageLinks page={query.data.page} args={args} />
    </>
  );
}
export function AccountsScreen({ userId, args, initial }: Props<"accounts">) {
  const query = useResource(userId, "accounts", args, initial);
  return (
    <>
      <QueryNotice failed={query.isError} retry={query.refetch} />
      <DataTable
        caption={m.accounts}
        headings={[m.name, m.broker, m.accountType, m.currency, m.reconciliation, m.edit]}
        rows={query.data.data.map((a) => ({
          id: a.id,
          cells: [
            a.name,
            m[a.broker],
            m[a.accountType],
            a.currency,
            m[a.reconciliationStatus ?? "never_imported"],
            <Link key="edit" href={`/portfel/rachunki/${a.id}`}>
              {m.edit}
            </Link>,
          ],
        }))}
      />
    </>
  );
}
export function LotsScreen({ userId, args, initial, accounts }: Props<"lots">) {
  const query = useResource(userId, "lots", args, initial);
  return (
    <>
      <QueryNotice failed={query.isError} retry={query.refetch} />
      <p>{m.fifoHelp}</p>
      <DataTable
        caption={m.lots}
        headings={[
          m.account,
          m.instrument,
          m.acquiredOn,
          m.opened,
          m.remaining,
          m.cost,
          m.consumptions,
        ]}
        rows={query.data.data.map((lot) => ({
          id: lot.id,
          cells: [
            accountName(accounts, lot.accountId),
            instrumentLink(lot.instrumentId, lot.instrumentId),
            formatDate(lot.acquiredOn),
            formatQuantity(lot.quantityOpen),
            formatQuantity(lot.quantityRemaining),
            <Amount key="cost" value={lot.costTotal} unknownCost />,
            <Disclosure key="history" summary={m.consumptions}>
              <DataTable
                caption={m.consumptions}
                headings={[m.date, m.quantity, m.cost, m.realizedPl]}
                rows={lot.consumptions.map((c, i) => ({
                  id: `${c.closeTransactionId}:${i}`,
                  cells: [
                    formatDate(c.closedOn),
                    formatQuantity(c.quantity),
                    <Amount key="cost" value={c.costEconomic} unknownCost />,
                    <Amount key="pl" value={c.realizedPlEconomic} signed />,
                  ],
                }))}
              />
            </Disclosure>,
          ],
        }))}
      />
      <PageLinks page={query.data.page} args={args} />
    </>
  );
}
export function RealizedScreen({ userId, args, initial }: Props<"realized">) {
  const query = useResource(userId, "realized", args, initial),
    data = query.data;
  return (
    <>
      <QueryNotice failed={query.isError} retry={query.refetch} />
      <TaxDisclaimer view={data.view} />
      {!data.isComplete && (
        <p className="oi-partial">
          {m.excluded} {data.exclusions.length}
        </p>
      )}
      <DataTable
        caption={m.realized}
        headings={[m.groupBy, m.proceeds, m.cost, m.realizedPl, m.fxCosts, m.status]}
        rows={data.rows.map((r) => ({
          id: r.key,
          cells: [
            r.label,
            <Amount key="proceeds" value={r.proceeds} />,
            <Amount key="cost" value={r.cost} unknownCost />,
            <Amount key="pl" value={r.realizedPl} signed />,
            <Amount key="fx" value={r.fxCosts} />,
            m[r.status],
          ],
        }))}
      />
      <dl className="oi-kpis">
        {(["proceeds", "cost", "realizedPl", "fxCosts"] as const).map((key) => (
          <div key={key} className="oi-kpi">
            <dt>{m[key]}</dt>
            <dd>
              <Amount value={data.totals[key]} unknownCost={key === "cost"} />
            </dd>
          </div>
        ))}
      </dl>
      {data.exclusions.length > 0 && (
        <DataTable
          caption={m.reason}
          headings={[m.transactions, m.reason]}
          rows={data.exclusions.map((e) => ({
            id: e.transactionId,
            cells: [
              <Link key="tx" href={`/portfel/operacje/${e.transactionId}`}>
                {e.transactionId}
              </Link>,
              m[e.reason],
            ],
          }))}
        />
      )}
    </>
  );
}
