import "server-only";
import { loadConfig } from "@oliginvest/config";
import { legalCopy } from "@oliginvest/i18n/legal";
export function legalText(value: string) {
  const config = loadConfig("web", process.env, {
    mode: process.env.NODE_ENV as "production" | "development" | "test",
  });
  return value
    .replaceAll("{ADMINISTRATOR}", config.LEGAL_CONTROLLER_NAME ?? legalCopy.labels.missing)
    .replaceAll("{KONTAKT_EMAIL}", config.LEGAL_CONTACT_EMAIL ?? legalCopy.labels.missing)
    .replaceAll("{DATA_WEJSCIA_W_ZYCIE}", config.LEGAL_EFFECTIVE_DATE ?? legalCopy.labels.missing);
}
