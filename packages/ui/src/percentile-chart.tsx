"use client";

import { analyticsMessages as defaultM } from "@oliginvest/i18n/analytics";
import { useCopy, useFormatters } from "@oliginvest/ui/localization";
import { useEffect, useRef, useState } from "react";
import type uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

export type PercentileSeries = {
  months: number[];
  p5: number[];
  p25: number[];
  p50: number[];
  p75: number[];
  p95: number[];
};
/** Display only: the worker computes percentiles. No money arithmetic in the browser. */
export function PercentileChart({ series }: { series: PercentileSeries }) {
  const { formatMoney } = useFormatters();

  const m = useCopy("analyticsMessages", defaultM);

  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;
    let chart: uPlot | undefined;
    let resize: ResizeObserver | undefined;
    let theme: MutationObserver | undefined;
    void import("uplot")
      .then(({ default: UPlot }) => {
        if (disposed) return;
        const draw = () => {
          chart?.destroy();
          const ink = getComputedStyle(element).color;
          const fill = (alpha: number) => ink.replace("rgb(", "rgba(").replace(")", `, ${alpha})`);
          chart = new UPlot(
            {
              width: Math.max(240, element.clientWidth),
              height: 300,
              scales: { x: { time: false } },
              cursor: { show: false },
              select: { show: false, left: 0, top: 0, width: 0, height: 0 },
              legend: { show: false },
              series: [
                { label: m.month },
                ...[m.p5, m.p25, m.p50, m.p75, m.p95].map((label, index) => ({
                  label,
                  stroke: ink,
                  width: index === 2 ? 2 : 1,
                  dash: index === 2 ? [] : [3, 3],
                  points: { show: false },
                })),
              ],
              bands: [
                { series: [5, 1], fill: fill(0.12) },
                { series: [4, 2], fill: fill(0.2) },
              ],
              axes: [
                { stroke: ink, grid: { show: false }, values: (_u, values) => values.map(String) },
                {
                  stroke: ink,
                  size: 85,
                  grid: { stroke: fill(0.1) },
                  values: (_u, values) => values.map((v) => formatMoney(String(v), "PLN")),
                },
              ],
            },
            [series.months, series.p5, series.p25, series.p50, series.p75, series.p95],
            element,
          );
        };
        draw();
        resize = new ResizeObserver(() =>
          chart?.setSize({ width: Math.max(240, element.clientWidth), height: 300 }),
        );
        resize.observe(element);
        theme = new MutationObserver(draw);
        theme.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["class", "data-theme", "data-palette"],
        });
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      resize?.disconnect();
      theme?.disconnect();
      chart?.destroy();
    };
  }, [series, m.p75, m.p25, m.p95, m.p50, m.p5, m.month, formatMoney]);
  return (
    <>
      <div ref={host} aria-hidden="true" />
      {failed && <p role="status">{m.chartUnavailable}</p>}
    </>
  );
}
