import { QueryClient } from "@tanstack/react-query";
import { expect, test } from "vitest";
import { updateImportCache, updatePortfolioCache } from "../src/portfolio/stream-cache.ts";

test("stream summary only patches the complete whole portfolio in matching currency", () => {
  const client = new QueryClient();
  const key = (user, args) => [user, "portfolio", "summary", args];
  const summary = {
    totalValue: { amount: "100", currency: "PLN" },
    dayChange: null,
    isComplete: true,
  };
  for (const [user, args] of [
    ["one", {}],
    ["one", { accountId: "a" }],
    ["two", {}],
  ])
    client.setQueryData(key(user, args), summary);
  client.setQueryData(key("one", { view: "tax" }), { ...summary, isComplete: false });
  updatePortfolioCache(client, "one", {
    accountIds: ["a"],
    reason: "quotes",
    valuationAsOf: "2026-10-13T12:00:00Z",
    summary: {
      totalValue: { amount: "120", currency: "PLN" },
      dayChange: { amount: "20", currency: "PLN" },
      dayChangeRatio: 0.2,
      source: "computed",
    },
  });
  expect(client.getQueryData(key("one", {})).totalValue.amount).toBe("120");
  expect(client.getQueryState(key("one", {})).isInvalidated).toBe(false);
  expect(client.getQueryData(key("one", { accountId: "a" })).totalValue.amount).toBe("100");
  expect(client.getQueryState(key("one", { accountId: "a" })).isInvalidated).toBe(true);
  expect(client.getQueryState(key("one", { view: "tax" })).isInvalidated).toBe(true);
  expect(client.getQueryState(key("two", {})).isInvalidated).toBe(false);
  client.clear();
});

test("parsed imports refresh their rows and history without crossing users or imports", () => {
  const client = new QueryClient();
  const keys = [
    ["one", "portfolio", "rows", { id: "a" }],
    ["one", "portfolio", "import", { id: "a" }],
    ["one", "portfolio", "imports", {}],
    ["one", "portfolio", "rows", { id: "b" }],
    ["two", "portfolio", "rows", { id: "a" }],
  ];
  for (const key of keys) client.setQueryData(key, {});
  updateImportCache(client, "one", "a");
  expect(keys.map((key) => client.getQueryState(key).isInvalidated)).toEqual([
    true,
    true,
    true,
    false,
    false,
  ]);
  client.clear();
});
