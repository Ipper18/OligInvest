import { createHash, randomInt } from "node:crypto";
import {
  ANALYTICS_ERROR_CODES,
  ANALYTICS_LIMITS,
  ANALYTICS_TIMEOUTS_SECONDS,
  type AnalyticsJob,
  goalJobSchema,
  monteCarloJobSchema,
  stressTestJobSchema,
} from "@oliginvest/contracts";
import { Decimal, roundHalfUp, toDecimal } from "@oliginvest/core";
import type { AppDatabase, DatabaseContext, DatabaseTransaction } from "@oliginvest/db";
import { ProblemError } from "@oliginvest/platform";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  type AnalyticsRun,
  type AnalyticsRunInput,
  type GoalParams,
  type MonteCarloParams,
  type StressScenario,
  type StressTestParams,
  stressHypothetical,
  stressScenario,
} from "../contracts.js";

/** Heavy analyses need `analytics:run:heavy` and count against the daily role quota (FR-07.06). */
export const HEAVY_TYPES = new Set([
  "monte_carlo",
  "optimization",
  "stress_test",
  "backtest",
  "goal",
]);
/** Types computed by this release; the remaining FR-04 analyses answer 404 until implemented. */
export const IMPLEMENTED_TYPES = new Set(["monte_carlo", "stress_test", "goal"]);
/** Used when `platform.role_limits` has no row (example value of schema.sql). */
export const DEFAULT_HEAVY_RUNS_PER_DAY = 20;
export const ALGORITHM_VERSIONS = {
  monte_carlo: "mc-1.0.0",
  stress_test: "stress-1.0.0",
  goal: "goal-1.0.0",
} as const;
/** § 12.3 defaults; a row of `analytics.stress_scenarios` with the same key replaces one. */
export const BUILTIN_STRESS_SCENARIOS: readonly StressScenario[] = [
  {
    key: "gfc_2008",
    name: "Kryzys finansowy 2008",
    kind: "historical",
    startDate: "2008-09-01",
    endDate: "2009-03-09",
    shocks: {},
    description: "Od upadku Lehman Brothers do dna rynków akcji w marcu 2009 (§ 12.3).",
    enabled: true,
  },
  {
    key: "covid_2020",
    name: "Krach pandemiczny 2020",
    kind: "historical",
    startDate: "2020-02-19",
    endDate: "2020-03-23",
    shocks: {},
    description: "Spadek rynków od szczytu z lutego do dna z marca 2020 (§ 12.3).",
    enabled: true,
  },
  {
    key: "inflation_2022",
    name: "Inflacja i podwyżki stóp 2022",
    kind: "historical",
    startDate: "2022-01-03",
    endDate: "2022-10-12",
    shocks: {},
    description: "Wzrost inflacji i stóp procentowych, spadek akcji i obligacji (§ 12.3).",
    enabled: true,
  },
];
/** Admin windows longer than this are skipped (§ 12.3: data volume of the job). */
export const MAX_SCENARIO_DAYS = 1096;
const DEFAULT_CORRELATION = 0.9;
const DISCLAIMER = { key: "analysis", version: "2026-09" } as const;
const ERROR_MESSAGES: Record<(typeof ANALYTICS_ERROR_CODES)[number], string> = {
  TIMEOUT: "Analiza przekroczyła limit czasu.",
  MEMORY_LIMIT: "Analiza przekroczyła limit pamięci.",
  INSUFFICIENT_DATA: "Za mało danych historycznych do analizy.",
  COVERAGE_TOO_LOW: "Dane obejmują zbyt małą część portfela.",
  INVALID_PARAMS: "Parametry analizy są nieprawidłowe.",
  INTERNAL: "Analiza nie powiodła się z przyczyn technicznych.",
  DATA_QUALITY_HOLD: "Seria danych wejściowych czeka na weryfikację jakości.",
};
// Proxy series of § 12.1: GPW listings → WIG, other listings → S&P 500, cash → risk-free rate.
// US listings use S&P 500 with dividends (^SP500TR, NIEZWERYFIKOWANE on Yahoo); without its
// bars the price index ^GSPC stands in, with a visible warning (owner decision 2026-10-20).
const PROXIES = {
  gpw: { mic: "XWAR", ticker: "WIG" },
  other: { mic: "XNYS", ticker: "^SP500TR" },
  otherFallback: { mic: "XNYS", ticker: "^GSPC" },
};

