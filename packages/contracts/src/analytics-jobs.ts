import * as z from "zod";

// Queue `analytics` (api → Python worker) and `analytics-results` (worker → jobs), BL-311.
// The worker validates the exported JSON Schema with `jsonschema`; refinements below have
// Python twins in `oliginvest_analytics.contracts` and shared cases in test/fixtures.
export const ANALYTICS_JOB_VERSION = 1;
export const ANALYTICS_JOB_TYPES = [
  "monte_carlo",
  "optimization",
  "stress_test",
  "what_if",
  "backtest",
  "goal",
] as const;
export type AnalyticsJobType = (typeof ANALYTICS_JOB_TYPES)[number];

// Z-19, ADR-003 § 5 and obliczenia-finansowe.md § 12; api answers 422 before queueing.
export const ANALYTICS_LIMITS = {
  monteCarloPaths: 10_000,
  horizonYears: 40,
  optimizationInstruments: 50,
  optimizationResamples: 500,
  backtestCombinations: 500,
  backtestGridParameters: 10,
  backtestGridValues: 20,
  backtestUniverseInstruments: 100,
  portfolioPositions: 500,
  jobPayloadBytes: 262_144,
} as const;

// Hard wall-clock limit per job type; the worker kills the computation process.
export const ANALYTICS_TIMEOUTS_SECONDS = {
  monte_carlo: 60,
  optimization: 120,
  stress_test: 60,
  what_if: 30,
  backtest: 300,
  goal: 120,
} as const satisfies Record<AnalyticsJobType, number>;

// AnalyticsRun.error.code in openapi.yaml.
export const ANALYTICS_ERROR_CODES = [
  "TIMEOUT",
  "MEMORY_LIMIT",
  "INSUFFICIENT_DATA",
  "COVERAGE_TOO_LOW",
  "INVALID_PARAMS",
  "INTERNAL",
  // obliczenia-finansowe.md § 14 (owner decision 2026-10-20): an open BLOCK on an input series.
  "DATA_QUALITY_HOLD",
] as const;

const object = z.strictObject;
const uuid = z.uuid();
const localDate = z.iso.date();
const timestamp = z.iso.datetime();
const plnMoney = (pattern: RegExp) =>
  object({ amount: z.string().regex(pattern), currency: z.literal("PLN") });
// Amounts stay decimal text (ADR-014); ASCII digits only, matching Python `re.ASCII`.
const nonNegativePln = plnMoney(/^[0-9]{1,14}(\.[0-9]{1,8})?$/);
const positivePln = plnMoney(/^(?=.*[1-9])[0-9]{1,14}(\.[0-9]{1,8})?$/);
const signedNonZeroPln = plnMoney(/^-?(?=.*[1-9])[0-9]{1,14}(\.[0-9]{1,8})?$/);
const ratio = (min: number, max: number) => z.number().min(min).max(max);
const int = (min: number, max: number) => z.int().min(min).max(max);
const seed = z.int().min(0);
const horizonYears = int(1, ANALYTICS_LIMITS.horizonYears);
const paths = int(100, ANALYTICS_LIMITS.monteCarloPaths);
const inflationRate = ratio(0, 0.2);

const unique = <T>(values: readonly T[]) => new Set(values).size === values.length;
const ordered = (range: { from: string; to: string }) => range.from < range.to;
const dateRange = object({ from: localDate, to: localDate }).refine(ordered, {
  message: "Range must end after it starts",
});

// Snapshot written by api into analytics_runs.input_snapshot: the worker never reads
// portfolio tables (ADR-003), so values and the proxy mapping travel in the job.
const portfolioSnapshot = object({
  asOf: localDate,
  positions: z
    .array(object({ instrumentId: uuid, proxyInstrumentId: uuid, value: nonNegativePln }))
    .min(1)
    .max(ANALYTICS_LIMITS.portfolioPositions)
    .refine((items) => unique(items.map((item) => item.instrumentId)), {
      message: "Duplicate instrument",
    }),
  cash: nonNegativePln,
});

const cashFlowPlan = object({
  amount: positivePln,
  frequency: z.enum(["monthly", "quarterly", "yearly"]),
  startYear: int(0, ANALYTICS_LIMITS.horizonYears),
  endYear: int(0, ANALYTICS_LIMITS.horizonYears),
  indexToInflation: z.boolean(),
});

const job = <T extends AnalyticsJobType, S extends z.ZodRawShape>(type: T, shape: S) =>
  object({
    v: z.literal(ANALYTICS_JOB_VERSION),
    runId: uuid,
    type: z.literal(type),
    requestedAt: timestamp,
    ...shape,
  });

