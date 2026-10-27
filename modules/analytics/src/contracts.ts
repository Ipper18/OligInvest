// HTTP contract of /analytics (docs/02-api/openapi.yaml, tag analytics). Every schema mirrors the
// document 1:1; `pnpm check:contracts` compares the generated OpenAPI with it.
import { z } from "@hono/zod-openapi";
import { ANALYTICS_ERROR_CODES } from "@oliginvest/contracts";
import { moneySchema, nullableMoney, object } from "@oliginvest/mod-portfolio/contracts";

const uuid = z.uuid();
const date = z.string().date();
const timestamp = z.string().datetime();
const numberSeries = z.array(z.number().nullable());
const timeAxis = z.array(z.number().int());
const oneOf = { unionPreferredType: "oneOf" as const };
const num = (minimum: number, maximum: number) => z.number().min(minimum).max(maximum);
const int = (minimum: number, maximum: number) => z.number().int().min(minimum).max(maximum);
const accountIds = z.array(uuid).max(20).optional();
// OpenAPI uses `const` for single values; zod-to-openapi would emit a one-element `enum`.
const constant = <T extends string | boolean | number>(value: T) =>
  z
    .custom<T>((input) => input === value)
    .openapi({
      type: typeof value === "number" ? "integer" : typeof value,
      const: value,
    } as never);
const seed = z.number().int().min(0).optional();

export const ANALYTICS_RUN_TYPES = [
  "monte_carlo",
  "optimization",
  "stress_test",
  "what_if",
  "backtest",
  "goal",
  "rebalance",
] as const;
export const analyticsRunType = z.enum(ANALYTICS_RUN_TYPES).openapi("AnalyticsRunType");
export const analyticsRunStatus = z
  .enum(["queued", "running", "done", "failed", "cancelled"])
  .openapi("AnalyticsRunStatus");
export const analyticsWarning = object({
  code: z.string(),
  severity: z.enum(["info", "warning", "critical"]),
  message: z.string(),
}).openapi("AnalyticsWarning");
export const complianceBlock = object({
  disclaimerKey: z.string(),
  disclaimerVersion: z.string(),
  notInvestmentAdvice: constant(true),
  howToReadKey: z.string().optional(),
}).openapi("ComplianceBlock");

const cashFlowPlan = object({
  amount: moneySchema,
  frequency: z.enum(["monthly", "quarterly", "yearly"]),
  startYear: int(0, 40).default(0),
  endYear: int(0, 40).optional(),
  indexToInflation: z.boolean().default(true),
}).openapi("CashFlowPlan");
export const monteCarloParams = object({
  accountIds,
  horizonYears: int(1, 40),
  paths: int(100, 10000).default(5000),
  model: z.enum(["stationary_bootstrap", "parametric_t"]).default("stationary_bootstrap"),
  meanBlockMonths: int(1, 24).default(6),
  historyWindow: z.enum(["full", "last_10y"]).default("full"),
  contributions: z.array(cashFlowPlan).max(10).optional(),
  withdrawals: z.array(cashFlowPlan).max(10).optional(),
  inflationRate: num(0, 0.2).default(0.025),
  taxMode: z.enum(["belka_simplified", "none"]).default("belka_simplified"),
  annualCostRate: num(0, 0.05).default(0),
  goal: moneySchema.optional(),
  proxyOverrides: z
    .array(object({ instrumentId: uuid, proxyInstrumentId: uuid }))
    .max(50)
    .optional(),
  seed,
}).openapi("MonteCarloParams");
const optimizationParams = object({
  instrumentIds: z.array(uuid).min(2).max(50).openapi({ uniqueItems: true }),
  method: z.enum(["min_variance", "hrp", "max_sharpe", "efficient_frontier", "black_litterman"]),
  window: object({ from: date, to: date }),
  frequency: z.enum(["daily", "weekly"]).default("weekly"),
  covariance: z.enum(["ledoit_wolf", "sample"]).default("ledoit_wolf"),
  minWeight: num(0, 0.5).default(0),
  maxWeight: num(0.01, 1).default(0.2),
  expectedReturns: z.enum(["shrinkage", "capm"]).optional(),
  views: z
    .array(
      object({
        instrumentId: uuid,
        expectedReturn: num(-0.9, 2),
        confidence: num(0.01, 1),
      }),
    )
    .max(20)
    .optional(),
  resamples: int(0, 500).default(200),
  riskFreeRate: num(0, 0.5).optional(),
}).openapi("OptimizationParams");
export const stressHypothetical = object({
  kind: z.enum(["index_shock", "fx_shock", "correlation_shock"]),
  instrumentId: uuid.optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  shock: num(-0.9, 0.9).optional(),
  correlation: num(0, 1).optional(),
});
export const stressTestParams = object({
  accountIds,
  historical: z
    .array(z.string().regex(/^[a-z0-9_]{3,40}$/))
    .max(10)
    .optional(),
  hypothetical: z.array(stressHypothetical).max(10).optional(),
}).openapi("StressTestParams", { minProperties: 1 });
export type StressTestParams = z.infer<typeof stressTestParams>;
const whatIfParams = object({
  accountIds,
  changes: z
    .array(object({ instrumentId: uuid, amount: moneySchema }))
    .min(1)
    .max(10),
  windowYears: int(1, 10).default(3),
  frequency: z.enum(["daily", "weekly"]).default("weekly"),
}).openapi("WhatIfParams");
const strategyOperand = z
  .union([
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
      params: z.array(z.number()).max(3).optional(),
    }),
    object({ value: z.number() }),
  ])
  .openapi("StrategyOperand", {}, oneOf);
