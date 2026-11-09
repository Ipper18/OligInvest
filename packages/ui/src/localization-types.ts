export type Localization = {
  locale: "pl-PL" | "en-US";
  timezone: string;
  copies: Readonly<Record<string, unknown>>;
};
export const defaultLocalization: Localization = {
  locale: "pl-PL",
  timezone: "Europe/Warsaw",
  copies: {},
};
