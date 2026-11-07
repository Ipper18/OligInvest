"use server";
import { analyticsRunViewSchema } from "@oliginvest/contracts";
import { redirect } from "next/navigation";
import * as z from "zod";
import type { components } from "../api/schema";
import { getApiClient } from "../api/server";
import { problemSchema } from "../api/validation";
import { readRun, requireAnalytics } from "./data";
import { quotaRenewal } from "./renewal";

export async function refreshRun(id: string) {
  return readRun(id);
}
export async function cancelRun(form: FormData) {
  await requireAnalytics();
  const id = z.uuid().parse(form.get("id"));
  const result = await (await getApiClient()).POST("/analytics/runs/{runId}/cancel", {
    params: { path: { runId: id } },
  });
  redirect(`/analizy/${id}${result.response.ok ? "" : "?error=FAILED"}`);
}
export async function createRun(form: FormData) {
  const me = await requireAnalytics();
  if (me.role === "user") redirect("/analizy?error=FORBIDDEN");
  const parsed = z
    .object({
      type: z.enum(["monte_carlo", "stress_test", "goal"]),
      key: z.uuid(),
      horizonYears: z.coerce.number().int().min(1).max(40),
      paths: z.coerce.number().int().min(100).max(10000),
      seed: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
      target: z.string().regex(/^[1-9]\d{0,13}(\.\d{1,2})?$/),
      inflationRate: z.coerce.number().min(0).max(0.2),
      annualCostRate: z.coerce.number().min(0).max(0.05),
      taxMode: z.enum(["belka_simplified", "none"]),
    })
    .strict()
    .safeParse(
      Object.fromEntries([...form.entries()].filter(([key]) => !key.startsWith("$ACTION_"))),
    );
  if (!parsed.success) redirect("/analizy?error=VALIDATION_FAILED");
  const { type, key, target, ...params } = parsed.data;
  const body: components["schemas"]["AnalyticsRunInput"] =
    type === "stress_test"
      ? { type, params: {} }
      : type === "goal"
        ? {
            type,
            params: {
              ...params,
              target: { amount: target, currency: "PLN" },
              probabilities: [0.5, 0.75, 0.9],
              indexToInflation: true,
            },
          }
        : {
            type,
            params: {
              ...params,
              model: "stationary_bootstrap",
              meanBlockMonths: 6,
              historyWindow: "full",
              goal: { amount: target, currency: "PLN" },
            },
          };
  const result = await (await getApiClient()).POST("/analytics/runs", {
    body,
    params: { header: { "Idempotency-Key": key } },
  });
  if (result.response.ok) redirect(`/analizy/${analyticsRunViewSchema.parse(result.data).id}`);
  const problem = problemSchema.safeParse(result.error);
  const code = problem.success ? problem.data.code : "FAILED";
  const renewal = code === "QUOTA_EXCEEDED" ? quotaRenewal(result.response.headers) : undefined;
  redirect(`/analizy?${new URLSearchParams({ error: code, ...(renewal ? { renewal } : {}) })}`);
}