const strategyCondition = object({
  left: strategyOperand,
  operator: z.enum(["gt", "lt", "crosses_above", "crosses_below"]),
  right: strategyOperand,
}).openapi("StrategyCondition");
const strategyRuleGroup = object({
  all: z.array(strategyCondition).max(10).optional(),
  any: z.array(strategyCondition).max(10).optional(),
}).openapi("StrategyRuleGroup", { minProperties: 1 });
const strategyDefinition = object({
  version: constant(1),
  entry: strategyRuleGroup,
  exit: strategyRuleGroup,
  stopLossAtrMultiple: num(0.5, 10).optional(),
  maxHoldingDays: int(1, 1000).optional(),
}).openapi("StrategyDefinition");
const backtestParams = object({
  strategyId: uuid.optional(),
  strategy: strategyDefinition.optional(),
  universe: object({
    kind: z.enum(["instruments", "index_members_pit", "gpw_all_pit"]),
    instrumentIds: z.array(uuid).max(100).optional(),
    indexCode: z.enum(["WIG20", "mWIG40", "sWIG80"]).optional(),
  }),
  from: date,
  to: date,
  initialCapital: moneySchema,
  costs: object({
    broker: z.enum(["xtb", "mbank", "custom"]).default("xtb"),
    commissionRatio: num(0, 0.02).optional(),
    commissionMin: moneySchema.optional(),
    fxCostRatio: num(0, 0.02).default(0.005),
    slippage: z.enum(["liquidity_buckets", "fixed"]).default("liquidity_buckets"),
    fixedSlippageRatio: num(0, 0.05).optional(),
  }).optional(),
  tax: object({
    enabled: z.boolean().default(true),
    rate: num(0, 0.5).default(0.19),
  }).optional(),
  sizing: object({
    method: z.enum(["equal_weight", "fixed_fraction", "vol_target"]).default("equal_weight"),
    fraction: num(0.01, 1).optional(),
    targetVolatility: num(0.01, 1).optional(),
    maxPositions: int(1, 50).default(10),
  }).optional(),
  validation: object({
    mode: z.enum(["oos_split", "walk_forward"]).default("walk_forward"),
    inSampleRatio: num(0.5, 0.9).default(0.7),
    fitYears: int(1, 10).default(3),
    testYears: int(1, 5).default(1),
    stepYears: int(1, 5).default(1),
  }).optional(),
  optimization: object({
    enabled: z.boolean().default(false),
    grid: z.record(z.string(), z.array(z.number()).min(1).max(20)).optional(),
  }).optional(),
  liquidity: object({
    maxAdvRatio: num(0.001, 0.2).default(0.05),
    minMedianTurnover: moneySchema.optional(),
  }).optional(),
  benchmarkId: uuid.optional(),
  seed,
})
  .refine((p) => (p.strategyId === undefined) !== (p.strategy === undefined))
  .openapi("BacktestParams", { oneOf: [{ required: ["strategyId"] }, { required: ["strategy"] }] });
