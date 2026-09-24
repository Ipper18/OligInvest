import {
  annualizeReturn,
  investorCashflows,
  isCoreError,
  isoDate,
  money,
  periodReturn,
  periodStart,
  simpleReturn,
  timeWeightedReturn,
  toDecimal,
  twrIndex,
  xirr,
} from "@oliginvest/core";
import {
  loadTestVectors,
  readDecimalText,
  readStatistic,
  TOLERANCES,
} from "@oliginvest/test-vectors";
import { describe, expect, test } from "vitest";

const { B_twr_xirr: B } = loadTestVectors();
const pln = (amount) => money(amount, "PLN");
const d = isoDate;

/** "10.982739%" → 0.10982739 as exact text, and half a unit of its last digit. */
function percentText(text) {
  const value = toDecimal(text.replace("%", "")).div(100);
  const places = text.replace("%", "").split(".")[1]?.length ?? 0;
  return { value, halfUnit: toDecimal("0.5").times(toDecimal("10").pow(-(places + 2))) };
}

/** The vector stores rounded values; the computed one must round to it (and meet § 0.5). */
function expectMatchesVector(actual, text) {
  const { value, halfUnit } = percentText(text);
  expect(toDecimal(String(actual)).minus(value).abs().lessThanOrEqualTo(halfUnit)).toBe(true);
}

function codeOf(fn) {
  try {
    fn();
  } catch (error) {
    return isCoreError(error) ? error.code : `not-core-error: ${error}`;
  }
  return "no-error";
}

/**
 * Example B (§ 6.4) as daily points: flows are booked at the start of the day, values at the end;
 * "value before the flow" is the previous day's closing value.
 */
const pointsB = [
  { date: d("2025-01-01"), value: pln("10000"), flow: pln("10000") },
  { date: d("2025-03-31"), value: pln("10800") },
  { date: d("2025-04-01"), value: pln("15800"), flow: pln("5000") },
  { date: d("2025-06-30"), value: pln("15200") },
  { date: d("2025-07-01"), value: pln("13200"), flow: pln("-2000") },
  { date: d("2025-12-31"), value: pln("14100") },
];

describe("TWR — daily chain (obliczenia-finansowe.md § 6.2), vector B", () => {
  const result = timeWeightedReturn(pointsB);

  test("sub-period returns between flows", () => {
    const returns = twrIndex(pointsB).map((p) => p.dailyReturn);
    const subperiods = [returns[1], returns[3], returns[5]];
    subperiods.forEach((r, i) => {
      expectMatchesVector(r, B.subperiod_returns[i]);
    });
    expect([returns[0], returns[2], returns[4]]).toEqual([0, 0, 0]);
  });

  test("TWR equals the vector and the exact chain within 1e-9 relative", () => {
    expectMatchesVector(result.twr, B.twr);
    const exact = toDecimal("578664").div("521400").minus(1);
    const relative = toDecimal(String(result.twr)).minus(exact).div(exact).abs();
    expect(relative.lessThanOrEqualTo(String(TOLERANCES.returnsRelative))).toBe(true);
    expect(result.days).toBe(readStatistic(B.days));
  });

  test("annualization only for periods of at least 365 days", () => {
    expect(result.annualized).toBeNull();
    expectMatchesVector(annualizeReturn(result.twr, readStatistic(B.days)), B.twr_annualized_365);
    const year = timeWeightedReturn([...pointsB, { date: d("2026-01-01"), value: pln("14100") }]);
    expect(year.days).toBe(365);
    expect(year.annualized).toBeCloseTo(year.twr, 12);
    expect(codeOf(() => annualizeReturn(0.1, 0))).toBe("invalid_series");
    expect(codeOf(() => annualizeReturn(-1.5, 400))).toBe("invalid_series");
  });

  test("a full withdrawal closes the period; the chain continues from the next deposit", () => {
    const index = twrIndex([
      { date: d("2025-01-01"), value: pln("1000"), flow: pln("1000") },
      { date: d("2025-01-02"), value: pln("1100") },
      { date: d("2025-01-03"), value: pln("0"), flow: pln("-1100") },
      { date: d("2025-01-06"), value: pln("0") },
      { date: d("2025-01-07"), value: pln("550"), flow: pln("500") },
    ]);
    expect(index.map((p) => p.dailyReturn)).toEqual([0, 0.1, null, null, 0.1]);
    expect(index.at(-1).index.toFixed()).toBe("1.21");
  });

  test("period returns come from the index: I(to) / I(from) − 1", () => {
    const index = twrIndex(pointsB);
    expectMatchesVector(periodReturn(index, d("2024-12-31"), d("2025-12-31")), B.twr);
    // From the close of 2025-03-31 to the end: −3.797468 % then +6.818182 %.
    const tail = toDecimal("15200").div("15800").times(toDecimal("14100").div("13200")).minus(1);
    expect(periodReturn(index, d("2025-03-31"), d("2025-12-31"))).toBeCloseTo(tail.toNumber(), 12);
    expect(periodReturn(index, d("2025-12-31"), d("2025-12-31"))).toBe(0);
    expect(codeOf(() => periodReturn(index, d("2025-12-31"), d("2025-01-01")))).toBe(
      "invalid_series",
    );
    expect(codeOf(() => twrIndex([pointsB[1], pointsB[0]]))).toBe("invalid_series");
    expect(codeOf(() => timeWeightedReturn([]))).toBe("invalid_series");
    expect(
      codeOf(() => twrIndex([pointsB[0], { date: d("2025-01-02"), value: money("1", "EUR") }])),
    ).toBe("currency_mismatch");
  });

  test("period base dates for the API keys: returns run from the close of that day", () => {
    const end = d("2026-03-31");
    const inception = d("2023-09-01");
    expect(periodStart("1m", end, inception)).toBe("2026-02-28");
    expect(periodStart("3m", end, inception)).toBe("2025-12-31");
    expect(periodStart("6m", end, inception)).toBe("2025-09-30");
    expect(periodStart("ytd", end, inception)).toBe("2025-12-31");
    expect(periodStart("1y", end, inception)).toBe("2025-03-31");
    // Never before the day preceding the first valuation, so day one's return is included.
    expect(periodStart("3y", end, inception)).toBe("2023-08-31");
    expect(periodStart("5y", end, inception)).toBe("2023-08-31");
    expect(periodStart("inception", end, inception)).toBe("2023-08-31");
    expect(periodStart("1y", d("2024-02-29"), d("2020-01-01"))).toBe("2023-02-28");
    expect(codeOf(() => periodStart("2w", end, inception))).toBe("invalid_series");
  });

  test("simple return (§ 6.1) is auxiliary and needs a positive start value", () => {
    expect(simpleReturn(pln("1000"), pln("1150"), pln("100"))).toBeCloseTo(0.05, 12);
    expect(simpleReturn(pln("0"), pln("1150"), pln("100"))).toBeNull();
  });
});

