"use client";
import { portfolioMessages } from "@oliginvest/i18n";
import { useCopy } from "@oliginvest/ui/localization";
import { DataTable } from "@oliginvest/ui/table";
import { type ComponentProps, type ReactNode, useEffect, useState } from "react";
export function MetricTable(props: ComponentProps<typeof DataTable>) {
  const copy = useCopy("portfolioMessages", portfolioMessages);
  const [render, setRender] = useState<
    ((headings: string[], copy: typeof portfolioMessages) => Record<string, ReactNode>) | null
  >(null);
  useEffect(() => {
    void import("./metric-headings").then((module) => setRender(() => module.metricHeadings));
  }, []);
  return (
    <DataTable {...props} {...(render ? { headingContent: render(props.headings, copy) } : {})} />
  );
}
