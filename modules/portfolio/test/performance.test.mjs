import { readFileSync } from "node:fs";
import { Decimal } from "@oliginvest/core";
import { expect, test } from "vitest";
import { performanceFromRows, readPerformance } from "../src/server/performance.js";

// The shared vector source used by packages/test-vectors (no extra dependency).
const { B_twr_xirr: B } = JSON.parse(
  readFileSync(new URL("../../../docs/03-dane/wektory-testowe.json", import.meta.url), "utf8"),
);
const accountId = "01900000-0000-7000-8000-000000000001";
const checkpoints = [
  ["2025-01-01", "10000", "10000"],
  ["2025-03-31", "10800", "0"],
  ["2025-04-01", "15800", "5000"],
  ["2025-06-30", "15200", "0"],
  ["2025-07-01", "13200", "-2000"],
  ["2025-12-31", "14100", "0"],
];
const rows = [];
let value = "10000";
for (
  let d = new Date("2025-01-01");
  d <= new Date("2025-12-31");
  d.setUTCDate(d.getUTCDate() + 1)
) {
  const date = d.toISOString().slice(0, 10),
    point = checkpoints.find((p) => p[0] === date);
  value = point?.[1] ?? value;
  rows.push({
    accountId,
    date,
    totalValuePln: value,
    externalFlowPln: point?.[2] ?? "0",
    isComplete: true,
    asOf: `${date}T20:00:00Z`,
  });
}
const calculate = (input = rows, query = {}) =>
  performanceFromRows(
    input,
    "PLN",
    { to: "2025-12-31", ...query },
    new Date("2025-12-31T22:00:00Z"),
  );

test("vector B: chained TWR, XIRR, string rates and all periods", () => {
  const result = calculate();
  for (const key of ["twr", "xirr"]) {
    expect(typeof result.total[key]).toBe("string");
    const expected = new Decimal(B[key].replace("%", "")).div(100);
    expect(new Decimal(result.total[key]).minus(expected).abs().lte("0.000000005")).toBe(true);
  }
  expect(result.total.twrAnnualized).toBeNull();
  expect(result.total.xirrStatus).toBe("ok");
  expect(result.periods).toHaveLength(8);
  expect(result.currency).toBe("PLN");
});
test("a chosen period uses previous close and counts first-day flow once", () => {
  const result = calculate(rows, { from: "2025-04-01", to: "2025-06-30" });
  expect(
    new Decimal(result.total.twr)
      .minus(new Decimal("15200").div("15800").minus(1))
      .abs()
      .lt("1e-12"),
  ).toBe(true);
});
test("29 days suppress XIRR; exactly 30 days permit it", () => {
  expect(calculate(rows, { to: "2025-01-30" }).total.xirrStatus).toBe("period_too_short");
  expect(calculate(rows, { to: "2025-01-31" }).total.xirrStatus).toBe("ok");
});
test("a gap never becomes zero or a return spanning missing valuations", () => {
  const incomplete = rows.map((r, i) => (i === 10 ? { ...r, totalValuePln: null } : r));
  expect(calculate(incomplete).total.twr).toBeNull();
  expect(calculate(incomplete).total.xirr).toBeNull();
  expect(calculate(rows.filter((_, i) => i !== 10)).total.twr).toBeNull();
  expect(calculate(incomplete, { from: "2025-04-01" }).total.twr).not.toBeNull();
});
test("empty history and missing flows are explicit", () => {
  expect(calculate([]).total).toMatchObject({
    twr: null,
    xirr: null,
    xirrStatus: "insufficient_flows",
  });
  expect(
    calculate(rows.map((r, i) => (i === 10 ? { ...r, externalFlowPln: null } : r))).total.twr,
  ).toBeNull();
});
test("365 days enables annualization; an unknown account-day blocks aggregation", () => {
  const anniversary = { ...rows.at(-1), date: "2026-01-01", asOf: "2026-01-01T20:00:00Z" };
  const annual = calculate([...rows, anniversary], { to: "2026-01-01" });
  expect(annual.total.twrAnnualized).toBe(annual.total.twr);
  const second = rows.map((r) => ({ ...r, accountId: "01900000-0000-7000-8000-000000000002" }));
  expect(calculate([...rows, ...second]).total.twr).toBe(calculate().total.twr);
  expect(calculate([...rows, ...second.filter((_, i) => i !== 10)]).total.twr).toBeNull();
});
test("later data cannot change an earlier selected period", () => {
  const changed = rows.map((r) =>
    r.date > "2025-06-30" ? { ...r, totalValuePln: "999999", externalFlowPln: null } : r,
  );
  expect(calculate(changed, { to: "2025-06-30" }).total).toEqual(
    calculate(rows, { to: "2025-06-30" }).total,
  );
});
test("RLS-hidden account returns 404 before reading its valuations", async () => {
  const repository = {
    now: () => new Date("2025-12-31"),
    read: async (context, work) => {
      expect(context.userId).toBe("owner");
      return work({ execute: async () => ({ rows: [] }) });
    },
  };
  await expect(
    readPerformance(
      repository,
      { userId: "owner", role: "user" },
      { accountId: [accountId], currency: "base" },
    ),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});