export const monteCarloJobSchema = job("monte_carlo", {
  params: object({
    horizonYears,
    paths,
    model: z.enum(["stationary_bootstrap", "parametric_t"]),
    meanBlockMonths: int(1, 24),
    historyWindow: z.enum(["full", "last_10y"]),
    contributions: z.array(cashFlowPlan).max(10),
    withdrawals: z.array(cashFlowPlan).max(10),
    inflationRate,
    taxMode: z.enum(["belka_simplified", "none"]),
    // TER + FX conversion as a fraction, deducted once a year (owner decision 2026-10-20).
    annualCostRate: ratio(0, 0.05),
    goal: positivePln.optional(),
  }).refine(
    (params) =>
      [...params.contributions, ...params.withdrawals].every(
        (flow) => flow.startYear <= flow.endYear && flow.endYear <= params.horizonYears,
      ),
    { message: "Cash flow years must fit the horizon" },
  ),
  portfolio: portfolioSnapshot,
  seed,
});

const optimizationBase = {
  instrumentIds: z
    .array(uuid)
    .min(2)
    .max(ANALYTICS_LIMITS.optimizationInstruments)
    .refine(unique, { message: "Duplicate instrument" }),
  window: dateRange,
  frequency: z.enum(["daily", "weekly"]),
  covariance: z.enum(["ledoit_wolf", "sample"]),
  minWeight: ratio(0, 0.5),
  maxWeight: ratio(0.01, 1),
  resamples: int(0, ANALYTICS_LIMITS.optimizationResamples),
};
const weightBounds = (params: { minWeight: number; maxWeight: number }) =>
  params.minWeight <= params.maxWeight;
export const optimizationJobSchema = job("optimization", {
  params: z
    .discriminatedUnion("method", [
      object({ method: z.enum(["min_variance", "hrp"]), ...optimizationBase }),
      object({
        method: z.enum(["max_sharpe", "efficient_frontier"]),
        ...optimizationBase,
        expectedReturns: z.enum(["shrinkage", "capm"]),
        riskFreeRate: ratio(0, 0.5),
      }),
      object({
        method: z.literal("black_litterman"),
        ...optimizationBase,
        riskFreeRate: ratio(0, 0.5),
        views: z
          .array(
            object({
              instrumentId: uuid,
              expectedReturn: ratio(-0.9, 2),
              confidence: ratio(0.01, 1),
            }),
          )
          .max(20),
      }),
    ])
    .refine(weightBounds, { message: "minWeight exceeds maxWeight" }),
  seed,
});

export const stressTestJobSchema = job("stress_test", {
  params: object({
    // Resolved by api from analytics.stress_scenarios (not readable by analytics_ro).
    historical: z
      .array(
        object({
          key: z.string().regex(/^[a-z0-9_]{3,40}$/),
          from: localDate,
          to: localDate,
        }).refine(ordered, { message: "Range must end after it starts" }),
      )
      .max(10),
    hypothetical: z
      .array(
        z.discriminatedUnion("kind", [
          object({ kind: z.literal("index_shock"), instrumentId: uuid, shock: ratio(-0.9, 0.9) }),
          object({
            kind: z.literal("fx_shock"),
            currency: z.enum(["USD", "EUR"]),
            shock: ratio(-0.9, 0.9),
          }),
          object({ kind: z.literal("correlation_shock"), correlation: ratio(0, 1) }),
        ]),
      )
      .max(10),
  }).refine((params) => params.historical.length + params.hypothetical.length > 0, {
    message: "At least one scenario is required",
  }),
  portfolio: portfolioSnapshot,
});

export const whatIfJobSchema = job("what_if", {
  params: object({
    changes: z
      .array(object({ instrumentId: uuid, proxyInstrumentId: uuid, amount: signedNonZeroPln }))
      .min(1)
      .max(10),
    windowYears: int(1, 10),
    frequency: z.enum(["daily", "weekly"]),
  }),
  portfolio: portfolioSnapshot,
});

const strategyOperand = z.union([
  object({
    indicator: z.enum([
      "close",
      "open",
      "sma",
      "ema",
      "rsi",
      "macd",
      "macd_signal",
      "bb_upper",
      "bb_lower",
      "atr",
    ]),
    params: z.array(z.number()).max(3),
  }),
  object({ value: z.number() }),
]);
const strategyCondition = object({
  left: strategyOperand,
  operator: z.enum(["gt", "lt", "crosses_above", "crosses_below"]),
  right: strategyOperand,
});
const strategyRuleGroup = object({
  all: z.array(strategyCondition).max(10).optional(),
  any: z.array(strategyCondition).max(10).optional(),
}).refine((group) => (group.all?.length ?? 0) + (group.any?.length ?? 0) > 0, {
  message: "Rule group needs a condition",
});
const gridCombinations = (grid: Record<string, number[]>) =>
  Object.values(grid).reduce((product, values) => product * values.length, 1);

