import authMail from "./pl/auth-mail.json" with { type: "json" };
import bootstrap from "./pl/bootstrap.json" with { type: "json" };
import common from "./pl/common.json" with { type: "json" };
import data from "./pl/data.json" with { type: "json" };
import disclaimerCatalog from "./pl/disclaimers.json" with { type: "json" };
import errors from "./pl/errors.json" with { type: "json" };

export const messages = { ...common, bootstrap, data } as const;
export const disclaimers = disclaimerCatalog;
export const errorMessages = errors;
export const authMailMessages = authMail;
export type DisclaimerKey = keyof typeof disclaimers;
export type ProblemCode = keyof typeof errorMessages;

/** Plain-text interpolation: callers render through React, never as HTML. */
export function formatMessage(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/gu, (_, key: string) => {
    if (!Object.hasOwn(values, key)) throw new TypeError(`Missing message parameter: ${key}`);
    return values[key] as string;
  });
}

const pluralRules = new Intl.PluralRules("pl-PL");
export function pluralForm(count: number): Intl.LDMLPluralRule {
  return pluralRules.select(count);
}

export * from "./formatters.js";
