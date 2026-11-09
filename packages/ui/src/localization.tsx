"use client";

import { createFormatters } from "@oliginvest/i18n";

import { createContext, type ReactNode, useContext } from "react";
import { defaultLocalization, type Localization } from "./localization-types.js";

const Context = createContext(defaultLocalization);
export function LocalizationProvider({
  value,
  children,
}: {
  value: Localization;
  children: ReactNode;
}) {
  return <Context value={value}>{children}</Context>;
}
export function useLocalization() {
  return useContext(Context);
}
export function useCopy<T>(namespace: string, fallback: T): T {
  return (useLocalization().copies[namespace] as T | undefined) ?? fallback;
}
export type { Localization } from "./localization-types.js";

export function useFormatters() {
  return createFormatters(useLocalization());
}
