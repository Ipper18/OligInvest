import { createHash, randomInt } from "node:crypto";
import {
  ANALYTICS_ERROR_CODES,
  ANALYTICS_LIMITS,
  ANALYTICS_TIMEOUTS_SECONDS,
  type AnalyticsJob,
  monteCarloJobSchema,
} from "@oliginvest/contracts";
import { Decimal, roundHalfUp, toDecimal } from "@oliginvest/core";
import type { AppDatabase, DatabaseContext, DatabaseTransaction } from "@oliginvest/db";
import { ProblemError } from "@oliginvest/platform";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { AnalyticsRun, AnalyticsRunInput, MonteCarloParams } from "../contracts.js";

/** Heavy analyses need `analytics:run:heavy` and count against the daily role quota (FR-07.06). */
export const HEAVY_TYPES = new Set([
  "monte_carlo",
  "optimization",
  "stress_test",
  "backtest",
  "goal",
]);
/** Types computed by this release; the remaining FR-04 analyses answer 404 until implemented. */
export const IMPLEMENTED_TYPES = new Set(["monte_carlo"]);
/** Used when `platform.role_limits` has no row (example value of schema.sql). */
export const DEFAULT_HEAVY_RUNS_PER_DAY = 20;
export const ALGORITHM_VERSIONS = { monte_carlo: "mc-1.0.0" } as const;
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
const PROXIES = { gpw: { mic: "XWAR", ticker: "WIG" }, other: { mic: "XNYS", ticker: "^GSPC" } };

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
      const params = monteCarloDefaults(input.params as MonteCarloParams);
      const { portfolio, assumptions, warnings } = await this.snapshot(tx, params);
      const seed = params.seed ?? randomInt(0, 2 ** 47);
      const stored = { ...params, seed };
      const row = (
        await tx.execute(
          sql`INSERT INTO analytics.analytics_runs(user_id,type,params,input_snapshot,assumptions,warnings,seed,algorithm_version) VALUES(${context.userId}::uuid,${input.type},${JSON.stringify(stored)}::jsonb,${JSON.stringify({ portfolio })}::jsonb,${JSON.stringify(assumptions)}::jsonb,${JSON.stringify(warnings)}::jsonb,${seed},${ALGORITHM_VERSIONS.monte_carlo}) RETURNING id::text,created_at AS "createdAt"`,
        )
      ).rows[0];
      const runId = z.uuid().parse(row?.id);
      const job = monteCarloJobSchema.parse({
        v: 1,
        runId,
        type: "monte_carlo",
        requestedAt: iso(this.now()),
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
          ...(params.goal ? { goal: params.goal } : {}),
        },
        portfolio,
        seed,
      });
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

  /** § 12.1: positions from the latest stored valuation, mapped to long-history proxies. */
  private async snapshot(tx: DatabaseTransaction, params: MonteCarloParamsFilled) {
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
        sql`SELECT id::text,mic,ticker FROM market.instruments WHERE (mic=${PROXIES.gpw.mic} AND ticker=${PROXIES.gpw.ticker}) OR (mic=${PROXIES.other.mic} AND ticker=${PROXIES.other.ticker})`,
      )
    ).rows;
    const proxyId = (target: { mic: string; ticker: string }) =>
      proxies.find((p) => p.mic === target.mic && p.ticker === target.ticker)?.id as
        | string
        | undefined;
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
      const proxy =
        overrides.get(instrumentId) ??
        proxyId(p.mic === PROXIES.gpw.mic ? PROXIES.gpw : PROXIES.other);
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

type MonteCarloParamsFilled = ReturnType<typeof monteCarloDefaults>;
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
