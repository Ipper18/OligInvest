import { type CurrencyCode, appMessages as defaultM, formatMessage } from "@oliginvest/i18n";
import { useCopy, useFormatters } from "@oliginvest/ui/localization";
import type { ReactNode } from "react";

type ValueProps = {
  value: string | null | undefined;
  currency?: CurrencyCode;
  stale?: boolean | undefined;
};
export function MoneyValue({ value, currency = "PLN", stale }: ValueProps) {
  const { formatMoney } = useFormatters();

  return <span className="num">{value == null || stale ? "—" : formatMoney(value, currency)}</span>;
}
export function ChangeValue({ value, currency, stale }: ValueProps) {
  const { formatMoney, formatPercent } = useFormatters();

  const m = useCopy("appMessages", defaultM);

  if (value == null || stale) return <span className="num oi-flat">—</span>;
  const nonzero = /[1-9]/.test(value);
  const negative = nonzero && value.startsWith("-");
  const direction = nonzero ? (negative ? "loss" : "gain") : "flat";
  const text = currency
    ? formatMoney(value, currency, { signed: true })
    : formatPercent(value, { signed: true });
  return (
    <span className={`oi-change num oi-${direction}`}>
      <span className="oi-sr">
        {formatMessage(nonzero ? (negative ? m.decrease : m.increase) : m.unchanged, {
          value: text,
        })}
      </span>
      <span aria-hidden="true">
        {nonzero && (negative ? "▼ " : "▲ ")}
        {text}
      </span>
    </span>
  );
}
export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`oi-panel ${className}`}>{children}</section>;
}
export function StatTile({
  label,
  value,
  explainer,
  change,
  marker,
  hero = false,
}: {
  label: string;
  value: ReactNode;
  explainer?: ReactNode;
  change?: ReactNode;
  marker?: string;
  hero?: boolean;
}) {
  return (
    <div className={`oi-kpi${hero ? " oi-kpi-hero" : ""}`} data-onboarding={marker}>
      <dt className="label">
        {label}
        {explainer}
      </dt>
      <dd className="num">{value}</dd>
      {change && <dd>{change}</dd>}
    </div>
  );
}
export function AllocationBar({ items }: { items: readonly { label: string; weight: number }[] }) {
  const { formatPercent } = useFormatters();

  if (
    items.length > 8 ||
    items.some((item) => !Number.isFinite(item.weight) || item.weight < 0 || item.weight > 1)
  )
    throw new RangeError("AllocationBar requires at most eight nonnegative shares");
  return (
    <div className="oi-allocation">
      <svg
        className="oi-allocation-bar"
        viewBox="0 0 100 1"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        {items.map((item, i) => (
          <rect
            key={item.label}
            x={items.slice(0, i).reduce((sum, part) => sum + part.weight * 100, 0)}
            y="0"
            width={item.weight * 100}
            height="1"
            fill={`var(--color-category-${i + 1})`}
          />
        ))}
      </svg>
      <ul className="oi-allocation-labels">
        {items.map((item) => (
          <li key={item.label}>
            {item.label} <span className="num">{formatPercent(String(item.weight))}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
export function RangeBar({
  low,
  high,
  value,
  currency,
  stale,
}: {
  low: string | null | undefined;
  high: string | null | undefined;
  value: string | null | undefined;
  currency: CurrencyCode;
  stale?: boolean | undefined;
}) {
  const { formatPercent } = useFormatters();

  const m = useCopy("appMessages", defaultM);

  // Like canvas charts, numbers are used only for graphical coordinates. Money stays as strings.
  const min = Number(low),
    max = Number(high),
    current = Number(value);
  const valid =
    !stale &&
    low != null &&
    high != null &&
    value != null &&
    [min, max, current].every(Number.isFinite) &&
    max > min;
  const position = valid ? Math.max(0, Math.min(1, (current - min) / (max - min))) : null;
  return (
    <div className="oi-range">
      {position == null ? (
        <p className="oi-help">{m.emptyRange}</p>
      ) : (
        <>
          <svg
            className="oi-range-track"
            viewBox="0 0 100 12"
            preserveAspectRatio="none"
            aria-hidden="true"
            focusable="false"
          >
            <line x1="0" x2="100" y1="6" y2="6" className="oi-range-line" />
            <line
              x1={position * 100}
              x2={position * 100}
              y1="0"
              y2="12"
              className="oi-range-marker"
            />
          </svg>
          <p>{formatMessage(m.rangePosition, { value: formatPercent(String(position)) })}</p>
        </>
      )}
      <div className="oi-range-labels">
        <MoneyValue value={low} currency={currency} stale={stale} />
        <MoneyValue value={high} currency={currency} stale={stale} />
      </div>
    </div>
  );
}
