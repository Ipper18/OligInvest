import "server-only";
import {
  analyticsLimitsViewSchema,
  analyticsRunsViewSchema,
  analyticsRunViewSchema,
} from "@oliginvest/contracts";
import { notFound } from "next/navigation";
import * as z from "zod";
import { getApiClient } from "../api/server";
import { requireMe } from "../auth/session";
import { uiModules } from "../ui-registry";

export async function requireAnalytics() {
  const me = await requireMe();
  if (
    !uiModules.some((module) => module.id === "analytics") ||
    me.features["module.analytics"] === false
  )
    notFound();
  return me;
}
export async function readRun(id: string) {
  await requireAnalytics();
  if (!z.uuid().safeParse(id).success) notFound();
  const api = await getApiClient();
  const result = await api.GET("/analytics/runs/{runId}", { params: { path: { runId: id } } });
  if (result.response.status === 404) notFound();
  if (!result.response.ok) throw new Error("ANALYTICS_UNAVAILABLE");
  return analyticsRunViewSchema.parse(result.data);
}
export async function readLimits() {
  await requireAnalytics();
  const result = await (await getApiClient()).GET("/analytics/limits");
  if (!result.response.ok) throw new Error("ANALYTICS_UNAVAILABLE");
  return analyticsLimitsViewSchema.parse(result.data);
}
export async function readRuns(cursor?: string) {
  await requireAnalytics();
  const result = await (await getApiClient()).GET("/analytics/runs", {
    params: { query: { limit: 20, ...(cursor ? { cursor } : {}) } },
  });
  if (!result.response.ok) throw new Error("ANALYTICS_UNAVAILABLE");
  return analyticsRunsViewSchema.parse(result.data);
}
