"use client";
import { DataTable } from "@oliginvest/ui/table";
import { type ComponentProps, type ReactNode, useEffect, useState } from "react";
export function MetricTable(props: ComponentProps<typeof DataTable>) {
  const [render, setRender] = useState<((headings: string[]) => Record<string, ReactNode>) | null>(
    null,
  );
  useEffect(() => {
    void import("./metric-headings").then((module) => setRender(() => module.metricHeadings));
  }, []);
  return <DataTable {...props} {...(render ? { headingContent: render(props.headings) } : {})} />;
}
