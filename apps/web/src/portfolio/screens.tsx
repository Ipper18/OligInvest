"use client";
import { formatDate, formatQuantity, portfolioMessages as m } from "@oliginvest/i18n";
import { Disclosure } from "@oliginvest/ui";
import { DataTable } from "@oliginvest/ui/table";
import Link from "next/link";
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
export function PositionsScreen({
  userId,
  args,
  initial,
  accounts,
  initialCash,
}: Props<"positions"> & { initialCash: Resource<"cash"> }) {
  const query = useResource(userId, "positions", args, initial),
    data = query.data;
  const cash = useResource(
    userId,
    "cash",
    args.accountId ? { accountId: args.accountId } : {},
    initialCash,
  );
  return (
    <>
      <QueryNotice
        failed={query.isError || cash.isError}
        retry={() => {
          void cash.refetch();
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
      <Freshness meta={data.meta} />
      <DataTable
        caption={m.positions}
        headings={[
          m.instrument,
          m.account,
          m.quantity,
          m.averageCost,
          m.costBasis,
          m.marketValue,
          m.valueBase,
          m.weight,
          m.unrealizedPl,
          m.localPl,
          m.priceEffect,
          m.fxEffect,
        ]}
        rows={data.data.map((p) => ({
          id: `${p.accountId ?? "all"}:${p.instrument.id}`,
          cells: [
            instrumentLink(p.instrument.id, p.instrument.ticker),
            accountName(accounts, p.accountId),
            formatQuantity(p.quantity),
            <Amount key="average" value={p.averageCost} />,
            <Amount key="cost" value={p.costBasis} />,
            <Amount key="market" value={p.marketValue} />,
            <Amount key="value" value={p.marketValueBase} />,
            ratio(p.weight),
            <span key="pl">
              <Amount value={p.unrealizedPl} signed /> {ratio(p.unrealizedPlRatio)}
            </span>,
            <Amount key="local" value={p.unrealizedPlInstrumentCurrency} signed />,
            <Amount key="price" value={p.priceEffect} signed />,
            <Amount key="fx" value={p.fxEffect} signed />,
          ],
        }))}
      />
      <dl className="oi-kpis">
        {(["marketValueBase", "costBasis", "unrealizedPl"] as const).map((key) => (
          <div key={key} className="oi-kpi">
            <dt>{key === "marketValueBase" ? m.valueBase : m[key]}</dt>
            <dd>
              <Amount value={data.totals[key]} />
            </dd>
          </div>
        ))}
      </dl>
      <p>{m.fifoHelp}</p>
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
      <Link className="oi-button" href="/portfel/operacje/nowa">
        {m.newTransaction}
      </Link>
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
      <Link className="oi-button" href="/portfel/rachunki/nowy">
        {m.newAccount}
      </Link>
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
            <Amount key="cost" value={lot.costTotal} />,
            <Disclosure key="history" summary={m.consumptions}>
              <DataTable
                caption={m.consumptions}
                headings={[m.date, m.quantity, m.cost, m.realizedPl]}
                rows={lot.consumptions.map((c, i) => ({
                  id: `${c.closeTransactionId}:${i}`,
                  cells: [
                    formatDate(c.closedOn),
                    formatQuantity(c.quantity),
                    <Amount key="cost" value={c.costEconomic} />,
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
            <Amount key="cost" value={r.cost} />,
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
              <Amount value={data.totals[key]} />
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
