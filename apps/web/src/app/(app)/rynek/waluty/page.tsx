import {
  formatDate,
  formatQuantity,
  marketMessages as m,
  portfolioMessages as p,
} from "@oliginvest/i18n";
import { DataFreshness } from "@oliginvest/ui";
import { DataTable } from "@oliginvest/ui/table";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireMe } from "../../../../auth/session";
import { MarketNav } from "../../../../market/navigation";
import type { SearchParams } from "../../../../portfolio/page";
import { Freshness } from "../../../../portfolio/presentation";
import { fetchResource } from "../../../../portfolio/resources";

const filters = z
  .object({
    currency: z.enum(["USD", "EUR"]).default("USD"),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.from <= v.to);

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  await requireMe();
  const parsed = filters.safeParse(
    Object.fromEntries(Object.entries(await searchParams).filter(([, value]) => value !== "")),
  );
  if (!parsed.success) notFound();
  const args = parsed.data;
  const result = await fetchResource("fx", { ...args, currency: [args.currency] });
  return (
    <section>
      <h1>{m.fx}</h1>
      <MarketNav />
      <form className="oi-filters" method="get">
        <label htmlFor="fx-currency">{m.currency}</label>
        <select id="fx-currency" name="currency" defaultValue={args.currency}>
          {(["USD", "EUR"] as const).map((currency) => (
            <option key={currency}>{currency}</option>
          ))}
        </select>
        <label>
          {m.from}
          <input name="from" type="date" defaultValue={args.from} />
        </label>
        <label>
          {m.to}
          <input name="to" type="date" defaultValue={args.to} />
        </label>
        <button className="oi-button" type="submit">
          {m.show}
        </button>
      </form>
      {result.meta.source === "nbp" ? (
        <DataFreshness
          kind="fx"
          sessionDate={result.meta.asOf.slice(0, 10)}
          meta={{ ...result.meta, source: "nbp" }}
        />
      ) : (
        <>
          <p>{m.fallback}</p>
          <Freshness meta={result.meta} />
        </>
      )}
      <DataTable
        caption={m.fxHistory}
        headings={[m.date, m.currency, m.rate, m.tableNo]}
        rows={result.series.flatMap((series) =>
          series.items.map((item) => ({
            id: `${series.currency}-${item.date}`,
            cells: [
              formatDate(item.date),
              series.currency,
              `${formatQuantity(item.rate)} PLN`,
              item.tableNo ?? p.unavailable,
            ],
          })),
        )}
      />
    </section>
  );
}