export interface AnalyticsQueue {
  enqueue(job: AnalyticsJob): Promise<void>;
  /** Removes a waiting job; `false` when a worker already took it. */
  remove(runId: string): Promise<boolean>;
  /** Sets the flag the worker checks between steps. */
  requestCancel(runId: string): Promise<void>;
}
type Role = "user" | "pro" | "admin";
type Owner = DatabaseContext & { userId: string; role: Role };
const runRow = z
  .object({
    id: z.uuid(),
    type: z.string(),
    status: z.enum(["queued", "running", "done", "failed", "cancelled"]),
    progress: z.number().int(),
    params: z.record(z.string(), z.unknown()),
    result: z.unknown().nullable(),
    assumptions: z.record(z.string(), z.unknown()).nullable(),
    warnings: z.array(z.unknown()),
    seed: z.union([z.string(), z.number()]).nullable(),
    algorithmVersion: z.string(),
    dataVersion: z.record(z.string(), z.unknown()).nullable(),
    error: z.string().nullable(),
    createdAt: z.union([z.string(), z.date()]),
    startedAt: z.union([z.string(), z.date()]).nullable(),
    finishedAt: z.union([z.string(), z.date()]).nullable(),
    durationMs: z.number().int().nullable(),
  })
  .strict();
const iso = (value: string | Date) => new Date(value).toISOString().replace(/\.\d{3}Z$/u, "Z");
const SELECT_RUN = sql`SELECT id::text,type,status,progress,params,result,assumptions,warnings,seed::text AS seed,algorithm_version AS "algorithmVersion",data_version AS "dataVersion",error,created_at AS "createdAt",started_at AS "startedAt",finished_at AS "finishedAt",duration_ms AS "durationMs" FROM analytics.analytics_runs`;

export function runDto(raw: unknown, full = true): AnalyticsRun {
  const row = runRow.parse(raw);
  const code = z.enum(ANALYTICS_ERROR_CODES).safeParse(row.error);
  const data = (row.dataVersion ?? {}) as { series?: unknown; libraries?: unknown };
  return {
    id: row.id,
    type: row.type as AnalyticsRun["type"],
    status: row.status,
    progress: row.progress,
    params: row.params,
    ...(full && row.result ? { result: row.result as AnalyticsRun["result"] } : {}),
    ...(row.assumptions ? { assumptions: row.assumptions } : {}),
    warnings: row.warnings as AnalyticsRun["warnings"],
    compliance: {
      disclaimerKey: DISCLAIMER.key,
      disclaimerVersion: DISCLAIMER.version,
      notInvestmentAdvice: true,
      howToReadKey: `analytics.${row.type}.how_to_read`,
    },
    reproducibility: {
      ...(row.seed === null ? {} : { seed: Number(row.seed) }),
      algorithmVersion: row.algorithmVersion,
      ...(data.series ? { dataVersion: data.series as Record<string, unknown> } : {}),
      ...(data.libraries ? { libraries: data.libraries as Record<string, string> } : {}),
    },
    ...(code.success ? { error: { code: code.data, message: ERROR_MESSAGES[code.data] } } : {}),
    createdAt: iso(row.createdAt),
    ...(row.startedAt ? { startedAt: iso(row.startedAt) } : {}),
    ...(row.finishedAt ? { finishedAt: iso(row.finishedAt) } : {}),
    ...(row.durationMs === null ? {} : { durationMs: row.durationMs }),
  };
}

const outOfBounds = (path: string, code: string, message: string) =>
  new ProblemError("PARAMETERS_OUT_OF_BOUNDS", { errors: [{ path, code, message }] });
const grosze = (value: Decimal) => roundHalfUp(value, 2).toFixed(2);

export class AnalyticsRepository {
  constructor(
    readonly database: AppDatabase,
    private readonly queue: () => AnalyticsQueue | Promise<AnalyticsQueue>,
    readonly now: () => Date = () => new Date(),
  ) {}

  private warsawDayStart() {
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Warsaw",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(this.now());
    return day;
  }

