import { ProblemError } from "@oliginvest/platform";
import { expect, test } from "vitest";
import { stressScenario } from "../dist/src/contracts.js";
import {
  ALGORITHM_VERSIONS,
  BUILTIN_STRESS_SCENARIOS,
  goalDefaults,
  IMPLEMENTED_TYPES,
  MAX_SCENARIO_DAYS,
  stressShocks,
} from "../dist/src/server/runs.js";

const index = "0192f0c4-7b1e-7c3a-9f00-3d2a1b4c5d01";
const problemPath = (work) => {
  try {
    work();
  } catch (error) {
    expect(error).toBeInstanceOf(ProblemError);
    return error.options.errors[0].path;
  }
  throw new Error("expected a problem");
};

test("BL-556 and BL-560 are computed by this release", () => {
  expect([...IMPLEMENTED_TYPES]).toEqual(["monte_carlo", "stress_test", "goal"]);
  expect(ALGORITHM_VERSIONS).toMatchObject({ stress_test: "stress-1.0.0", goal: "goal-1.0.0" });
});

test("built-in scenarios follow § 12.3 and fit the list contract", () => {
  expect(BUILTIN_STRESS_SCENARIOS.map((s) => [s.key, s.startDate, s.endDate])).toEqual([
    ["gfc_2008", "2008-09-01", "2009-03-09"],
    ["covid_2020", "2020-02-19", "2020-03-23"],
    ["inflation_2022", "2022-01-03", "2022-10-12"],
  ]);
  for (const scenario of BUILTIN_STRESS_SCENARIOS) {
    expect(stressScenario.parse(scenario)).toEqual(scenario);
    const days = (Date.parse(scenario.endDate) - Date.parse(scenario.startDate)) / 86_400_000;
    expect(days).toBeLessThanOrEqual(MAX_SCENARIO_DAYS);
  }
});

test("each shock kind takes exactly its own fields; correlation defaults to 0.9", () => {
  expect(
    stressShocks([
      { kind: "index_shock", instrumentId: index, shock: -0.3 },
      { kind: "fx_shock", currency: "EUR", shock: 0.1 },
      { kind: "correlation_shock" },
    ]),
  ).toEqual([
    { kind: "index_shock", instrumentId: index, shock: -0.3 },
    { kind: "fx_shock", currency: "EUR", shock: 0.1 },
    { kind: "correlation_shock", correlation: 0.9 },
  ]);
  expect(problemPath(() => stressShocks([{ kind: "index_shock", shock: -0.3 }]))).toBe(
    "hypothetical.0",
  );
  expect(
    problemPath(() =>
      stressShocks([
        { kind: "correlation_shock" },
        { kind: "fx_shock", currency: "USD", shock: 0.1, instrumentId: index },
      ]),
    ),
  ).toBe("hypothetical.1");
  expect(problemPath(() => stressShocks([{ kind: "fx_shock", currency: "CHF", shock: 0.1 }]))).toBe(
    "hypothetical.0",
  );
  expect(problemPath(() => stressShocks([{ kind: "correlation_shock", shock: -0.1 }]))).toBe(
    "hypothetical.0",
  );
});

test("goal: PLN target, unique probabilities in ascending order", () => {
  const base = {
    target: { amount: "100000", currency: "PLN" },
    horizonYears: 10,
    probabilities: [0.9, 0.5, 0.75],
    paths: 5000,
    inflationRate: 0.025,
    indexToInflation: true,
    taxMode: "belka_simplified",
    annualCostRate: 0,
  };
  expect(goalDefaults(base).probabilities).toEqual([0.5, 0.75, 0.9]);
  expect(
    problemPath(() => goalDefaults({ ...base, target: { amount: "1", currency: "EUR" } })),
  ).toBe("target");
  expect(
    problemPath(() => goalDefaults({ ...base, target: { amount: "-5", currency: "PLN" } })),
  ).toBe("target");
  expect(problemPath(() => goalDefaults({ ...base, probabilities: [0.5, 0.5] }))).toBe(
    "probabilities",
  );
});
