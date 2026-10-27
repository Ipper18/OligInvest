import { portfolioMessages as m } from "@oliginvest/i18n";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { SummaryView } from "../src/portfolio/summary-view.tsx";

const money = (amount) => ({ amount, currency: "PLN" });
const meta = (staleReason) => ({
  source: "gpw",
  asOf: "2026-10-23T15:05:00Z",
  delayMinutes: 0,
  stale: true,
  staleReason,
});
const render = (dayChange, staleReason) =>
  renderToStaticMarkup(
    createElement(SummaryView, {
      data: {
        totalValue: money("1000"),
        marketValue: money("900"),
        cash: money("100"),
        unrealizedPl: money("50"),
        dayChange,
        dayChangeRatio: null,
        view: "economic",
        isComplete: true,
        exclusions: { count: 0, positions: [] },
        meta: meta("eod_only"),
        accounts: [],
      },
      day: {
        change: dayChange,
        changeRatio: null,
        previousValue: money("1000"),
        currentValue: money("1000"),
        flowsToday: money("0"),
        residualChange: null,
        positions: [],
        meta: meta(staleReason),
      },
      Table: () => null,
    }),
  );

test("day result without a session since the previous close is explained, never 0,00 zł", () => {
  // Regression (demo 2026-10-26): a weekend showed 0,00 zł as the day result.
  const kpi = render(null, "market_closed").match(/data-onboarding="dayChange".*?<\/dd>/u)?.[0];
  expect(kpi).toContain(m.unavailable);
  expect(kpi).toContain(m.dayNoSession);
  expect(kpi).not.toMatch(/\d,\d{2}/u);
  expect(render(null, "no_data")).not.toContain(m.dayNoSession);
});
