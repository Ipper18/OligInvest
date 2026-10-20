import {
  type CurrencyCode,
  formatMoney,
  formatPercent,
  portfolioMessages as m,
} from "@oliginvest/i18n";
import { DataFreshness, type DataMeta, Disclaimer } from "@oliginvest/ui";
import Link from "next/link";
import type { Resource } from "./resources";
export function Amount({
  value,
  signed = false,
  unknownCost = false,
}: {
  value: { amount: string; currency: string } | null | undefined;
  signed?: boolean;
  unknownCost?: boolean;
}) {
  if (!value) return <span>{unknownCost ? m.unknownCost : m.unavailable}</span>;
  const supported = ["PLN", "USD", "EUR"].includes(value.currency);
  const nonzero = /[1-9]/.test(value.amount);
  return (
    <span
      className={
        signed && nonzero ? (value.amount.startsWith("-") ? "oi-loss" : "oi-gain") : undefined
      }
    >
      {supported
        ? formatMoney(value.amount, value.currency as CurrencyCode, { signed })
        : `${value.amount} ${value.currency}`}
    </span>
  );
}
export const ratio = (value: number | null | undefined) =>
  value == null ? m.unavailable : formatPercent(String(value));
export function Freshness({ meta }: { meta: DataMeta }) {
  return meta.delayMinutes === 0 && meta.staleReason === "eod_only" ? (
    <DataFreshness kind="eod" sessionDate={meta.asOf.slice(0, 10)} meta={meta} />
  ) : (
    <DataFreshness kind="delayed" meta={meta} />
  );
}
export function TaxDisclaimer({ view }: { view?: string }) {
  return view === "tax" ? <Disclaimer disclaimerKey="tax_view" version="2026-09" /> : null;
}
export function PortfolioNav() {
  return (
    <nav className="oi-section-nav" aria-label={m.positions}>
      {(
        [
          ["positions", ""],
          ["transactions", "/operacje"],
          ["imports", "/import"],
          ["accounts", "/rachunki"],
          ["lots", "/partie"],
          ["realized", "/wyniki"],
        ] as const
      ).map(([key, suffix]) => (
        <Link prefetch={false} key={key} href={`/portfel${suffix}`}>
          {m[key]}
        </Link>
      ))}
    </nav>
  );
}
export function PortfolioFilters({
  accounts,
  args,
  view = false,
  children,
}: {
  accounts: Resource<"accounts">["data"];
  args: { accountId?: string | undefined; view?: string | undefined };
  view?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <form className="oi-filters" method="get">
      <label>
        {m.account}
        <select name="accountId" defaultValue={args.accountId ?? ""}>
          <option value="">{m.allAccounts}</option>
          {accounts.map((account) => (
            <option value={account.id} key={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </label>
      {view && (
        <label>
          {m.view}
          <select name="view" defaultValue={args.view ?? "economic"}>
            <option value="economic">{m.economic}</option>
            <option value="tax">{m.tax}</option>
          </select>
        </label>
      )}
      {children}
      <button type="submit" className="oi-button">
        {m.apply}
      </button>
    </form>
  );
}
