import { createFormatters } from "@oliginvest/i18n";
import { use } from "react";
import { defaultLocalization, type Localization } from "./localization-types.js";

// The resolver is installed once by the host. Only the resolver is shared, never request data.
const fallback = Promise.resolve(defaultLocalization);
let resolveLocalization: () => Promise<Localization> = () => fallback;
export function setLocalizationResolver(resolver: () => Promise<Localization>) {
  resolveLocalization = resolver;
}
export function getLocalization() {
  return resolveLocalization();
}
export function useLocalization() {
  return use(resolveLocalization());
}
export function useCopy<T>(namespace: string, fallbackCopy: T): T {
  return (useLocalization().copies[namespace] as T | undefined) ?? fallbackCopy;
}
export type { Localization } from "./localization-types.js";

export function useFormatters() {
  return createFormatters(useLocalization());
}
