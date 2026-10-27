import { isCoreError, portfolioHistory } from "@oliginvest/core";
import { describe, expect, test } from "vitest";

const row = (accountId, date, totalValuePln, externalFlowPln = "0", isComplete = true) => ({
  accountId,
  date,
  totalValuePln,
  externalFlowPln,
  isComplete,
});
const text = (points, field) => points.map((p) => (p[field] === null ? null : p[field].toFixed()));
const codeOf = (fn) => {
  try {
    fn();
  } catch (error) {
    return isCoreError(error) ? error.code : String(error);
  }
  return "no-error";
};

describe("portfolio value history (FR-02.10, § 5)", () => {
  const rows = [
    row("a", "2026-01-01", "1000.10", "1000.10"),
    row("b", "2026-01-01", "0.20", "0.20"),
    row("a", "2026-01-02", "1010.10"),
    row("b", "2026-01-02", "0.25"),
    row("a", "2026-01-03", "1500.10", "500"),
    row("b", "2026-01-03", null, "0", false),
    row("a", "2026-01-04", "1400.10", "-100"),
    row("b", "2026-01-04", "0.30"),
  ];

  test("sums accounts exactly in Decimal and keeps gaps as null, never 0", () => {
    const result = portfolioHistory(rows, { to: "2026-01-04", interval: "1d", maxPoints: 1500 });
    expect(text(result.points, "value")).toEqual(["1000.3", "1010.35", null, "1400.4"]);
    expect(text(result.points, "netContributions")).toEqual([
      "1000.3",
      "1000.3",
      "1500.3",
      "1400.3",
    ]);
    expect(text(result.points, "flow")).toEqual(["1000.3", "0", "500", "-100"]);
    expect(result.decimated).toBe(false);
  });

  test("an incomplete account with a stored value still yields a null day", () => {
    const result = portfolioHistory([row("a", "2026-01-01", "10", "10", false)], {
      to: "2026-01-01",
      interval: "1d",
      maxPoints: 50,
    });
    expect(result.points[0].value).toBeNull();
  });

  test("an unknown flow makes the cumulative contributions unknown from that day on", () => {
    const result = portfolioHistory(
      [
        row("a", "2026-01-01", "10", "10"),
        row("a", "2026-01-02", "11", null),
        row("a", "2026-01-03", "12"),
      ],
      { to: "2026-01-03", interval: "1d", maxPoints: 50 },
    );
    expect(text(result.points, "netContributions")).toEqual(["10", null, null]);
    expect(text(result.points, "value")).toEqual(["10", "11", "12"]);
  });

  test("contributions accumulate from before `from` and rows after `to` are ignored", () => {
    const result = portfolioHistory(rows, {
      from: "2026-01-03",
      to: "2026-01-03",
      interval: "1d",
      maxPoints: 50,
    });
    expect(result.points.map((p) => p.date)).toEqual(["2026-01-03"]);
    expect(result.points[0].netContributions.toFixed()).toBe("1500.3");
  });

  test("weekly and monthly series take the period-end point", () => {
    const days = [];
    for (let day = 1; day <= 31; day += 1)
      days.push(row("a", `2026-03-${String(day).padStart(2, "0")}`, String(100 + day)));
    days.push(row("a", "2026-04-01", "200"));
    const weekly = portfolioHistory(days, { to: "2026-04-01", interval: "1w", maxPoints: 50 });
    // 2026-03-01 is a Sunday: weeks end on 03-01, 03-08, …, 03-29, then the open week to 04-01.
    expect(weekly.points.map((p) => p.date)).toEqual([
      "2026-03-01",
      "2026-03-08",
      "2026-03-15",
      "2026-03-22",
      "2026-03-29",
      "2026-04-01",
    ]);
    const monthly = portfolioHistory(days, { to: "2026-04-01", interval: "1mo", maxPoints: 50 });
    expect(text(monthly.points, "value")).toEqual(["131", "200"]);
    expect(monthly.decimated).toBe(true);
  });

  test("decimation stays within maxPoints and keeps the latest point", () => {
    const days = [];
    for (let i = 0; i < 1000; i += 1) {
      const date = new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10);
      days.push(row("a", date, String(i)));
    }
    const result = portfolioHistory(days, { to: "2030-01-01", interval: "1d", maxPoints: 300 });
    expect(result.points.length).toBeLessThanOrEqual(300);
    expect(result.points.at(-1).value.toFixed()).toBe("999");
    expect(result.daily).toHaveLength(1000);
    expect(result.decimated).toBe(true);
  });

  test("rejects duplicates, reversed ranges and invalid point limits", () => {
    expect(
      codeOf(() =>
        portfolioHistory([row("a", "2026-01-01", "1"), row("a", "2026-01-01", "2")], {
          to: "2026-01-01",
          interval: "1d",
          maxPoints: 50,
        }),
      ),
    ).toBe("invalid_series");
    expect(
      codeOf(() =>
        portfolioHistory([], {
          from: "2026-01-02",
          to: "2026-01-01",
          interval: "1d",
          maxPoints: 50,
        }),
      ),
    ).toBe("invalid_date");
    expect(
      codeOf(() => portfolioHistory([], { to: "2026-01-01", interval: "1d", maxPoints: 0 })),
    ).toBe("invalid_series");
    expect(
      portfolioHistory([], { to: "2026-01-01", interval: "1d", maxPoints: 50 }).points,
    ).toEqual([]);
  });
});
