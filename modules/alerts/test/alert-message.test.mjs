import { expect, test } from "vitest";
import { alertMessage } from "../src/message.js";

const input = {
  ticker: "SYN",
  instrumentId: "00000000-0000-4000-8000-000000000001",
  currency: "PLN",
  type: "price_above",
  value: "101.25",
  threshold: "100",
  dataSource: "yahoo",
  dataAsOf: "2026-10-23T10:00:00Z",
  triggeredAt: "2026-10-23T10:15:00Z",
  delayMinutes: 15,
};
test.each(["price_above", "price_below", "change_pct"])("factual template %s", (type) => {
  const message = alertMessage({ ...input, type }, "https://example.test", "Europe/Warsaw");
  expect(message).toContain("Yahoo");
  expect(message).toContain("12:00");
  expect(message).toContain("12:15");
  expect(message).toContain("15 min");
  expect(message).toContain(input.instrumentId);
  expect(message).not.toMatch(
    /\b(kup|sprzedaj|trzymaj|warto|rekomendujemy|sygnał|najlepsz|gwarancja)\b/i,
  );
});
test("portfolio amounts and arbitrary fields cannot enter the message", () => {
  expect(() =>
    alertMessage({ ...input, portfolioValue: "100000" }, "https://example.test", "UTC"),
  ).toThrow();
});

test("English alerts retain exact quote, source and recipient timezone", async () => {
  const { copies } = await import("@oliginvest/i18n/en");
  const text = alertMessage(
    input,
    "https://example.test",
    "America/New_York",
    "en-US",
    copies.alertMessages,
  );
  expect(text).toContain("101.25 PLN");
  expect(text).toContain("6:15");
  expect(text).toContain("Yahoo");
  expect(text).toContain("threshold");
});
