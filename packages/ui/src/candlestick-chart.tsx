"use client";
import { formatDate, formatQuantity, portfolioMessages as m } from "@oliginvest/i18n";
import type { IChartApi, UTCTimestamp } from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import { Button } from "./native-controls.js";

export type CandleSeries = {
  t: number[];
  o: (string | null)[];
  h: (string | null)[];
  l: (string | null)[];
  c: (string | null)[];
  v: (string | null)[];
};
export type ChartIndicators = {
  t: number[];
  indicators: {
    spec: string;
    kind: "overlay" | "panel";
    outputs: Record<string, (number | null)[]>;
  }[];
};
export function CandlestickChart({
  series,
  indicators,
}: {
  series: CandleSeries;
  indicators?: ChartIndicators | null;
}) {
  const host = useRef<HTMLDivElement>(null),
    chart = useRef<IChartApi | null>(null);
  const [selected, setSelected] = useState(0),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;
    setFailed(false);
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      observer.disconnect();
      void import("lightweight-charts")
        .then(({ createChart, CandlestickSeries, HistogramSeries, LineSeries, ColorType }) => {
          if (disposed) return;
          const instance = createChart(element, {
            autoSize: true,
            layout: {
              background: { type: ColorType.Solid, color: "transparent" },
              attributionLogo: true,
            },
            timeScale: { timeVisible: false },
            localization: { locale: "pl-PL" },
          });
          chart.current = instance;
          const candles = instance.addSeries(CandlestickSeries);
          const volume = instance.addSeries(
            HistogramSeries,
            { priceFormat: { type: "volume" } },
            1,
          );
          instance.panes()[1]?.setHeight(80);
          let panel = 2;
          const lines = (indicators?.indicators ?? []).flatMap((indicator) => {
            const pane = indicator.kind === "overlay" ? 0 : panel++;
            return Object.entries(indicator.outputs).map(([name, values], index) => {
              const line = instance.addSeries(
                LineSeries,
                {
                  title: `${indicator.spec} ${name}`,
                  lineWidth: 2,
                  lineStyle: index % 3,
                  priceLineVisible: false,
                },
                pane,
              );
              line.setData(
                (indicators?.t ?? []).map((time, i) =>
                  values[i] == null
                    ? { time: time as UTCTimestamp }
                    : { time: time as UTCTimestamp, value: values[i] as number },
                ),
              );
              if (pane > 1) instance.panes()[pane]?.setHeight(120);
              return line;
            });
          });
          const applyTheme = () => {
            const css = getComputedStyle(element),
              token = (name: string) => css.getPropertyValue(name).trim();
            instance.applyOptions({
              layout: { textColor: token("--color-ink") },
              grid: {
                vertLines: { color: token("--color-hairline") },
                horzLines: { color: token("--color-hairline") },
              },
            });
            candles.applyOptions({
              upColor: token("--color-gain"),
              downColor: token("--color-loss"),
              wickUpColor: token("--color-gain"),
              wickDownColor: token("--color-loss"),
              borderVisible: false,
            });
            volume.applyOptions({ color: token("--color-accent") });
            lines.forEach((line, index) => {
              line.applyOptions({ color: token(index % 2 ? "--color-warning" : "--color-accent") });
            });
          };
          applyTheme();
          // Decimal strings become numbers only at the canvas boundary; never reused in totals.
          candles.setData(
            series.t.map((t, i) => {
              const time = t as UTCTimestamp;
              return [series.o[i], series.h[i], series.l[i], series.c[i]].some((v) => v == null)
                ? { time }
                : {
                    time,
                    open: Number(series.o[i]),
                    high: Number(series.h[i]),
                    low: Number(series.l[i]),
                    close: Number(series.c[i]),
                  };
            }),
          );
          volume.setData(
            series.t.map((t, i) =>
              series.v[i] == null
                ? { time: t as UTCTimestamp }
                : { time: t as UTCTimestamp, value: Number(series.v[i]) },
            ),
          );
          instance.timeScale().fitContent();
          const theme = new MutationObserver(applyTheme);
          theme.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["data-theme", "data-palette", "class"],
          });
          const media = matchMedia("(prefers-color-scheme: dark)");
          media.addEventListener("change", applyTheme);
          cleanup = () => {
            theme.disconnect();
            media.removeEventListener("change", applyTheme);
            instance.remove();
            chart.current = null;
          };
        })
        .catch(() => {
          if (!disposed) setFailed(true);
        });
    });
    let cleanup = () => {};
    observer.observe(element);
    return () => {
      disposed = true;
      observer.disconnect();
      cleanup();
    };
  }, [series, indicators]);
  function zoom(factor: number) {
    const scale = chart.current?.timeScale(),
      range = scale?.getVisibleLogicalRange();
    if (range) {
      const middle = (range.from + range.to) / 2,
        half = ((range.to - range.from) * factor) / 2;
      scale?.setVisibleLogicalRange({ from: middle - half, to: middle + half });
    }
  }
  const index = Math.min(selected, Math.max(0, series.t.length - 1));
  return (
    <section aria-label={m.chart}>
      <p>{m.chartHelp}</p>
      <div className="oi-toolbar">
        <Button onClick={() => zoom(0.8)}>{m.zoomIn}</Button>
        <Button onClick={() => zoom(1.25)}>{m.zoomOut}</Button>
        <Button onClick={() => chart.current?.timeScale().fitContent()}>{m.fit}</Button>
      </div>
      <div ref={host} className="oi-candlestick" />
      {failed && <p role="alert">{m.failed}</p>}
      <label>
        {m.date}
        <input
          type="range"
          min={0}
          max={Math.max(0, series.t.length - 1)}
          value={index}
          onChange={(e) => setSelected(Number(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "+" || e.key === "-") {
              e.preventDefault();
              zoom(e.key === "+" ? 0.8 : 1.25);
            }
          }}
        />
      </label>
      <p aria-live="polite">
        {series.t[index] === undefined
          ? m.empty
          : `${formatDate(new Date(series.t[index] * 1000).toISOString().slice(0, 10))} · ${m.closePrice}: ${series.c[index] == null ? m.unavailable : formatQuantity(series.c[index])}`}
      </p>
      <a href="https://www.tradingview.com/" rel="noreferrer" target="_blank">
        {m.tradingView}
      </a>
    </section>
  );
}
