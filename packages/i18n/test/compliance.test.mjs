import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
  checkUiText,
  forbiddenMatches,
  loadPolicies,
  strings,
} from "../../../scripts/check-ui-text.mjs";
import { BULK_TEST_TIMEOUT_MS } from "../../../scripts/test-timeouts.mjs";

const root = new URL("../../../", import.meta.url);
const policies = loadPolicies();

// Parses every component and dictionary in the repository.
test(
  "production dictionaries, MDX and components contain no forbidden language or JSX text",
  () => {
    expect(checkUiText()).toEqual([]);
  },
  BULK_TEST_TIMEOUT_MS,
);

test("the English list covers every LAW § 4.1 category with whole-word matching", () => {
  for (const phrase of [
    "buy",
    "sell",
    "hold",
    "price target",
    "will reach",
    "guaranteed",
    "we recommend",
    "you should",
    "buy signal",
    "opportunity",
    "undervalued",
    "top 10",
    "risk-free",
    "suitable for you",
    "recommendation",
    "optimal portfolio",
  ])
    expect(policies.en.phrases).toContain(phrase);
  for (const text of [
    "BUY now",
    "“Sell”",
    "price\nTARGET",
    "The price will reach 100",
    "We recommend this ETF",
    "A guaranteed result",
    "Risk-free return",
  ])
    expect(forbiddenMatches(text, policies.en), text).not.toEqual([]);
  for (const text of [
    "Purchase",
    "Sale",
    "Seller fee",
    "Holdings",
    "Buying power",
    "Reached the threshold",
    "Guarantee fund",
    "Recommended browser",
  ])
    expect(forbiddenMatches(text, policies.en), text).toEqual([]);
});

test("every exception names existing keys and gives a reason (no stale or blanket exceptions)", () => {
  for (const [locale, policy] of Object.entries(policies))
    for (const exception of policy.exceptions) {
      expect(exception.reason.trim().length, `${locale} ${exception.file}`).toBeGreaterThan(20);
      expect(exception.file).toMatch(
        locale === "en" ? /^packages\/i18n\/src\/en\// : /^packages\/i18n\/src\/pl\//,
      );
      const keys = new Map(
        strings(JSON.parse(readFileSync(new URL(exception.file, root), "utf8"))),
      );
      for (const key of exception.keys)
        expect(keys.has(key), `${exception.file}: ${key}`).toBe(true);
    }
});

test("English exceptions are limited to disclaimers and glossary pitfalls", () => {
  for (const exception of policies.en.exceptions) {
    if (exception.file.endsWith("/disclaimers.json"))
      expect(exception.keys.every((key) => key.endsWith(".text"))).toBe(true);
    else {
      expect(exception.file).toBe("packages/i18n/src/en/education-content.json");
      expect(exception.keys.every((key) => key.endsWith(".pitfalls"))).toBe(true);
    }
  }
});
