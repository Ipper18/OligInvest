import "server-only";
import { type Localization, setLocalizationResolver } from "@oliginvest/ui/localization-server";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { getMe } from "../auth/session";

export const getRequestLocalization = cache(async (): Promise<Localization> => {
  const pathname = (await headers()).get("x-oi-pathname") ?? "";
  const privatePage =
    pathname === "/" ||
    /^\/(portfel|rynek|analizy|alerty|nauka|ustawienia|admin)(\/|$)/u.test(pathname);
  const preferences = privatePage ? (await getMe())?.preferences : undefined;
  const locale =
    preferences?.locale ??
    ((await cookies()).get("oi-locale")?.value === "en-US" ? "en-US" : "pl-PL");
  const timezone = preferences?.timezone ?? "Europe/Warsaw";
  const copies = locale === "en-US" ? (await import("@oliginvest/i18n/en")).copies : {};
  return { locale, timezone, copies };
});

setLocalizationResolver(getRequestLocalization);

export function clientLocalization(config: Localization): Localization {
  // Root layouts persist across navigation. Include every interactive namespace;
  // document and education article bodies remain server-only.
  const { legalCopy: _legal, ...copies } = config.copies;
  return { ...config, copies };
}
