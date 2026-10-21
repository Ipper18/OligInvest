import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
  ANALYTICS_JOB_TYPES,
  ANALYTICS_LIMITS,
  ANALYTICS_TIMEOUTS_SECONDS,
  analyticsCancelKey,
  analyticsContractDocument,
  analyticsJobSchema,
  analyticsProgressSchema,
  analyticsResultSchema,
} from "../dist/analytics-jobs.js";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/analytics-job-cases.json", import.meta.url), "utf8"),
);
const exported = readFileSync(
  new URL(
    "../../../apps/analytics/src/oliginvest_analytics/schemas/analytics-jobs.schema.json",
    import.meta.url,
  ),
  "utf8",
);

function applyCase({ base, set, delete: removed }) {
  const job = structuredClone(fixture.bases[base]);
  const walk = (path) => {
    let node = job;
    for (const key of path.slice(0, -1)) node = node[key];
    return [node, path.at(-1)];
  };
  for (const { path, value } of set) {
    const [node, key] = walk(path);
    node[key] = value;
  }
  for (const path of removed) {
    const [node, key] = walk(path);
    delete node[key];
  }
  return job;
}

test.each(fixture.cases.map((item) => [item.name, item]))("%s", (_name, item) => {
  expect(analyticsJobSchema.safeParse(applyCase(item)).success).toBe(item.valid);
});

test("every job type has a canonical example, a timeout and a closed schema", () => {
  expect(Object.keys(fixture.bases)).toEqual([...ANALYTICS_JOB_TYPES]);
  expect(Object.keys(ANALYTICS_TIMEOUTS_SECONDS)).toEqual([...ANALYTICS_JOB_TYPES]);
  const document = analyticsContractDocument();
  expect(document.job.oneOf).toHaveLength(ANALYTICS_JOB_TYPES.length);
  const open = [];
  const visit = (node, path) => {
    if (Array.isArray(node)) {
      for (const [index, item] of node.entries()) visit(item, `${path}/${index}`);
    } else if (node && typeof node === "object") {
      if (node.type === "object" && node.additionalProperties !== false && !node.propertyNames)
        open.push(path);
      for (const [key, value] of Object.entries(node)) visit(value, `${path}/${key}`);
    }
  };
  visit(document, "");
  expect(open).toEqual([]);
});

test("Z-19 limits are encoded in the exported schema", () => {
  const document = analyticsContractDocument();
  const monteCarlo = document.job.oneOf.find(
    (item) => item.properties.type.const === "monte_carlo",
  );
  expect(monteCarlo.properties.params.properties.paths.maximum).toBe(
    ANALYTICS_LIMITS.monteCarloPaths,
  );
  expect(document.limits.backtestCombinations).toBe(500);
  expect(document.timeoutsSeconds.monte_carlo).toBe(60);
});

test("the committed worker schema matches the Zod contract", () => {
  expect(exported.replaceAll("\r\n", "\n")).toBe(
    `${JSON.stringify(analyticsContractDocument(), null, 2)}\n`,
  );
});

test("results report failures with an OpenAPI error code and no extra fields", () => {
  const failure = {
    v: 1,
    runId: fixture.bases.monte_carlo.runId,
    status: "failed",
    error: { code: "TIMEOUT" },
    finishedAt: "2026-10-19T08:31:00Z",
    durationMs: 60000,
  };
  expect(analyticsResultSchema.parse(failure)).toEqual(failure);
  for (const invalid of [
    { ...failure, error: { code: "TIMEOUT", message: "stack trace" } },
    { ...failure, error: { code: "DATA_LEAK" } },
    { ...failure, status: "done" },
    { ...failure, userId: failure.runId },
  ])
    expect(analyticsResultSchema.safeParse(invalid).success).toBe(false);
});

test("done results carry only a distribution with assumptions; holds and cancellations are typed", () => {
  const months = [0, 1, 2];
  const fan = { p5: [1, 1, 1], p25: [1, 2, 2], p50: [1, 2, 3], p75: [1, 3, 4], p95: [1, 4, 5] };
  const done = {
    v: 1,
    runId: fixture.bases.monte_carlo.runId,
    status: "done",
    finishedAt: "2026-10-20T08:31:00Z",
    durationMs: 1200,
    result: {
      kind: "monte_carlo",
      currency: "PLN",
      months,
      nominal: fan,
      real: fan,
      goalProbability: 0.42,
      maxDrawdownPercentiles: { p5: -0.5, p50: -0.2, p95: -0.05 },
      sensitivity: [
        {
          scenario: "mean_minus_2pp",
          annualCostRate: 0.005,
          endValueP5: 1,
          endValueP50: 2,
          goalProbability: 0.3,
        },
        {
          scenario: "mean_plus_2pp",
          annualCostRate: 0.005,
          endValueP5: 1,
          endValueP50: 4,
          goalProbability: 0.5,
        },
      ],
    },
    assumptions: { model: "stationary_bootstrap", proxies: ["WIG"], tax: { mode: "none" } },
    warnings: [{ code: "SHORT_HISTORY", severity: "warning", message: "Krótka historia." }],
    reproducibility: {
      seed: 7,
      algorithmVersion: "mc-1.0.0",
      dataVersion: { WIG: "2006-01..2026-09" },
      libraries: { numpy: "2.5.0" },
    },
  };
  expect(analyticsResultSchema.parse(done)).toEqual(done);
  const point = structuredClone(done);
  point.result.expectedValue = 123; // a point forecast field is outside the contract
  const nanLike = structuredClone(done);
  nanLike.result.maxDrawdownPercentiles.p5 = -1.5;
  const oneScenario = structuredClone(done);
  oneScenario.result.sensitivity = oneScenario.result.sensitivity.slice(0, 1);
  for (const invalid of [point, nanLike, oneScenario, { ...done, result: undefined }])
    expect(analyticsResultSchema.safeParse(invalid).success).toBe(false);
  const { result: _r, assumptions: _a, warnings: _w, reproducibility: _p, ...envelope } = done;
  expect(analyticsResultSchema.parse({ ...envelope, status: "cancelled" }).status).toBe(
    "cancelled",
  );
  expect(
    analyticsResultSchema.parse({
      ...envelope,
      status: "failed",
      error: { code: "DATA_QUALITY_HOLD" },
    }).error.code,
  ).toBe("DATA_QUALITY_HOLD");
  expect(analyticsProgressSchema.safeParse({ progress: 50, stage: "simulating" }).success).toBe(
    true,
  );
  expect(analyticsProgressSchema.safeParse({ progress: 101, stage: "simulating" }).success).toBe(
    false,
  );
  expect(analyticsCancelKey(done.runId)).toBe(`bull:analytics:cancel:${done.runId}`);
  expect(() => analyticsCancelKey("../x")).toThrow();
});