export const backtestJobSchema = job("backtest", {
  params: object({
    // A saved strategy is inlined by api; strategy_definitions is a user table.
    strategy: object({
      version: z.literal(1),
      entry: strategyRuleGroup,
      exit: strategyRuleGroup,
      stopLossAtrMultiple: ratio(0.5, 10).optional(),
      maxHoldingDays: int(1, 1000).optional(),
    }),
    universe: z.discriminatedUnion("kind", [
      object({
        kind: z.literal("instruments"),
        instrumentIds: z
          .array(uuid)
          .min(1)
          .max(ANALYTICS_LIMITS.backtestUniverseInstruments)
          .refine(unique, { message: "Duplicate instrument" }),
      }),
      object({
        kind: z.literal("index_members_pit"),
        indexCode: z.enum(["WIG20", "mWIG40", "sWIG80"]),
      }),
      object({ kind: z.literal("gpw_all_pit") }),
    ]),
    period: dateRange,
    initialCapital: positivePln,
    costs: object({
      broker: z.enum(["xtb", "mbank", "custom"]),
      commissionRatio: ratio(0, 0.02),
      commissionMin: object({
        amount: z.string().regex(/^[0-9]{1,14}(\.[0-9]{1,8})?$/),
        currency: z.enum(["PLN", "USD", "EUR"]),
      }),
      fxCostRatio: ratio(0, 0.02),
      slippage: z.discriminatedUnion("kind", [
        object({ kind: z.literal("liquidity_buckets") }),
        object({ kind: z.literal("fixed"), ratio: ratio(0, 0.05) }),
      ]),
    }),
    tax: object({ enabled: z.boolean(), rate: ratio(0, 0.5) }),
    sizing: z.discriminatedUnion("method", [
      object({ method: z.literal("equal_weight"), maxPositions: int(1, 50) }),
      object({
        method: z.literal("fixed_fraction"),
        fraction: ratio(0.01, 1),
        maxPositions: int(1, 50),
      }),
      object({
        method: z.literal("vol_target"),
        targetVolatility: ratio(0.01, 1),
        maxPositions: int(1, 50),
      }),
    ]),
    validation: z.discriminatedUnion("mode", [
      object({ mode: z.literal("oos_split"), inSampleRatio: ratio(0.5, 0.9) }),
      object({
        mode: z.literal("walk_forward"),
        fitYears: int(1, 10),
        testYears: int(1, 5),
        stepYears: int(1, 5),
      }),
    ]),
    optimization: z.discriminatedUnion("enabled", [
      object({ enabled: z.literal(false) }),
      object({
        enabled: z.literal(true),
        grid: z
          .record(
            z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.]{0,63}$/),
            z.array(z.number()).min(1).max(ANALYTICS_LIMITS.backtestGridValues),
          )
          .refine((grid) => {
            const size = Object.keys(grid).length;
            return size >= 1 && size <= ANALYTICS_LIMITS.backtestGridParameters;
          }, "Grid needs 1–10 parameters")
          .refine(
            (grid) => gridCombinations(grid) <= ANALYTICS_LIMITS.backtestCombinations,
            "Too many combinations",
          ),
      }),
    ]),
    liquidity: object({ maxAdvRatio: ratio(0.001, 0.2), minMedianTurnover: nonNegativePln }),
    benchmarkId: uuid.optional(),
  }),
  seed,
});

export const goalJobSchema = job("goal", {
  params: object({
    target: positivePln,
    horizonYears,
    probabilities: z
      .array(z.union([z.literal(0.5), z.literal(0.75), z.literal(0.9)]))
      .min(1)
      .max(3)
      .refine(unique, { message: "Duplicate probability" }),
    paths,
    inflationRate,
  }),
  portfolio: portfolioSnapshot,
  seed,
});

export const analyticsJobSchema = z.discriminatedUnion("type", [
  monteCarloJobSchema,
  optimizationJobSchema,
  stressTestJobSchema,
  whatIfJobSchema,
  backtestJobSchema,
  goalJobSchema,
]);
export type AnalyticsJob = z.infer<typeof analyticsJobSchema>;

