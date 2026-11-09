import { type CurrencyCode, portfolioMessages as defaultM } from "@oliginvest/i18n";
import { ChangeValue, DataFreshness, type DataMeta, Disclaimer, MoneyValue } from "@oliginvest/ui";
import { useCopy, useFormatters } from "@oliginvest/ui/localization";
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
  const m = useCopy("portfolioMessages", defaultM);

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
export function useRatio() {
  const { formatPercent } = useFormatters();
  return (value: number | null | undefined) => (value == null ? "—" : formatPercent(String(value)));
}
export function Freshness({ meta }: { meta: DataMeta }) {
  return meta.delayMinutes === 0 && meta.staleReason === "eod_only" ? (
    <DataFreshness kind="eod" sessionDate={meta.asOf.slice(0, 10)} meta={meta} />
  ) : (
    <DataFreshness kind="delayed" meta={meta} />
  );
}
export function TaxDisclaimer({
  view,
  costBasisContext,
}: {
  view?: string;
  costBasisContext?: { method: "fifo" | "average"; analytical: boolean } | undefined;
}) {
  const m = useCopy("portfolioMessages", defaultM);
  return view === "tax" ? (
    <Disclaimer disclaimerKey="tax_view" version="2026-09" />
  ) : costBasisContext?.analytical ? (
    <p className="oi-help">{m.analyticalCost}</p>
  ) : null;
}
