import { type CurrencyCode, formatPercent, portfolioMessages as m } from "@oliginvest/i18n";
import { ChangeValue, DataFreshness, type DataMeta, Disclaimer, MoneyValue } from "@oliginvest/ui";
export function Amount({
  value,
  signed = false,
  unknownCost = false,
  stale = false,
}: {
  value: { amount: string; currency: string } | null | undefined;
  signed?: boolean;
  unknownCost?: boolean;
  stale?: boolean;
}) {
  if (stale) return <span className="num oi-flat">{m.unavailable}</span>;
  if (!value)
    return <span className="num oi-flat">{unknownCost ? m.unknownCost : m.unavailable}</span>;
  if (!["PLN", "USD", "EUR"].includes(value.currency))
    return (
      <span className="num">
        {value.amount} {value.currency}
      </span>
    );
  return signed ? (
    <ChangeValue value={value.amount} currency={value.currency as CurrencyCode} />
  ) : (
    <MoneyValue value={value.amount} currency={value.currency as CurrencyCode} />
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