  async limits(context: Owner) {
    return this.database.transaction(context, async (tx) => {
      const perDay = await this.heavyPerDay(tx, context.role);
      return {
        role: context.role,
        heavyRunsPerDay: perDay,
        heavyRunsUsedToday: await this.heavyUsedToday(tx),
        bounds: {
          monteCarloPaths: ANALYTICS_LIMITS.monteCarloPaths,
          horizonYears: ANALYTICS_LIMITS.horizonYears,
          optimizationInstruments: ANALYTICS_LIMITS.optimizationInstruments,
          optimizationResamples: ANALYTICS_LIMITS.optimizationResamples,
          backtestCombinations: ANALYTICS_LIMITS.backtestCombinations,
        },
        timeoutsSeconds: { ...ANALYTICS_TIMEOUTS_SECONDS },
      };
    });
  }

  private async heavyPerDay(tx: DatabaseTransaction, role: Role): Promise<number | null> {
    if (role === "user") return null;
    const row = (await tx.execute(sql`SELECT limits FROM platform.role_limits WHERE role=${role}`))
      .rows[0];
    const configured = z
      .object({ analytics_heavy_per_day: z.number().int().min(0).optional() })
      .loose()
      .safeParse(row?.limits);
    return configured.success && configured.data.analytics_heavy_per_day !== undefined
      ? configured.data.analytics_heavy_per_day
      : DEFAULT_HEAVY_RUNS_PER_DAY;
  }

  private async heavyUsedToday(tx: DatabaseTransaction) {
    const row = (
      await tx.execute(
        sql`SELECT count(*)::int AS count FROM analytics.analytics_runs WHERE type=ANY(${sql.param([...HEAVY_TYPES])}::text[]) AND created_at>=(${this.warsawDayStart()}::date::timestamp AT TIME ZONE 'Europe/Warsaw')`,
      )
    ).rows[0];
    return z.number().int().parse(row?.count);
  }

