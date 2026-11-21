import "server-only";
import { createFormatters, alertMessages as plMessages } from "@oliginvest/i18n";
import { alertScreens } from "@oliginvest/i18n/alert-screens";
import { getLocalization } from "@oliginvest/ui/localization-server";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getApiClient } from "../api/server";
import { requireMe } from "../auth/session";
import { uiModules } from "../ui-registry";
export const ruleTypes = z.enum([
  "price_above",
  "price_below",
  "change_pct",
  "portfolio_change",
  "drawdown",
  "allocation_drift",
]);
export async function alertsContext() {
  const me = await requireMe();
  if (!uiModules.some((module) => module.id === "alerts") || me.features["module.alerts"] === false)
    notFound();
  const localization = await getLocalization();
  const locale = localization.locale;
  return {
    api: await getApiClient(),
    m: alertScreens[locale],
    format: createFormatters(localization),
    messages: (localization.copies.alertMessages as typeof plMessages | undefined) ?? plMessages,
  };
}
export function checked<T>(result: { response: Response; data?: T }): T {
  if (result.response.status === 404) notFound();
  if (!result.response.ok || !result.data) throw new Error("ALERTS_UNAVAILABLE");
  return result.data;
}
