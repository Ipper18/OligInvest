import "server-only";
import { loadConfig } from "@oliginvest/config";
import { legalCopy } from "@oliginvest/i18n/legal";
export function legalText(value: string, missing = legalCopy.labels.missing) {
  const config = loadConfig("web", process.env, {
    mode: process.env.NODE_ENV as "production" | "development" | "test",
  });
  return value
    .replaceAll("{ADMINISTRATOR}", config.LEGAL_CONTROLLER_NAME ?? missing)
    .replaceAll("{KONTAKT_EMAIL}", config.LEGAL_CONTACT_EMAIL ?? missing)
    .replaceAll("{DATA_WEJSCIA_W_ZYCIE}", config.LEGAL_EFFECTIVE_DATE ?? missing);
}