  /** Validated input → run row (RLS owner) → job in the queue after commit (ADR-003 § 4). */
  async create(context: Owner, input: AnalyticsRunInput, key: string) {
    if (!IMPLEMENTED_TYPES.has(input.type)) throw new ProblemError("NOT_FOUND");
    if (HEAVY_TYPES.has(input.type) && context.role === "user") throw new ProblemError("FORBIDDEN");
    const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const created = await this.database.transaction(context, async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`analytics:${context.userId}`},0))`,
      );
      await tx.execute(
        sql`DELETE FROM platform.idempotency_keys WHERE key=${key} AND expires_at<=now()`,
      );
      const old = (
        await tx.execute(
          sql`SELECT path,request_hash,response_body FROM platform.idempotency_keys WHERE key=${key}`,
        )
      ).rows[0];
      if (old) {
        if (old.path !== "/analytics/runs" || old.request_hash !== hash)
          throw new ProblemError("IDEMPOTENCY_CONFLICT");
        return { run: old.response_body as AnalyticsRun, job: undefined };
      }
      if (HEAVY_TYPES.has(input.type)) {
        const perDay = await this.heavyPerDay(tx, context.role);
        if (perDay === null) throw new ProblemError("FORBIDDEN");
        if ((await this.heavyUsedToday(tx)) >= perDay)
          throw new ProblemError("QUOTA_EXCEEDED", { retryAfterSeconds: 3600 });
      }
      const requestedAt = iso(this.now());
      const prepared = await this.prepare(tx, input);
      const row = (
        await tx.execute(
          sql`INSERT INTO analytics.analytics_runs(user_id,type,params,input_snapshot,assumptions,warnings,seed,algorithm_version) VALUES(${context.userId}::uuid,${input.type},${JSON.stringify(prepared.stored)}::jsonb,${JSON.stringify({ portfolio: prepared.portfolio })}::jsonb,${JSON.stringify(prepared.assumptions)}::jsonb,${JSON.stringify(prepared.warnings)}::jsonb,${prepared.seed},${prepared.algorithm}) RETURNING id::text,created_at AS "createdAt"`,
        )
      ).rows[0];
      const runId = z.uuid().parse(row?.id);
      const job = prepared.job(runId, requestedAt);
      if (Buffer.byteLength(JSON.stringify(job)) > ANALYTICS_LIMITS.jobPayloadBytes)
        throw outOfBounds("portfolio", "too_large", "Migawka portfela jest zbyt duża.");
      const run = runDto((await tx.execute(sql`${SELECT_RUN} WHERE id=${runId}::uuid`)).rows[0]);
      await tx.execute(
        sql`INSERT INTO platform.idempotency_keys(user_id,key,method,path,request_hash,status_code,response_body,expires_at) VALUES(${context.userId}::uuid,${key},'POST','/analytics/runs',${hash},202,${JSON.stringify(run)}::jsonb,now()+interval '24 hours')`,
      );
      return { run, job };
    });
    if (created.job) {
      try {
        await (await this.queue()).enqueue(created.job);
      } catch {
        await this.finish(context, created.run.id, "failed", "INTERNAL");
        throw new ProblemError("SERVICE_UNAVAILABLE", { retryAfterSeconds: 30 });
      }
    }
    return created.run;
  }

  /** Defaults made explicit, snapshot and the queue job of one run type (moduly.md § 5.2.1). */
  private async prepare(tx: DatabaseTransaction, input: AnalyticsRunInput) {
    if (input.type === "stress_test") return this.prepareStress(tx, input.params);
    if (input.type === "goal") {
      const params = goalDefaults(input.params as GoalParams);
      const { portfolio, assumptions, warnings } = await this.snapshot(tx, params);
      const seed = params.seed ?? randomInt(0, 2 ** 47);
      return {
        stored: { ...params, seed },
        portfolio,
        assumptions,
        warnings,
        seed,
        algorithm: ALGORITHM_VERSIONS.goal,
        job: (runId: string, requestedAt: string): AnalyticsJob =>
          goalJobSchema.parse({
            v: 1,
            runId,
            type: "goal",
            requestedAt,
            params: {
              target: params.target,
              horizonYears: params.horizonYears,
              probabilities: params.probabilities,
              paths: params.paths,
              inflationRate: params.inflationRate,
              indexToInflation: params.indexToInflation,
              taxMode: params.taxMode,
              annualCostRate: params.annualCostRate,
            },
            portfolio,
            seed,
          }),
      };
    }
    const params = monteCarloDefaults(input.params as MonteCarloParams);
    const { portfolio, assumptions, warnings } = await this.snapshot(tx, params);
    const seed = params.seed ?? randomInt(0, 2 ** 47);
    return {
      stored: { ...params, seed },
      portfolio,
      assumptions,
      warnings,
      seed,
      algorithm: ALGORITHM_VERSIONS.monte_carlo,
      job: (runId: string, requestedAt: string): AnalyticsJob =>
        monteCarloJobSchema.parse({
          v: 1,
          runId,
          type: "monte_carlo",
          requestedAt,
          params: {
            horizonYears: params.horizonYears,
            paths: params.paths,
            model: params.model,
            meanBlockMonths: params.meanBlockMonths,
            historyWindow: params.historyWindow,
            contributions: params.contributions,
            withdrawals: params.withdrawals,
            inflationRate: params.inflationRate,
            taxMode: params.taxMode,
            annualCostRate: params.annualCostRate,
            ...(params.goal ? { goal: params.goal } : {}),
          },
          portfolio,
          seed,
        }),
    };
  }

  /** § 12.3: scenarios resolved here (the worker cannot read analytics tables), no seed. */
  private async prepareStress(tx: DatabaseTransaction, raw: unknown) {
    const params = raw as StressTestParams;
    const hypothetical = stressShocks(params.hypothetical ?? []);
    const factors = [
      ...new Set(hypothetical.flatMap((h) => (h.kind === "index_shock" ? [h.instrumentId] : []))),
    ];
    if (factors.length) {
      const known = new Set(
        (
          await tx.execute(
            sql`SELECT id::text FROM market.instruments WHERE id=ANY(${sql.param(factors)}::uuid[])`,
          )
        ).rows.map((r) => String(r.id)),
      );
      const index = hypothetical.findIndex(
        (h) => h.kind === "index_shock" && !known.has(h.instrumentId),
      );
      if (index >= 0)
        throw outOfBounds(
          `hypothetical.${index}.instrumentId`,
          "unknown_instrument",
          "Nieznany instrument szoku.",
        );
    }
    const keys = params.historical ?? [];
    if (new Set(keys).size !== keys.length)
      throw outOfBounds("historical", "duplicate", "Scenariusz powtórzony.");
    const { portfolio, assumptions, warnings } = await this.snapshot(tx, params);
    const available = new Map(
      (await this.scenarios(tx)).filter((s) => s.kind === "historical").map((s) => [s.key, s]),
    );
    const before = (s: StressScenario) => String(s.endDate) < portfolio.asOf;
    let chosen: StressScenario[];
    if (!keys.length && !hypothetical.length) chosen = [...available.values()].filter(before);
    else
      chosen = keys.map((key, index) => {
        const scenario = available.get(key);
        if (!scenario)
          throw outOfBounds(`historical.${index}`, "unknown_scenario", "Nieznany scenariusz.");
        if (!before(scenario))
          throw outOfBounds(
            `historical.${index}`,
            "after_snapshot",
            "Okno scenariusza musi kończyć się przed dniem migawki portfela.",
          );
        return scenario;
      });
    if (!chosen.length && !hypothetical.length)
      throw outOfBounds("historical", "no_scenarios", "Brak scenariuszy do policzenia.");
    const historical = chosen.map((s) => ({
      key: s.key,
      name: s.name,
      from: String(s.startDate),
      to: String(s.endDate),
    }));
    return {
      stored: {
        ...(params.accountIds ? { accountIds: params.accountIds } : {}),
        historical: historical.map((h) => h.key),
        hypothetical,
      },
      portfolio,
      assumptions: {
        ...assumptions,
        scenarioSource: Object.fromEntries(
          chosen.map((s) => [
            s.key,
            BUILTIN_STRESS_SCENARIOS.some((b) => b.key === s.key && sameScenario(b, s))
              ? "builtin"
              : "admin",
          ]),
        ),
      },
      warnings,
      seed: null,
      algorithm: ALGORITHM_VERSIONS.stress_test,
      job: (runId: string, requestedAt: string): AnalyticsJob =>
        stressTestJobSchema.parse({
          v: 1,
          runId,
          type: "stress_test",
          requestedAt,
          params: { historical, hypothetical },
          portfolio,
        }),
    };
  }

  /** Enabled scenarios: built-in ones replaced by admin rows with the same key (§ 12.3). */
  private async scenarios(tx: DatabaseTransaction): Promise<StressScenario[]> {
    const rows = (
      await tx.execute(
        sql`SELECT key,name,kind,start_date::text AS "startDate",end_date::text AS "endDate",shocks,description,enabled FROM analytics.stress_scenarios ORDER BY key`,
      )
    ).rows;
    const merged = new Map(BUILTIN_STRESS_SCENARIOS.map((s) => [s.key, s]));
    for (const row of rows) {
      const parsed = stressScenario.safeParse(
        Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null)),
      );
      // A malformed admin row hides the key rather than reaching a computation.
      if (!parsed.success || !validScenario(parsed.data)) merged.delete(String(row.key));
      else merged.set(parsed.data.key, parsed.data);
    }
    return [...merged.values()].filter((s) => s.enabled);
  }

  async listScenarios(context: Owner) {
    return this.database.transaction(context, async (tx) => ({ data: await this.scenarios(tx) }));
  }

  /** § 12.1: positions from the latest stored valuation, mapped to long-history proxies. */
  private async snapshot(tx: DatabaseTransaction, params: SnapshotParams) {
    const accounts = (
      await tx.execute(
        sql`SELECT id::text,account_type AS "accountType" FROM portfolio.accounts WHERE closed_on IS NULL`,
      )
    ).rows.filter((a) =>
      params.accountIds?.length
        ? params.accountIds.includes(String(a.id))
        : a.accountType !== "demo",
    );
    const ids = accounts.map((a) => String(a.id));
    const latest = (
      await tx.execute(
        sql`SELECT DISTINCT ON (account_id) account_id::text AS "accountId",valuation_date::text AS date,cash::text AS cash,fx_rate_to_pln::text AS fx FROM portfolio.valuations_daily WHERE account_id=ANY(${sql.param(ids)}::uuid[]) ORDER BY account_id,valuation_date DESC`,
      )
    ).rows;
    if (!latest.length)
      throw outOfBounds("accountIds", "no_valuation", "Brak wycen wybranych rachunków.");
    const warnings: { code: string; severity: "info" | "warning"; message: string }[] = [];
    let cash = new Decimal(0);
    for (const row of latest) {
      if (row.fx === null) {
        warnings.push({
          code: "CASH_FX_MISSING",
          severity: "warning",
          message: "Część gotówki pominięto: brak kursu do PLN.",
        });
        continue;
      }
      const value = toDecimal(String(row.cash)).times(toDecimal(String(row.fx)));
      if (value.isNegative())
        warnings.push({
          code: "NEGATIVE_CASH",
          severity: "warning",
          message: "Ujemne saldo gotówki rachunku nie wchodzi do symulacji.",
        });
      else cash = cash.plus(value);
    }
    const positions = (
      await tx.execute(
        sql`SELECT p.instrument_id::text AS "instrumentId",p.market_value_pln::text AS value,i.mic FROM portfolio.positions_daily p JOIN market.instruments i ON i.id=p.instrument_id JOIN (VALUES ${sql.join(
          latest.map((r) => sql`(${String(r.accountId)}::uuid,${String(r.date)}::date)`),
          sql`,`,
        )}) AS l(account_id,valuation_date) ON l.account_id=p.account_id AND l.valuation_date=p.valuation_date WHERE p.quantity>0`,
      )
    ).rows;
    const proxies = (
      await tx.execute(
        sql`SELECT i.id::text,i.mic,i.ticker FROM market.instruments i WHERE (i.mic,i.ticker) IN ((${PROXIES.gpw.mic},${PROXIES.gpw.ticker}),(${PROXIES.other.mic},${PROXIES.other.ticker}),(${PROXIES.otherFallback.mic},${PROXIES.otherFallback.ticker})) AND EXISTS(SELECT 1 FROM market.bars_daily b WHERE b.instrument_id=i.id)`,
      )
    ).rows;
    const proxyId = (target: { mic: string; ticker: string }) =>
      proxies.find((p) => p.mic === target.mic && p.ticker === target.ticker)?.id as
        | string
        | undefined;
    const usTotalReturn = proxyId(PROXIES.other);
    const usProxy = usTotalReturn ?? proxyId(PROXIES.otherFallback);
    let usFallbackUsed = false;
    const overrides = new Map(
      (params.proxyOverrides ?? []).map((o) => [o.instrumentId, o.proxyInstrumentId]),
    );
    const requested = [...new Set(overrides.values())];
    if (requested.length) {
      const known = new Set(
        (
          await tx.execute(
            sql`SELECT id::text FROM market.instruments WHERE id=ANY(${sql.param(requested)}::uuid[])`,
          )
        ).rows.map((r) => String(r.id)),
      );
      if (requested.some((id) => !known.has(id)))
        throw outOfBounds("proxyOverrides", "unknown_instrument", "Nieznany instrument proxy.");
    }
    const grouped = new Map<string, { value: Decimal; proxy: string }>();
    let unvalued = 0;
    for (const p of positions) {
      if (p.value === null) {
        unvalued += 1;
        continue;
      }
      const instrumentId = String(p.instrumentId);
      const override = overrides.get(instrumentId);
      const proxy = override ?? (p.mic === PROXIES.gpw.mic ? proxyId(PROXIES.gpw) : usProxy);
      if (!override && p.mic !== PROXIES.gpw.mic && !usTotalReturn && usProxy)
        usFallbackUsed = true;
      if (!proxy)
        throw outOfBounds("proxyOverrides", "proxy_unavailable", "Brak serii proxy dla pozycji.");
      const current = grouped.get(instrumentId);
      grouped.set(instrumentId, {
        value: (current?.value ?? new Decimal(0)).plus(toDecimal(String(p.value))),
        proxy,
      });
    }
    if (unvalued)
      warnings.push({
        code: "POSITIONS_UNVALUED",
        severity: "warning",
        message: `Pominięto pozycje bez wyceny w PLN: ${unvalued}.`,
      });
    if (usFallbackUsed)
      warnings.push({
        code: "PROXY_PRICE_INDEX",
        severity: "warning",
        message:
          "Seria S&P 500 z dywidendami (^SP500TR) jest niedostępna; użyto indeksu cenowego ^GSPC — wynik części USA jest zaniżony o dywidendy.",
      });
    if (!grouped.size)
      throw outOfBounds("accountIds", "no_positions", "Brak wycenionych pozycji do symulacji.");
    if (grouped.size > ANALYTICS_LIMITS.portfolioPositions)
      throw outOfBounds("accountIds", "too_many_positions", "Za dużo pozycji w migawce.");
    const asOf = latest.map((r) => String(r.date)).sort()[0] as string;
    return {
      portfolio: {
        asOf,
        positions: [...grouped].map(([instrumentId, g]) => ({
          instrumentId,
          proxyInstrumentId: g.proxy,
          value: { amount: grosze(g.value), currency: "PLN" as const },
        })),
        cash: { amount: grosze(cash), currency: "PLN" as const },
      },
      assumptions: {
        portfolioAsOf: asOf,
        proxyMapping: Object.fromEntries([...grouped].map(([id, g]) => [id, g.proxy])),
        cashProxy: "NBP:REF_RATE",
        ...(usFallbackUsed
          ? { usEquityProxy: "^GSPC (indeks cenowy, bez dywidend; ^SP500TR niedostępny)" }
          : {}),
        accountsIncluded: latest.length,
      },
      warnings,
    };
  }

  async list(
    context: Owner,
    query: {
      type?: string[] | undefined;
      status?: string[] | undefined;
      limit: number;
      cursor?: string | undefined;
    },
  ) {
    let after: { createdAt: string; id: string } | undefined;
    if (query.cursor) {
      const parsed = z
        .object({ createdAt: z.string().datetime({ offset: true }), id: z.uuid() })
        .strict()
        .safeParse(
          (() => {
            try {
              return JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8"));
            } catch {
              return undefined;
            }
          })(),
        );
      if (!parsed.success) throw new ProblemError("VALIDATION_FAILED");
      after = parsed.data;
    }
    return this.database.transaction(context, async (tx) => {
      const rows = (
        await tx.execute(
          sql`${SELECT_RUN} WHERE (${query.type?.length ? sql`type=ANY(${sql.param(query.type)}::text[])` : sql`true`}) AND (${query.status?.length ? sql`status=ANY(${sql.param(query.status)}::text[])` : sql`true`}) AND (${after ? sql`(created_at,id)<(${after.createdAt}::timestamptz,${after.id}::uuid)` : sql`true`}) ORDER BY created_at DESC,id DESC LIMIT ${query.limit + 1}`,
        )
      ).rows;
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      const hasMore = rows.length > query.limit;
      return {
        data: page.map((r) => runDto(r, false)),
        page: {
          hasMore,
          ...(hasMore && last
            ? {
                nextCursor: Buffer.from(
                  JSON.stringify({
                    createdAt: new Date(String(last.createdAt)).toISOString(),
                    id: String(last.id),
                  }),
                ).toString("base64url"),
              }
            : {}),
        },
      };
    });
  }

  async get(context: Owner, runId: string) {
    return this.database.transaction(context, async (tx) => {
      const row = (await tx.execute(sql`${SELECT_RUN} WHERE id=${runId}::uuid`)).rows[0];
      if (!row) throw new ProblemError("NOT_FOUND");
      return runDto(row);
    });
  }

  async cancel(context: Owner, runId: string) {
    const run = await this.get(context, runId);
    if (!["queued", "running"].includes(run.status)) throw new ProblemError("CONFLICT");
    const queue = await this.queue();
    if (run.status === "queued" && (await queue.remove(runId))) {
      await this.finish(context, runId, "cancelled");
    } else await queue.requestCancel(runId);
    return this.get(context, runId);
  }

  async delete(context: Owner, runId: string) {
    const run = await this.get(context, runId);
    if (run.status === "queued" || run.status === "running") {
      const queue = await this.queue();
      if (!(run.status === "queued" && (await queue.remove(runId))))
        await queue.requestCancel(runId);
    }
    await this.database.transaction(context, (tx) =>
      tx.execute(sql`DELETE FROM analytics.analytics_runs WHERE id=${runId}::uuid`),
    );
  }

  private async finish(
    context: Owner,
    runId: string,
    status: "failed" | "cancelled",
    error?: string,
  ) {
    await this.database.transaction(context, (tx) =>
      tx.execute(
        sql`UPDATE analytics.analytics_runs SET status=${status},error=${error ?? null},finished_at=now() WHERE id=${runId}::uuid AND status IN ('queued','running')`,
      ),
    );
  }
}

type SnapshotParams = {
  accountIds?: string[] | undefined;
  proxyOverrides?: { instrumentId: string; proxyInstrumentId: string }[] | undefined;
};
type Shock =
  | { kind: "index_shock"; instrumentId: string; shock: number }
  | { kind: "fx_shock"; currency: "USD" | "EUR"; shock: number }
  | { kind: "correlation_shock"; correlation: number };

/** OpenAPI keeps one flat shape; each kind needs exactly its own fields (422 otherwise). */
export function stressShocks(items: readonly unknown[]): Shock[] {
  return items.map((raw, index) => {
    const item = stressHypothetical.parse(raw);
    const path = `hypothetical.${index}`;
    const extra = (allowed: string[]) =>
      Object.keys(item).filter((key) => key !== "kind" && !allowed.includes(key));
    const invalid = (message: string) => outOfBounds(path, "shock", message);
    if (item.kind === "index_shock") {
      if (
        item.instrumentId === undefined ||
        item.shock === undefined ||
        extra(["instrumentId", "shock"]).length
      )
        throw invalid("Szok indeksu wymaga instrumentId i shock.");
      return { kind: item.kind, instrumentId: item.instrumentId, shock: item.shock };
    }
    if (item.kind === "fx_shock") {
      if (
        (item.currency !== "USD" && item.currency !== "EUR") ||
        item.shock === undefined ||
        extra(["currency", "shock"]).length
      )
        throw invalid("Szok kursu wymaga currency (USD lub EUR) i shock.");
      return { kind: item.kind, currency: item.currency, shock: item.shock };
    }
    if (extra(["correlation"]).length) throw invalid("Szok korelacji przyjmuje tylko correlation.");
    return { kind: item.kind, correlation: item.correlation ?? DEFAULT_CORRELATION };
  });
}

function validScenario(s: StressScenario) {
  if (s.kind === "historical") {
    if (!s.startDate || !s.endDate || s.startDate >= s.endDate) return false;
    const days = (Date.parse(s.endDate) - Date.parse(s.startDate)) / 86_400_000;
    return days <= MAX_SCENARIO_DAYS;
  }
  const items = (s.shocks as { items?: unknown } | undefined)?.items;
  if (!Array.isArray(items) || !items.length || items.length > 10) return false;
  try {
    stressShocks(items);
    return true;
  } catch {
    return false;
  }
}

function sameScenario(a: StressScenario, b: StressScenario) {
  return a.startDate === b.startDate && a.endDate === b.endDate && a.name === b.name;
}

/** Defaults of the OpenAPI schema made explicit; the job carries every parameter (§ 5.2.1). */
export function goalDefaults(params: GoalParams) {
  if (params.target.currency !== "PLN" || !toDecimal(params.target.amount).isPositive())
    throw outOfBounds("target", "currency", "Cel musi być dodatnią kwotą w PLN.");
  if (new Set(params.probabilities).size !== params.probabilities.length)
    throw outOfBounds("probabilities", "duplicate", "Prawdopodobieństwo powtórzone.");
  return { ...params, probabilities: [...params.probabilities].sort((a, b) => a - b) };
}
/** Defaults of the OpenAPI schema made explicit; the job carries every parameter (§ 5.2.1). */
export function monteCarloDefaults(params: MonteCarloParams) {
  const flows = (items: MonteCarloParams["contributions"], path: string) =>
    (items ?? []).map((flow, index) => {
      const endYear = flow.endYear ?? params.horizonYears;
      if (flow.amount.currency !== "PLN")
        throw outOfBounds(`${path}.${index}.amount`, "currency", "Kwota musi być w PLN.");
      if (!toDecimal(flow.amount.amount).isPositive())
        throw outOfBounds(`${path}.${index}.amount`, "too_small", "Kwota musi być dodatnia.");
      if (flow.startYear > endYear || endYear > params.horizonYears)
        throw outOfBounds(
          `${path}.${index}`,
          "years",
          "Lata przepływu muszą mieścić się w horyzoncie.",
        );
      return { ...flow, endYear };
    });
  if (
    params.goal &&
    (params.goal.currency !== "PLN" || !toDecimal(params.goal.amount).isPositive())
  )
    throw outOfBounds("goal", "currency", "Cel musi być dodatnią kwotą w PLN.");
  return {
    ...params,
    contributions: flows(params.contributions, "contributions"),
    withdrawals: flows(params.withdrawals, "withdrawals"),
  };
}
