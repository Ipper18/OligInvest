import { Decimal } from "@oliginvest/core";
import { expect, test } from "vitest";
import { loadTestVectors, readStatistic } from "../../../packages/test-vectors/dist/index.js";
import { drawdownFromRows, readDrawdown } from "../src/server/drawdown.js";

const C = loadTestVectors().C_drawdown;
const accountId = "01900000-0000-7000-8000-000000000001";
const rows = C.values.map((v, i) => ({
  accountId,
  date: `2025-01-${String(i + 1).padStart(2, "0")}`,
  totalValuePln: String(readStatistic(v)),
  externalFlowPln: i === 0 ? String(readStatistic(v)) : "0",
  isComplete: true,
  asOf: "2025-01-08T20:00:00Z",
}));
const calculate = (input = rows, query = {}) =>
  drawdownFromRows(
    input,
    "PLN",
    { to: "2025-01-08", maxPoints: 1500, ...query },
    new Date("2025-01-08T22:00:00Z"),
  );

test("vector C: decimal underwater, max DD, dates and calendar durations", () => {
  const result = calculate();
  expect(result).toMatchObject({
    currency: "PLN",
    status: "ok",
    maxDrawdown: "-0.25",
    peakDate: rows[readStatistic(C.peak_index)].date,
    troughDate: rows[readStatistic(C.trough_index)].date,
    recoveryDate: rows[readStatistic(C.recovery_index)].date,
    durationDays: 1,
    recoveryDays: 2,
  });
  result.underwater.drawdown.forEach((dd, i) => {
    expect(typeof dd).toBe("string");
    expect(
      new Decimal(dd)
        .minus(String(readStatistic(C.drawdown_series[i])))
        .abs()
        .lte("0.000001"),
    ).toBe(true);
  });
  expect(
    new Decimal(result.maxDrawdown)
      .minus(String(readStatistic(C.empyrical_max_drawdown)))
      .abs()
      .lte("0.000001"),
  ).toBe(true);
});
test("withdrawals are not losses; no decline has no episode dates", () => {
  const result = calculate(
    rows.slice(0, 2).map((r, i) => ({
      ...r,
      totalValuePln: i ? "50" : "100",
      externalFlowPln: i ? "-50" : "100",
    })),
  );
  expect(result).toMatchObject({
    maxDrawdown: "0",
    peakDate: null,
    troughDate: null,
    durationDays: null,
    recoveryDays: null,
  });
});
test("an unrecovered decline differs from an unavailable result", () => {
  expect(calculate(rows.slice(0, 6))).toMatchObject({
    status: "ok",
    maxDrawdown: "-0.25",
    recoveryDate: null,
    recoveryDays: null,
  });
  expect(calculate([])).toMatchObject({
    status: "no_data",
    maxDrawdown: null,
    underwater: { t: [], drawdown: [] },
  });
});
test("missing valuations, flows, account-days and previous close block the result", () => {
  for (const input of [
    rows.filter((_, i) => i !== 2),
    rows.map((r, i) => (i === 2 ? { ...r, totalValuePln: null } : r)),
    rows.map((r, i) => (i === 2 ? { ...r, externalFlowPln: null } : r)),
    [...rows, { ...rows[0], accountId: "01900000-0000-7000-8000-000000000002" }],
  ]) {
    expect(calculate(input)).toMatchObject({ status: "incomplete", maxDrawdown: null });
  }
  expect(
    calculate(
      rows.filter((_, i) => i !== 2),
      { from: "2025-01-04" },
    ).status,
  ).toBe("incomplete");
  expect(
    calculate(
      rows.map((r, i) => (i === 1 ? { ...r, totalValuePln: null } : r)),
      { from: "2025-01-04" },
    ).status,
  ).toBe("ok");
});
test("range includes previous close and ignores future changes", () => {
  expect(calculate(rows, { from: "2025-01-05", to: "2025-01-06" })).toMatchObject({
    maxDrawdown: "-0.25",
    peakDate: "2025-01-04",
    recoveryDate: null,
  });
  expect(
    calculate(
      rows.map((r, i) => (i > 5 ? { ...r, totalValuePln: null } : r)),
      { to: "2025-01-06" },
    ),
  ).toEqual(calculate(rows, { to: "2025-01-06" }));
});
test("decimation preserves max-DD dates and computes on full daily data", () => {
  const input = Array.from({ length: 3500 }, (_, i) => ({
    ...rows[0],
    date: new Date(Date.UTC(2010, 0, i + 1)).toISOString().slice(0, 10),
    totalValuePln: i === 1777 ? "75" : "100",
    externalFlowPln: i ? "0" : "100",
  }));
  const result = calculate(input, { to: input.at(-1).date, maxPoints: 50 });
  expect(result.maxDrawdown).toBe("-0.25");
  expect(result.decimated).toBe(true);
  expect(result.underwater.t.length).toBeLessThanOrEqual(50);
  for (const date of [
    input[0].date,
    input.at(-1).date,
    result.peakDate,
    result.troughDate,
    result.recoveryDate,
  ])
    expect(result.underwater.t).toContain(Date.parse(date) / 1000);
});
test("RLS-hidden account returns 404", async () => {
  const repository = {
    now: () => new Date("2025-01-08"),
    read: async (_, work) => work({ execute: async () => ({ rows: [] }) }),
  };
  await expect(
    readDrawdown(
      repository,
      { userId: "owner", role: "user" },
      { accountId: [accountId], maxPoints: 1500 },
    ),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});