export const goalParams = object({
  accountIds,
  target: moneySchema,
  horizonYears: int(1, 40),
  probabilities: z
    .array(
      z
        .number()
        .refine((p) => [0.5, 0.75, 0.9].includes(p))
        .openapi({ enum: [0.5, 0.75, 0.9] }),
    )
    .min(1)
    .max(3)
    .default([0.5, 0.75, 0.9]),
  paths: int(100, 10000).default(5000),
  inflationRate: num(0, 0.2).default(0.025),
  indexToInflation: z.boolean().default(true),
  taxMode: z.enum(["belka_simplified", "none"]).default("belka_simplified"),
  annualCostRate: num(0, 0.05).default(0),
  seed,
}).openapi("GoalParams");
export type GoalParams = z.infer<typeof goalParams>;
const targetWeight = object({
  instrumentId: uuid.optional(),
  assetClass: z.string().optional(),
  weight: num(0, 1),
})
  .refine((t) => (t.instrumentId === undefined) !== (t.assetClass === undefined))
  .openapi("TargetWeight", {
    oneOf: [{ required: ["instrumentId"] }, { required: ["assetClass"] }],
  });
const rebalanceParams = object({
  accountId: uuid,
  targetId: uuid.optional(),
  targets: z.array(targetWeight).min(1).max(50).optional(),
  tolerance: num(0, 0.5).default(0.05),
  mode: z.enum(["full", "buy_only"]),
  newCash: moneySchema.optional(),
  minOrderValue: moneySchema.optional(),
  allowFractional: z.boolean().default(false),
  estimateTax: z.boolean().default(true),
})
  .refine((p) => (p.targetId === undefined) !== (p.targets === undefined))
  .openapi("RebalanceParams", { oneOf: [{ required: ["targetId"] }, { required: ["targets"] }] });

const runInput = <T extends (typeof ANALYTICS_RUN_TYPES)[number], P extends z.ZodType>(
  type: T,
  params: P,
  name: string,
) => object({ type: constant(type), params }).openapi(name);
export const monteCarloRunInput = runInput("monte_carlo", monteCarloParams, "MonteCarloRunInput");
const RUN_INPUT_NAMES = {
  monte_carlo: "MonteCarloRunInput",
  optimization: "OptimizationRunInput",
  stress_test: "StressTestRunInput",
  what_if: "WhatIfRunInput",
  backtest: "BacktestRunInput",
  goal: "GoalRunInput",
  rebalance: "RebalanceRunInput",
} as const;
const mapping = (names: Record<string, string>) =>
  Object.fromEntries(Object.entries(names).map(([k, v]) => [k, `#/components/schemas/${v}`]));
export const analyticsRunInput = z
  .union([
    monteCarloRunInput,
    runInput("optimization", optimizationParams, "OptimizationRunInput"),
    runInput("stress_test", stressTestParams, "StressTestRunInput"),
    runInput("what_if", whatIfParams, "WhatIfRunInput"),
    runInput("backtest", backtestParams, "BacktestRunInput"),
    runInput("goal", goalParams, "GoalRunInput"),
    runInput("rebalance", rebalanceParams, "RebalanceRunInput"),
  ])
  .openapi(
    "AnalyticsRunInput",
    { discriminator: { propertyName: "type", mapping: mapping(RUN_INPUT_NAMES) } },
    oneOf,
  );
export type AnalyticsRunInput = z.infer<typeof analyticsRunInput>;
export type MonteCarloParams = z.infer<typeof monteCarloParams>;

