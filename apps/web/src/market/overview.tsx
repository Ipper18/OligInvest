"use client";
import {
  formatDate,
  formatDateTime,
  marketMessages as m,
  portfolioMessages as p,
} from "@oliginvest/i18n";
import { Disclaimer } from "@oliginvest/ui";
import { DataTable } from "@oliginvest/ui/table";
import Link from "next/link";
import { Amount, Freshness, ratio } from "../portfolio/presentation";
import { QueryNotice, useResource } from "../portfolio/query";
import type { Resource } from "../portfolio/resources";

export function MarketOverview({
  userId,
  benchmarks,
  initialQuotes,
  initialStatus,
}: {
  userId: string;
  benchmarks: Resource<"benchmarks">["data"];
  initialQuotes: Resource<"quotes">;
  initialStatus: Resource<"marketStatus">;
}) {
  const quotes = useResource(
    userId,
    "quotes",
    { instrumentIds: benchmarks.map((b) => b.instrumentId) },
    initialQuotes,
  );
  const status = useResource(userId, "marketStatus", {}, initialStatus);
  return (
    <>
      <QueryNotice
        failed={quotes.isError || status.isError}
        retry={() => Promise.all([quotes.refetch(), status.refetch()])}
      />
      <DataTable
        caption={m.benchmarks}
        headings={[p.instrument, p.type, p.price, p.dayChange, m.historyFrom, p.status]}
        rows={benchmarks.map((benchmark) => {
          const quote = quotes.data.data.find(
            (item) => item.instrumentId === benchmark.instrumentId,
          );
          return {
            id: benchmark.code,
            cells: [
              <Link key="instrument" prefetch={false} href={`/rynek/${benchmark.instrumentId}`}>
                {benchmark.name}
              </Link>,
              <span key="kind">
                {m[benchmark.kind]} {benchmark.proxyFor}
              </span>,
              quote ? (
                <Amount key="price" value={{ amount: quote.price, currency: quote.currency }} />
              ) : (
                m.noQuote
              ),
              ratio(quote?.changeRatio),
              benchmark.dataAvailableFrom ? formatDate(benchmark.dataAvailableFrom) : p.unavailable,
              quote ? <Freshness key="freshness" meta={quote.meta} /> : m.noQuote,
            ],
          };
        })}
      />
      <DataTable
        caption={m.providers}
        headings={[m.source, p.status, m.lastSuccess]}
        rows={status.data.categories.map((category) => ({
          id: category.key,
          cells: [
            category.key,
            m[category.status],
            category.lastSuccessAt ? formatDateTime(category.lastSuccessAt) : p.unavailable,
          ],
        }))}
      />
      <Disclaimer disclaimerKey="data_delay" version="2026-09" />
    </>
  );
}
