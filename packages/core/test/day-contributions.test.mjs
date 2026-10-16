import { addMoney, dayChange, dayContributions, money, sumMoney } from "@oliginvest/core";
import { loadTestVectors } from "@oliginvest/test-vectors";
import { expect, test } from "vitest";

const amount = (s) => (s === null ? null : money(s, "PLN"));
for (const v of loadTestVectors().F_day_change.positions)
  test(v.name, () => {
    const result = dayContributions({
      base: amount(v.base),
      totalChange: amount(v.change),
      positions: [
        {
          instrumentId: "one",
          previousValue: amount(v.previous),
          currentValue: amount(v.current),
          cash: amount(v.cash),
          transfers: amount(v.transfer),
        },
      ],
    });
    expect(result.positions[0].change?.amount.toFixed() ?? null).toBe(v.change);
    if (v.change === null) expect(result.residualChange).toBe(null);
    else
      expect(result.positions[0].change.amount.plus(result.residualChange.amount).toFixed()).toBe(
        v.change,
      );
  });

for (const v of loadTestVectors().F_day_change.reconciliation) {
  test(`unrounded § 5.1 identity: ${v.name}`, () => {
    const total = dayChange({
      valueNow: amount(v.current),
      valuePrevClose: amount(v.previous),
      externalFlows: amount(v.flows),
    });
    const result = dayContributions({
      base: addMoney(amount(v.previous), amount(v.flows)),
      totalChange: total.change,
      positions: v.positions.map((p, i) => ({
        instrumentId: String(i),
        previousValue: amount(p.previous),
        currentValue: amount(p.current),
        cash: amount(p.cash),
        transfers: amount(p.transfer),
      })),
    });
    expect(total.change.amount.toFixed()).toBe(v.change);
    expect(result.residualChange.amount.toFixed()).toBe(v.residual);
    expect(
      sumMoney([...result.positions.map((p) => p.change), result.residualChange], "PLN").amount.eq(
        total.change.amount,
      ),
    ).toBe(true);
  });
}
test("cash FX and unassigned costs remain in residual; zero or missing base hides ratios", () => {
  for (const base of [null, money("0", "PLN"), money("-1", "PLN")]) {
    const result = dayContributions({ base, totalChange: money("7", "PLN"), positions: [] });
    expect(result.residualChange.amount.toFixed()).toBe("7");
    const missing = dayContributions({
      base,
      totalChange: null,
      positions: [
        {
          instrumentId: "one",
          previousValue: money("100", "PLN"),
          currentValue: money("105", "PLN"),
          cash: money("0", "PLN"),
          transfers: money("0", "PLN"),
        },
      ],
    });
    expect(missing.positions[0].contributionRatio).toBe(null);
    expect(missing.residualChange).toBe(null);
  }
});
test("contribution ratio uses portfolio flow-adjusted base and currencies are checked", () => {
  const position = {
    instrumentId: "one",
    previousValue: money("100", "PLN"),
    currentValue: money("120", "PLN"),
    cash: money("-2", "PLN"),
    transfers: money("0", "PLN"),
  };
  expect(
    dayContributions({
      base: money("1000", "PLN"),
      totalChange: money("20", "PLN"),
      positions: [position],
    }).positions[0].contributionRatio,
  ).toBe(0.018);
  expect(() =>
    dayContributions({
      base: money("1000", "PLN"),
      totalChange: money("20", "PLN"),
      positions: [{ ...position, cash: money("1", "USD") }],
    }),
  ).toThrow();
});