const percentileFan = object({
  p5: numberSeries,
  p25: numberSeries,
  p50: numberSeries,
  p75: numberSeries,
  p95: numberSeries,
}).openapi("PercentileFan");
const monteCarloResult = object({
  kind: constant("monte_carlo"),
  currency: z.string().regex(/^[A-Z]{3}$/),
  months: z.array(z.number().int()),
  nominal: percentileFan,
  real: percentileFan.optional(),
  goalProbability: z.number().nullable().optional(),
  maxDrawdownPercentiles: object({
    p5: z.number().optional(),
    p50: z.number().optional(),
    p95: z.number().optional(),
  }).optional(),
  sensitivity: z.array(
    object({
      scenario: z.enum([
        "mean_minus_2pp",
        "mean_plus_2pp",
        "last_10y",
        "full_history",
        "block_length",
      ]),
      meanBlockMonths: int(1, 24).optional(),
      annualCostRate: z.number().optional(),
      endValueP5: z.number(),
      endValueP50: z.number(),
      goalProbability: z.number().nullable().optional(),
    }),
  ),
}).openapi("MonteCarloResult");
const optimizationResult = object({
  kind: constant("optimization"),
  method: z.string(),
  weights: z.array(
    object({
      instrumentId: uuid,
      weight: z.number(),
      weightP5: z.number(),
      weightP95: z.number(),
      currentWeight: z.number().nullable().optional(),
    }),
  ),
  expectedVolatility: z.number(),
  expectedReturn: z.number().nullable().optional(),
  frontier: object({
    volatility: numberSeries.optional(),
    return: numberSeries.optional(),
  }).optional(),
}).openapi("OptimizationResult");
const nullableNumber = z.number().nullable();
const stressTestResult = object({
  kind: constant("stress_test"),
  currency: z.string().regex(/^[A-Z]{3}$/),
  scenarios: z.array(
    object({
      key: z.string(),
      name: z.string(),
      kind: z.enum(["historical", "hypothetical"]),
      shockKind: z.enum(["index_shock", "fx_shock", "correlation_shock"]).optional(),
      shock: z.number().optional(),
      shockInstrumentId: uuid.optional(),
      shockCurrency: z
        .string()
        .regex(/^[A-Z]{3}$/)
        .optional(),
      correlation: z.number().optional(),
      status: z.enum(["ok", "coverage_too_low", "insufficient_data"]),
      periodFrom: date.optional(),
      periodTo: date.optional(),
      troughDate: z.union([date, z.null()]).openapi({}, oneOf).optional(),
      portfolioReturn: nullableNumber,
      portfolioLoss: nullableMoney,
      returnRange: z
        .union([
          object({
            low: z.number(),
            high: z.number(),
            basis: z.enum(["window_path", "beta_ci90", "one_month_p5_p95"]),
          }),
          z.null(),
        ])
        .openapi({}, oneOf),
      baselineRange: object({ low: z.number(), high: z.number() }).optional(),
      translationReturn: nullableNumber.optional(),
      coverageRatio: z.number(),
      ownHistoryRatio: z.number(),
      positions: z.array(
        object({
          instrumentId: uuid,
          proxyInstrumentId: uuid.optional(),
          series: z.enum(["instrument", "proxy", "none"]),
          returnRatio: nullableNumber,
          localReturnRatio: nullableNumber.optional(),
          proxyReturnRatio: nullableNumber.optional(),
          loss: nullableMoney.optional(),
          beta: nullableNumber.optional(),
          betaLow: nullableNumber.optional(),
          betaHigh: nullableNumber.optional(),
          volatility: nullableNumber.optional(),
          illiquid: z.boolean().optional(),
        }),
      ),
    }),
  ),
}).openapi("StressTestResult");
const riskSnapshot = object({
  volatility: z.number(),
  maxDrawdown: z.number(),
  largestWeight: z.number(),
  averageCorrelation: z.number(),
  currencyShares: z.record(z.string(), z.number()).optional(),
}).openapi("RiskSnapshot");
const whatIfResult = object({
  kind: constant("what_if"),
  before: riskSnapshot,
  after: riskSnapshot,
}).openapi("WhatIfResult");
const backtestStats = object({
  cagr: z.number().nullable().optional(),
  volatility: z.number().nullable().optional(),
  sharpe: z.number().nullable().optional(),
  sortino: z.number().nullable().optional(),
  maxDrawdown: z.number().nullable().optional(),
  trades: z.number().int().optional(),
  turnover: z.number().nullable().optional(),
  costs: moneySchema.optional(),
  taxes: moneySchema.optional(),
}).openapi("BacktestStats");
const backtestResult = object({
  kind: constant("backtest"),
  summary: backtestStats,
  inSample: backtestStats.optional(),
  outOfSample: backtestStats,
  walkForward: z
    .array(
      object({
        fitFrom: date,
        fitTo: date,
        testFrom: date,
        testTo: date,
        params: z.record(z.string(), z.unknown()).optional(),
        stats: backtestStats,
      }),
    )
    .optional(),
  equity: object({ t: timeAxis, strategy: numberSeries, benchmark: numberSeries.optional() }),
  deflatedSharpe: object({ value: z.number().nullable(), trials: z.number().int().min(1) }),
  overfitting: object({ oosToIsRatio: z.number().nullable().optional(), flagged: z.boolean() }),
  regimes: z
    .array(
      object({
        label: z.string(),
        from: date.optional(),
        to: date.optional(),
        return: z.number().nullable().optional(),
        sharpe: z.number().nullable().optional(),
      }),
    )
    .optional(),
  survivorshipWarning: z.boolean(),
  lookAheadCheck: z.enum(["passed", "failed"]),
}).openapi("BacktestResult");
const goalResult = object({
  kind: constant("goal"),
  target: moneySchema,
  targetReal: moneySchema,
  horizonYears: z.number().int(),
  requirements: z.array(
    object({
      probability: z.number(),
      monthlyContribution: nullableMoney,
      alreadyMet: z.boolean(),
    }),
  ),
  sensitivity: z.array(
    object({
      scenario: z.enum([
        "mean_minus_2pp",
        "mean_plus_2pp",
        "last_10y",
        "full_history",
        "block_length",
      ]),
      meanBlockMonths: int(1, 24).optional(),
      requirements: z.array(
        object({ probability: z.number(), monthlyContribution: nullableMoney }),
      ),
    }),
  ),
}).openapi("GoalResult");
const decimalString = z
  .string()
  .regex(/^-?\d{1,14}(\.\d{1,10})?$/)
  .openapi("DecimalString");
