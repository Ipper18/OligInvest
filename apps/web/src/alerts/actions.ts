"use server";
import { loadConfig } from "@oliginvest/config";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { components } from "../api/schema";
import { alertsContext, ruleTypes } from "./data";

function mutationHeaders() {
  const mode = z.enum(["development", "test", "production"]).parse(process.env.NODE_ENV);
  return { origin: new URL(loadConfig("web", process.env, { mode }).PUBLIC_BASE_URL).origin };
}
export async function saveAlert(form: FormData) {
  const { api } = await alertsContext();
  const type = ruleTypes.parse(form.get("type"));
  const channels = z
    .array(z.enum(["push", "email"]))
    .min(1)
    .parse(form.getAll("channel"));
  const threshold = z
    .string()
    .regex(/^\d{1,12}(\.\d{1,8})?$/)
    .parse(form.get("threshold"));
  const common = { channels, hysteresis: 0.005, cooldownMinutes: 1440, enabled: true };
  let body: components["schemas"]["PriceAlertRuleInput"];
  if (type === "price_above" || type === "price_below")
    body = {
      ...common,
      type,
      instrumentId: z.uuid().parse(form.get("instrumentId")),
      params: { threshold, basis: "last" },
    };
  else if (type === "change_pct")
    body = {
      ...common,
      type,
      instrumentId: z.uuid().parse(form.get("instrumentId")),
      params: { threshold: Number(threshold), direction: "both" },
    };
  else if (type === "allocation_drift")
    body = {
      ...common,
      type,
      params: { threshold, targetId: z.uuid().parse(form.get("targetId")) },
    };
  else body = { ...common, type, params: { threshold } };
  const result = await api.POST("/alerts/rules", {
    body,
    headers: mutationHeaders(),
    params: { header: { "Idempotency-Key": z.uuid().parse(form.get("key")) } },
  });
  redirect(result.response.ok ? "/alerty" : "/alerty/nowy?error=invalid");
}

export async function changeAlert(form: FormData) {
  const { api } = await alertsContext();
  const ruleId = z.uuid().parse(form.get("id"));
  const params = { path: { ruleId } };
  const action = z.enum(["disable", "enable", "remove"]).parse(form.get("action"));
  const result =
    action === "remove"
      ? await api.DELETE("/alerts/rules/{ruleId}", { params, headers: mutationHeaders() })
      : await api.PATCH("/alerts/rules/{ruleId}", {
          params,
          headers: mutationHeaders(),
          body: { enabled: action === "enable" },
        });
  redirect(result.response.ok ? "/alerty" : `/alerty/${ruleId}?error=invalid`);
}
