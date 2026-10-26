"use client";
import {
  formatDate,
  formatQuantity,
  portfolioMessages as m,
  marketMessages,
} from "@oliginvest/i18n";
import { Button, Disclaimer, SelectField } from "@oliginvest/ui";
import { CandlestickChart } from "@oliginvest/ui/chart";
import { DataTable } from "@oliginvest/ui/table";
import { type ComponentType, useState } from "react";
import { Explainer } from "../education/explainer";
import type { IndicatorControls } from "../market/indicator-controls";
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
  const [Controls, setControls] = useState<ComponentType<
    Parameters<typeof IndicatorControls>[0]
  > | null>(null);
  const [indicators, setIndicators] = useState<Resource<"indicators"> | null>(null);
  const [controlsFailed, setControlsFailed] = useState(false);
  const loadControls = async () => {
    setControlsFailed(false);
    try {
      const module = await import("../market/indicator-controls");
      setControls(() => module.IndicatorControls);
    } catch {
      setControlsFailed(true);
    }
  };
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
          <dt>
            {m.price}
            <Explainer termKey="cena" term={m.price} />
          </dt>
          <dd>{price(quote?.price)}</dd>
        </div>
        <div>
          <dt>
            {m.dayChange}
            <Explainer termKey="zmiana-kursu" term={m.dayChange} />
          </dt>
          <dd>
            {price(quote?.change)} ({ratio(quote?.changeRatio)})
          </dd>
        </div>
        <div>
          <dt>
            {m.volume}
            <Explainer termKey="wolumen" term={m.volume} />
          </dt>
          <dd>{quote?.volume == null ? m.unavailable : formatQuantity(quote.volume)}</dd>
        </div>
        <div>
          <dt>
            {m.range52w}
            <Explainer termKey="zakres-52-tygodni" term={m.range52w} />
          </dt>
          <dd>
            {price(data.range52w?.low)} – {price(data.range52w?.high)}
          </dd>
        </div>
        <div>
          <dt>
            {m.currency}
            <Explainer termKey="waluta" term={m.currency} />
          </dt>
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
      <Button onClick={() => void loadControls()}>{marketMessages.showIndicators}</Button>
      {controlsFailed && <p role="alert">{m.failed}</p>}
      {Controls && <Controls key={JSON.stringify(args)} args={args} onChange={setIndicators} />}
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
        <CandlestickChart series={series} indicators={indicators} />
      )}
      {indicators && (
        <>
          <p>{marketMessages.warmup}</p>
          {table && (
            <DataTable
              caption={marketMessages.indicators}
              headings={[
                m.date,
                ...indicators.indicators.flatMap((item) =>
                  Object.keys(item.outputs).map((key) => `${item.spec} ${key}`),
                ),
              ]}
              rows={indicators.t.map((time, i) => ({
                id: String(time),
                cells: [
                  formatDate(new Date(time * 1000).toISOString().slice(0, 10)),
                  ...indicators.indicators.flatMap((item) =>
                    Object.values(item.outputs).map((values) =>
                      values[i] == null ? m.unavailable : formatQuantity(String(values[i])),
                    ),
                  ),
                ],
              }))}
            />
          )}
          <Freshness meta={indicators.meta} />
        </>
      )}
      {series.decimated && <p>{m.decimated}</p>}
      <Freshness meta={series.meta} />
      <Disclaimer disclaimerKey="data_delay" version="2026-09" />
    </>
  );
}
