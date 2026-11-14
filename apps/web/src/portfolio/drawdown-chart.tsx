"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

const Chart = dynamic(
  () => import("@oliginvest/ui/percentile-chart").then((m) => m.UnderwaterChart),
  { ssr: false },
);

export function DrawdownChart({
  series,
  label,
  unavailable,
}: {
  series: { t: number[]; drawdown: string[] };
  label: string;
  unavailable: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <details
      onToggle={(event) => {
        if (event.currentTarget.open) setVisible(true);
      }}
    >
      <summary>{label}</summary>
      {visible && <Chart series={series} unavailable={unavailable} />}
    </details>
  );
}