// Distribution only (FR-04.01): percentiles over time, never a single projected value.
const series = (max: number) => z.array(z.number()).max(max);
const months = ANALYTICS_LIMITS.horizonYears * 12 + 1;
const fan = object({
  p5: series(months),
  p25: series(months),
  p50: series(months),
  p75: series(months),
  p95: series(months),
});
export const monteCarloResultSchema = object({
  kind: z.literal("monte_carlo"),
  currency: z.literal("PLN"),
  months: z.array(z.int().min(0).max(months)).max(months),
  nominal: fan,
  real: fan,
  goalProbability: z.number().min(0).max(1).nullable(),
  maxDrawdownPercentiles: object({ p5: ratio(-1, 0), p50: ratio(-1, 0), p95: ratio(-1, 0) }),
  // Owner condition 2026-10-21: at least two block lengths besides the mean and window rows.
  sensitivity: z
    .array(
      z.discriminatedUnion("scenario", [
        object({
          scenario: z.enum(["mean_minus_2pp", "mean_plus_2pp", "last_10y", "full_history"]),
          annualCostRate: ratio(0, 0.05),
          endValueP5: z.number(),
          endValueP50: z.number(),
          goalProbability: z.number().min(0).max(1).nullable(),
        }),
        object({
          scenario: z.literal("block_length"),
          meanBlockMonths: int(1, 24),
          annualCostRate: ratio(0, 0.05),
          endValueP5: z.number(),
          endValueP50: z.number(),
          goalProbability: z.number().min(0).max(1).nullable(),
        }),
      ]),
    )
    .min(4)
    .max(6)
    .refine(
      (rows) =>
        new Set(rows.flatMap((r) => ("meanBlockMonths" in r ? [r.meanBlockMonths] : []))).size >= 2,
      { message: "Sensitivity needs at least two block lengths" },
    ),
});
const warning = object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/),
  severity: z.enum(["info", "warning", "critical"]),
  message: z.string().max(500),
});
const jsonValue = z.union([z.string().max(500), z.number(), z.boolean(), z.null()]);
// Shown to the user as the assumptions block (dane, okno, model, koszty, podatki, ziarno).
const assumptions = z.record(
  z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/),
  z.union([jsonValue, z.array(jsonValue).max(500), z.record(z.string().max(64), jsonValue)]),
);
const envelope = {
  v: z.literal(ANALYTICS_JOB_VERSION),
  runId: uuid,
  finishedAt: timestamp,
  durationMs: z.int().min(0),
};
export const analyticsResultSchema = z.discriminatedUnion("status", [
  object({
    ...envelope,
    status: z.literal("done"),
    result: monteCarloResultSchema,
    assumptions,
    warnings: z.array(warning).max(20),
    reproducibility: object({
      seed,
      algorithmVersion: z.string().regex(/^[a-z0-9_.-]{1,40}$/),
      dataVersion: z.record(z.string().max(80), z.string().max(80)),
      libraries: z.record(z.string().regex(/^[a-z0-9_.-]{1,40}$/), z.string().max(40)),
    }),
  }),
  object({
    ...envelope,
    status: z.literal("failed"),
    error: object({ code: z.enum(ANALYTICS_ERROR_CODES) }),
  }),
  // The worker stopped between steps after api set the cancel flag (BL-312).
  object({ ...envelope, status: z.literal("cancelled") }),
]);
export type AnalyticsResult = z.infer<typeof analyticsResultSchema>;
/** Progress reported through BullMQ `job.updateProgress` on the `analytics` queue. */
export const analyticsProgressSchema = object({
  progress: z.int().min(0).max(100),
  stage: z.enum(["loading_data", "simulating", "sensitivity", "summarizing"]),
});
/** Key in valkey-queue the worker polls between steps; api sets it on cancel (TTL 1 h). */
export const analyticsCancelKey = (runId: string) => `bull:analytics:cancel:${uuid.parse(runId)}`;

// Single artefact consumed by apps/analytics; regenerate with `pnpm gen:analytics-schema`.
export function analyticsContractDocument() {
  return {
    $comment: "Generated from packages/contracts/src/analytics-jobs.ts. Do not edit.",
    version: ANALYTICS_JOB_VERSION,
    jobTypes: ANALYTICS_JOB_TYPES,
    limits: ANALYTICS_LIMITS,
    timeoutsSeconds: ANALYTICS_TIMEOUTS_SECONDS,
    job: z.toJSONSchema(analyticsJobSchema),
    result: z.toJSONSchema(analyticsResultSchema),
    progress: z.toJSONSchema(analyticsProgressSchema),
  };
}