describe("XIRR (§ 6.3), vector B", () => {
  const flows = B.cashflows_investor_view.map(([date, amount]) => ({
    date: d(date),
    amount: pln(readDecimalText(amount)),
  }));

  test("money-weighted return within 1e-6 absolute", () => {
    const result = xirr(flows);
    expect(result.status).toBe("ok");
    const expected = percentText(B.xirr).value;
    expect(Math.abs(result.rate - expected.toNumber())).toBeLessThanOrEqual(
      TOLERANCES.xirrAbsolute,
    );
    expectMatchesVector(result.rate, B.xirr);
  });

  test("investor view is built from portfolio flows, start and end values", () => {
    const built = investorCashflows({
      start: { date: d("2025-01-01"), value: pln("0") },
      flows: [
        { date: d("2025-01-01"), amount: pln("10000") },
        { date: d("2025-04-01"), amount: pln("5000") },
        { date: d("2025-07-01"), amount: pln("-2000") },
      ],
      end: { date: d("2025-12-31"), value: pln("14100") },
    });
    expect(built.map((f) => [f.date, f.amount.amount.toFixed()])).toEqual(
      B.cashflows_investor_view.map(([date, amount]) => [date, toDecimal(amount).toFixed()]),
    );
    const withStart = investorCashflows({
      start: { date: d("2025-01-01"), value: pln("500") },
      flows: [],
      end: { date: d("2026-01-01"), value: pln("550") },
    });
    expect(withStart.map((f) => f.amount.amount.toFixed())).toEqual(["-500", "550"]);
    expect(xirr(withStart).rate).toBeCloseTo(0.1, 9);
  });

  test("no sign change, short periods and hard cases", () => {
    expect(xirr([{ date: d("2025-01-01"), amount: pln("-1") }])).toEqual({
      rate: null,
      status: "insufficient_flows",
    });
    expect(
      xirr([
        { date: d("2025-01-01"), amount: pln("-100") },
        { date: d("2025-12-01"), amount: pln("-100") },
      ]),
    ).toEqual({ rate: null, status: "insufficient_flows" });
    expect(
      xirr([
        { date: d("2025-01-01"), amount: pln("-100") },
        { date: d("2025-01-20"), amount: pln("101") },
      ]),
    ).toEqual({ rate: null, status: "period_too_short" });
    // A near-total loss: Newton leaves the domain (1 + x ≤ 0), bisection finds the root.
    const loss = xirr([
      { date: d("2025-01-01"), amount: pln("-100") },
      { date: d("2026-01-01"), amount: pln("0.02") },
    ]);
    expect(loss.status).toBe("ok");
    expect(loss.rate).toBeCloseTo(-0.9998, 9);
    // Newton may converge outside the bisection bracket [−0.9999; 10] …
    const extremeFlows = [
      { date: d("2025-01-01"), amount: pln("-1") },
      { date: d("2026-01-01"), amount: pln("100") },
    ];
    expect(xirr(extremeFlows).rate).toBeCloseTo(99, 9);
    // … but when it does not converge, bisection has no sign change there: no result.
    expect(xirr(extremeFlows, { maxIterations: 1 })).toEqual({
      rate: null,
      status: "no_convergence",
    });
    expect(
      codeOf(() =>
        xirr([
          { date: d("2025-01-01"), amount: pln("-1") },
          { date: d("2026-01-01"), amount: money("2", "EUR") },
        ]),
      ),
    ).toBe("currency_mismatch");
  });
});