const weightRow = object({ key: z.string(), weight: z.number() }).openapi("WeightRow");
const rebalanceResult = object({
  kind: constant("rebalance"),
  orders: z.array(
    object({
      instrumentId: uuid,
      side: z.enum(["BUY", "SELL"]),
      quantity: decimalString,
      estimatedPrice: decimalString.optional(),
      value: moneySchema,
      commission: moneySchema.optional(),
      fxCost: moneySchema.optional(),
      estimatedTax: moneySchema.optional(),
    }),
  ),
  before: z.array(weightRow),
  after: z.array(weightRow),
  skippedWithinTolerance: z.array(uuid).optional(),
  cashRemaining: moneySchema,
  totalCosts: moneySchema,
}).openapi("RebalanceResult");
export const analyticsResult = z
  .union([
    monteCarloResult,
    optimizationResult,
    stressTestResult,
    whatIfResult,
    backtestResult,
    goalResult,
    rebalanceResult,
  ])
  .openapi(
    "AnalyticsResult",
    {
      discriminator: {
        propertyName: "kind",
        mapping: mapping({
          monte_carlo: "MonteCarloResult",
          optimization: "OptimizationResult",
          stress_test: "StressTestResult",
          what_if: "WhatIfResult",
          backtest: "BacktestResult",
          goal: "GoalResult",
          rebalance: "RebalanceResult",
        }),
      },
    },
    oneOf,
  );

export const analyticsRun = object({
  id: uuid,
  type: analyticsRunType,
  status: analyticsRunStatus,
  progress: int(0, 100),
  params: z.record(z.string(), z.unknown()),
  result: analyticsResult.optional(),
  assumptions: z.record(z.string(), z.unknown()).optional(),
  warnings: z.array(analyticsWarning).optional(),
  compliance: complianceBlock,
  reproducibility: object({
    seed: z.number().int().optional(),
    algorithmVersion: z.string().optional(),
    dataVersion: z.record(z.string(), z.unknown()).optional(),
    libraries: z.record(z.string(), z.string()).optional(),
  }).optional(),
  error: object({
    code: z.enum(ANALYTICS_ERROR_CODES),
    message: z.string(),
  }).optional(),
  createdAt: timestamp,
  startedAt: timestamp.optional(),
  finishedAt: timestamp.optional(),
  durationMs: z.number().int().min(0).optional(),
}).openapi("AnalyticsRun");
export type AnalyticsRun = z.infer<typeof analyticsRun>;
export const analyticsRunPage = object({
  data: z.array(analyticsRun),
  page: object({
    hasMore: z.boolean(),
    nextCursor: z.string().max(512).optional(),
  }).openapi("PageInfo"),
}).openapi("AnalyticsRunPage");
export const analyticsLimits = object({
  role: z.enum(["user", "pro", "admin"]).openapi("Role"),
  heavyRunsPerDay: z.number().int().nullable().optional(),
  heavyRunsUsedToday: z.number().int(),
  bounds: z.record(z.string(), z.number()),
  timeoutsSeconds: z.record(z.string(), z.number().int()).optional(),
}).openapi("AnalyticsLimits");

/** § 12.3: built-in scenario or the `analytics.stress_scenarios` row with the same key. */
export const stressScenario = object({
  key: z.string().regex(/^[a-z0-9_]{3,40}$/),
  name: z.string().max(80),
  kind: z.enum(["historical", "hypothetical"]),
  startDate: date.optional(),
  endDate: date.optional(),
  shocks: z.record(z.string(), z.unknown()).optional(),
  description: z.string().max(1000),
  enabled: z.boolean(),
}).openapi("StressScenario");
export type StressScenario = z.infer<typeof stressScenario>;
export const stressScenarioList = object({ data: z.array(stressScenario) });
