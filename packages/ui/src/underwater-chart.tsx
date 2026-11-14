"use client";

import { useFormatters } from "@oliginvest/ui/localization";
import { useEffect, useRef, useState } from "react";
import type uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

/** Only canvas coordinates become numbers; all displayed values use decimal strings. */
export function UnderwaterChart({
  series,
  unavailable,
}: {
  series: { t: number[]; drawdown: string[] };
  unavailable: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const { formatPercent, formatDate } = useFormatters();
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false,
      chart: uPlot | undefined,
      resize: ResizeObserver | undefined,
      theme: MutationObserver | undefined;
    void import("uplot")
      .then(({ default: UPlot }) => {
        if (disposed) return;
        const draw = () => {
          chart?.destroy();
          const ink = getComputedStyle(element).color;
          chart = new UPlot(
            {
              width: Math.max(240, element.clientWidth),
              height: 280,
              scales: { x: { time: false }, y: { range: (_u, min) => [Math.min(min, -0.01), 0] } },
              cursor: { show: false },
              legend: { show: false },
              select: { show: false, left: 0, top: 0, width: 0, height: 0 },
              series: [
                {},
                {
                  stroke: ink,
                  fill: ink.replace("rgb(", "rgba(").replace(")", ", 0.15)"),
                  width: 2,
                  points: { show: false },
                },
              ],
              axes: [
                {
                  stroke: ink,
                  grid: { show: false },
                  space: 100,
                  values: (_u, values) =>
                    values.map((v) => formatDate(new Date(v * 1000).toISOString().slice(0, 10))),
                },
                {
                  stroke: ink,
                  size: 85,
                  grid: { show: false },
                  values: (_u, values) => values.map((v) => formatPercent(String(v))),
                },
              ],
            },
            [series.t, series.drawdown.map(Number)],
            element,
          );
        };
        draw();
        resize = new ResizeObserver(() =>
          chart?.setSize({ width: Math.max(240, element.clientWidth), height: 280 }),
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
  }, [series, formatDate, formatPercent]);
  return (
    <>
      <div ref={host} aria-hidden="true" />
      {failed && <p role="status">{unavailable}</p>}
    </>
  );
}
