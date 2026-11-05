import { expect, test } from "vitest";
import { stressScenarioInputSchema, stressScenarioKeySchema } from "../dist/index.js";

const historical = {
  name: "Okno testowe",
  kind: "historical",
  description: "Syntetyczne okno",
  enabled: true,
  startDate: "2020-01-01",
  endDate: "2023-01-01",
};
const hypothetical = (items) => ({
  name: "Szoki",
  kind: "hypothetical",
  description: "Syntetyczne szoki",
  enabled: false,
  shocks: { items },
});

test("scenario names are trimmed and cannot be blank", () => {
  for (const scenario of [historical, hypothetical([{ kind: "correlation_shock" }])]) {
    for (const name of ["", "   "]) {
      expect(stressScenarioInputSchema.safeParse({ ...scenario, name }).success).toBe(false);
    }
    expect(stressScenarioInputSchema.parse({ ...scenario, name: "  Test  " }).name).toBe("Test");
  }
});

test("historical window accepts exactly 1096 days and rejects invalid dates and fields", () => {
  expect(stressScenarioInputSchema.parse(historical)).toEqual(historical);
  for (const change of [
    { endDate: "2023-01-02" },
    { endDate: historical.startDate },
    { endDate: "2019-12-31" },
    { startDate: undefined },
    { endDate: undefined },
    { startDate: "2020-02-30" },
    { startDate: "2020-01-01T00:00:00Z" },
    { shocks: { items: [{ kind: "correlation_shock" }] } },
    { unknown: true },
    { name: "x".repeat(81) },
    { description: "x".repeat(1001) },
  ])
    expect(stressScenarioInputSchema.safeParse({ ...historical, ...change }).success).toBe(false);
  expect(stressScenarioInputSchema.safeParse({ ...historical, shocks: {} }).success).toBe(true);
});

test("shock lists use the existing stress analysis semantics, including zero and boundaries", () => {
  const items = [
    { kind: "index_shock", instrumentId: "00000000-0000-4000-8000-000000000001", shock: -0.9 },
    { kind: "fx_shock", currency: "USD", shock: 0.9 },
    { kind: "fx_shock", currency: "EUR", shock: 0 },
    { kind: "correlation_shock" },
    { kind: "correlation_shock", correlation: 0 },
    { kind: "correlation_shock", correlation: 1 },
  ];
  expect(stressScenarioInputSchema.parse(hypothetical(items))).toEqual(hypothetical(items));
  expect(stressScenarioInputSchema.safeParse(hypothetical(Array(10).fill(items[3]))).success).toBe(
    true,
  );
  for (const invalid of [
    [],
    Array(11).fill(items[3]),
    [{ kind: "fx_shock", currency: "PLN", shock: 0.1 }],
    [{ kind: "fx_shock", currency: "USD" }],
    [{ ...items[0], instrumentId: "invalid" }],
    [{ ...items[0], shock: -0.901 }],
    [{ ...items[1], shock: 0.901 }],
    [{ ...items[1], shock: "0.1" }],
    [{ ...items[1], shock: Number.NaN }],
    [{ ...items[0], currency: "EUR" }],
    [{ ...items[1], correlation: 0.2 }],
    [{ ...items[3], shock: 0 }],
    [{ ...items[3], correlation: 1.01 }],
    [{ ...items[3], correlation: -0.01 }],
    [{ ...items[3], extra: true }],
    [{ kind: "unknown" }],
  ])
    expect(stressScenarioInputSchema.safeParse(hypothetical(invalid)).success).toBe(false);
  for (const change of [
    { shocks: {} },
    { shocks: { items, extra: true } },
    { shocks: undefined },
    { startDate: "2020-01-01" },
    { endDate: "2020-01-02" },
  ])
    expect(stressScenarioInputSchema.safeParse({ ...hypothetical(items), ...change }).success).toBe(
      false,
    );
});

test("scenario keys stay within the documented namespace", () => {
  for (const key of ["abc", "covid_2020", "x".repeat(40)])
    expect(stressScenarioKeySchema.safeParse(key).success).toBe(true);
  for (const key of ["ab", "x".repeat(41), "COVID", "../abc", "abc-def"])
    expect(stressScenarioKeySchema.safeParse(key).success).toBe(false);
});
