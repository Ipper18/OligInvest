"use client";
import { formatDate, formatQuantity, portfolioMessages as m } from "@oliginvest/i18n";
import { Button, SelectField } from "@oliginvest/ui";
import { CandlestickChart } from "@oliginvest/ui/chart";
import { DataTable } from "@oliginvest/ui/table";
import { useState } from "react";
import { Amount, Freshness, ratio } from "./presentation";
import { QueryNotice, useResource } from "./query";
import type { ReadArgs, Resource } from "./resources";

export function InstrumentScreen({
  userId,
  initial,
  initialChart,
  args,
}: {
  userId: string;
  initial: Resource<"instrument">;
  initialChart: Resource<"chart">;
  args: ReadArgs;
}) {
  const instrument = useResource(userId, "instrument", { id: initial.id }, initial);
  const chart = useResource(userId, "chart", args, initialChart);
  const [table, setTable] = useState(false);
  const data = instrument.data,
    quote = data.quote,
    series = chart.data;
  const price = (amount?: string | null) => (
    <Amount value={amount == null ? null : { amount, currency: data.currency }} />
  );
  return (
    <>
      <h1>
        {data.ticker} — {data.name}
      </h1>
      <QueryNotice
        failed={instrument.isError || chart.isError}
        retry={() => {
          void instrument.refetch();
          return chart.refetch();
        }}
      />
      <dl className="oi-summary">
        <div>
          <dt>{m.price}</dt>
          <dd>{price(quote?.price)}</dd>
        </div>
        <div>
          <dt>{m.dayChange}</dt>
          <dd>
            {price(quote?.change)} ({ratio(quote?.changeRatio)})
          </dd>
        </div>
        <div>
          <dt>{m.volume}</dt>
          <dd>{quote?.volume == null ? m.unavailable : formatQuantity(quote.volume)}</dd>
        </div>
        <div>
          <dt>{m.range52w}</dt>
          <dd>
            {price(data.range52w?.low)} – {price(data.range52w?.high)}
          </dd>
        </div>
        <div>
          <dt>{m.currency}</dt>
          <dd>{data.currency}</dd>
        </div>
      </dl>
      {quote ? <Freshness meta={quote.meta} /> : <p>{m.unavailable}</p>}
      <form method="get" className="oi-filters">
        <SelectField
          id="chart-interval"
          name="interval"
          label={m.interval}
          defaultValue={args.interval ?? "1d"}
        >
          {(["1d", "1w", "1mo"] as const).map((i) => (
            <option key={i} value={i}>
              {m[i]}
            </option>
          ))}
        </SelectField>
        <Button type="submit">{m.apply}</Button>
      </form>
      <Button aria-pressed={table} onClick={() => setTable(!table)}>
        {table ? m.canvas : m.table}
      </Button>
      {table ? (
        <DataTable
          caption={m.chart}
          headings={[m.date, m.openPrice, m.highPrice, m.lowPrice, m.closePrice, m.volume]}
          rows={series.t.map((t, i) => ({
            id: String(t),
            cells: [
              formatDate(new Date(t * 1000).toISOString().slice(0, 10)),
              ...[series.o[i], series.h[i], series.l[i], series.c[i], series.v[i]].map((v) =>
                v == null ? m.unavailable : formatQuantity(v),
              ),
            ],
          }))}
        />
      ) : (
        <CandlestickChart series={series} />
      )}
      {series.decimated && <p>{m.decimated}</p>}
      <Freshness meta={series.meta} />
    </>
  );
}
