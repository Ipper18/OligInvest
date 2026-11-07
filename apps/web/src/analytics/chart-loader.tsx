"use client";
import { analyticsMessages as m } from "@oliginvest/i18n/analytics";
import type { PercentileSeries } from "@oliginvest/ui/percentile-chart";
import { type ComponentType, useEffect, useRef, useState } from "react";
import styles from "./screens.module.css";

export function ChartLoader({ series }: { series: PercentileSeries }) {
  const host = useRef<HTMLDivElement>(null);
  const [Chart, setChart] = useState<ComponentType<{ series: PercentileSeries }> | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void import("@oliginvest/ui/percentile-chart")
        .then((module) => {
          if (alive) setChart(() => module.PercentileChart);
        })
        .catch(() => {
          if (alive) setFailed(true);
        });
    });
    if (host.current) observer.observe(host.current);
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, []);
  return (
    <figure>
      <div ref={host} className={styles.fan} data-analysis-chart>
        {Chart && <Chart series={series} />}
      </div>
      <figcaption>{m.chartLegend}</figcaption>
      {failed && <p role="status">{m.chartUnavailable}</p>}
    </figure>
  );
}
