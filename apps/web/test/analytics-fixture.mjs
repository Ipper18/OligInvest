const id = (suffix) => `01900000-0000-7000-8000-${String(suffix).padStart(12, "0")}`;
const months = Array.from({ length: 121 }, (_, i) => i);
const fan = {
  p5: months.map((n) => 10000 - n * 25),
  p25: months.map((n) => 10000 + n * 10),
  p50: months.map((n) => 10000 + n * 35),
  p75: months.map((n) => 10000 + n * 55),
  p95: months.map((n) => 10000 + n * 100),
};
const sensitivity = [
  "mean_minus_2pp",
  "mean_plus_2pp",
  "last_10y",
  "full_history",
  "block_length",
  "block_length",
].map((scenario, i) => ({
  scenario,
  ...(scenario === "block_length" ? { meanBlockMonths: i === 4 ? 3 : 12 } : {}),
  annualCostRate: 0.01,
  endValueP5: 7000,
  endValueP50: 14000,
  goalProbability: 0.35,
}));
const requirements = [0.5, 0.75, 0.9].map((probability, i) => ({
  probability,
  monthlyContribution: i === 2 ? null : { amount: i === 0 ? "500.00" : "900.00", currency: "PLN" },
  alreadyMet: false,
}));
export const analysisRuns = [
  {
    kind: "monte_carlo",
    currency: "PLN",
    months,
    nominal: fan,
    real: fan,
    goalProbability: 0.35,
    maxDrawdownPercentiles: { p5: -0.65, p50: -0.3, p95: -0.1 },
    sensitivity,
  },
  {
    kind: "stress_test",
    currency: "PLN",
    scenarios: [
      {
        key: "crisis_2008",
        name: "Kryzys finansowy 2008",
        kind: "historical",
        status: "ok",
        periodFrom: "2008-01-01",
        periodTo: "2009-03-01",
        portfolioReturn: -0.3,
        portfolioLoss: { amount: "-3000.00", currency: "PLN" },
        returnRange: { low: -0.55, high: 0.05, basis: "window_path" },
        coverageRatio: 1,
        ownHistoryRatio: 0.3,
        positions: [
          {
            instrumentId: id(99),
            proxyInstrumentId: id(98),
            series: "proxy",
            returnRatio: -0.3,
            illiquid: true,
          },
        ],
      },
      {
        key: "usd_shock",
        name: "Szok USD",
        kind: "hypothetical",
        shockKind: "fx_shock",
        shock: 0.2,
        shockCurrency: "USD",
        status: "ok",
        portfolioReturn: null,
        portfolioLoss: null,
        returnRange: { low: -0.1, high: 0.2, basis: "beta_ci90" },
        baselineRange: { low: -0.2, high: 0.1 },
        coverageRatio: 1,
        ownHistoryRatio: 1,
        positions: [],
      },
      {
        key: "no_history",
        name: "Brak historii",
        kind: "historical",
        status: "coverage_too_low",
        portfolioReturn: null,
        portfolioLoss: null,
        returnRange: null,
        coverageRatio: 0.2,
        ownHistoryRatio: 0,
        positions: [],
      },
    ],
  },
  {
    kind: "goal",
    target: { amount: "50000", currency: "PLN" },
    targetReal: { amount: "40000", currency: "PLN" },
    horizonYears: 10,
    requirements,
    sensitivity: sensitivity.map(({ scenario, meanBlockMonths }) => ({
      scenario,
      ...(meanBlockMonths ? { meanBlockMonths } : {}),
      requirements: requirements.map(({ alreadyMet: _a, ...r }) => r),
    })),
  },
].map((result, i) => ({
  id: id(i + 1),
  type: result.kind,
  status: "done",
  progress: 100,
  params: { horizonYears: 10, seed: 42, paths: 5000, annualCostRate: 0.01 },
  result,
  assumptions: {
    model: "stationary_bootstrap",
    historyFrom: "2000-01",
    historyTo: "2026-09",
    historyMonths: 321,
    meanBlockMonths: 6,
    annualCostRate: 0.01,
    inflationRate: 0.025,
    taxMode: "belka_simplified",
    portfolioAsOf: "2026-10-01",
  },
  warnings: [
    {
      code: "COSTS_NOT_MODELLED",
      severity: "warning",
      message: "Prowizje transakcyjne nie są uwzględnione.",
    },
  ],
  seriesMetadata: [
    {
      seriesKey: "WIG",
      meta: {
        source: "gpw",
        asOf: "2026-09-30T00:00:00Z",
        delayMinutes: 0,
        stale: false,
      },
    },
  ],
  compliance: {
    disclaimerKey: "analysis",
    disclaimerVersion: "2026-09",
    notInvestmentAdvice: true,
    howToReadKey: `analytics.${result.kind}.how_to_read`,
  },
  reproducibility: {
    seed: 42,
    algorithmVersion: "mc-1.0.0",
    dataVersion: { WIG: "2000-01..2026-09" },
    libraries: { numpy: "2.5.0" },
  },
  createdAt: "2026-10-01T10:00:00Z",
  finishedAt: "2026-10-01T10:00:04Z",
  durationMs: 4000,
}));
const state = new Map();
export async function analyticsFixture(request, response, key) {
  const url = new URL(request.url, "https://example.test");
  if (!url.pathname.startsWith("/api/v1/analytics/")) return false;
  const send = (body, status = 200) => {
    response.writeHead(status).end(JSON.stringify(body));
    return true;
  };
  const fail = (code, status) =>
    send({ type: "https://example.test/problems/analytics", title: code, status, code }, status);
  if (!key) return fail("UNAUTHENTICATED", 401);
  if (key.includes("no-analytics")) return fail("NOT_FOUND", 404);
  const role = key.includes("analytics-pro") || key === "fixture-perf" ? "pro" : "user";
  if (url.pathname.endsWith("/limits"))
    return send({
      role,
      heavyRunsPerDay: role === "user" ? null : 10,
      heavyRunsUsedToday: key.includes("quota") ? 9 : 0,
      bounds: { monteCarloPaths: 10000, horizonYears: 40 },
    });
  const runs = state.get(key) ?? structuredClone(analysisRuns);
  state.set(key, runs);
  if (url.pathname.endsWith("/runs")) {
    if (request.method === "POST") {
      if (role === "user") return fail("FORBIDDEN", 403);
      if (key.includes("quota")) {
        response.setHeader("Retry-After", "3600");
        response.setHeader("Date", "Sat, 07 Nov 2026 22:00:00 GMT");
        response.setHeader("Content-Type", "application/problem+json");
        return fail("QUOTA_EXCEEDED", 429);
      }
      let body = "";
      for await (const chunk of request) body += chunk;
      const input = JSON.parse(body);
      const run = structuredClone(analysisRuns.find((r) => r.type === input.type));
      run.params = input.params;
      return send(run, 202);
    }
    return send({ data: runs.map(({ result: _r, ...run }) => run), page: { hasMore: false } });
  }
  const runId = url.pathname.split("/")[5];
  const run = runs.find((r) => r.id === runId);
  if (!run) return fail("NOT_FOUND", 404);
  if (url.pathname.endsWith("/cancel")) {
    run.status = "cancelled";
    return send(run, 202);
  }
  const result = structuredClone(run);
  if (key.includes("legacy")) delete result.seriesMetadata;
  if (key.includes("stale")) {
    result.seriesMetadata[0].meta.stale = true;
    result.seriesMetadata[0].meta.staleReason = "data_quality_hold";
  }
  if (key.includes("failed")) {
    result.status = "failed";
    delete result.result;
    result.error = {
      code: "DATA_QUALITY_HOLD",
      message: "Seria danych czeka na weryfikację jakości.",
    };
  }
  if (key.includes("running") && result.status !== "cancelled") {
    result.status = "running";
    result.progress = 40;
    delete result.result;
  }
  return send(result);
}
