import { expect, test } from "vitest";
import { preferencesJsonSchemas, preferencesPatchSchema } from "../dist/preferences.js";

test("preferences accept partial changes and reject empty or foreign fields", () => {
  expect(preferencesPatchSchema.parse({ costBasisMethod: "average", locale: "en-US" })).toEqual({
    costBasisMethod: "average",
    locale: "en-US",
  });
  for (const value of [
    {},
    { timezone: "" },
    { baseCurrency: "EUR" },
    { userId: "other" },
    { taxIncludeFxFee: "false" },
  ]) {
    expect(preferencesPatchSchema.safeParse(value).success).toBe(false);
  }
});

test("preference JSON Schema preserves strictness and nonempty patches", () => {
  expect(preferencesJsonSchemas.PreferencesPatch.additionalProperties).toBe(false);
  expect(preferencesJsonSchemas.PreferencesPatch.minProperties).toBe(1);
  expect(preferencesJsonSchemas.PreferencesPatch.properties.timezone.minLength).toBe(1);
  expect(preferencesJsonSchemas.Preferences.properties.locale.enum).toEqual(["pl-PL", "en-US"]);
});
