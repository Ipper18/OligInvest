import { readdirSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";

const read = (locale, name) =>
  JSON.parse(readFileSync(new URL(`../src/${locale}/${name}`, import.meta.url), "utf8"));
function leaves(value, prefix = "") {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = `${prefix}.${key}`;
    return typeof child === "string" ? [[path, child]] : leaves(child, path);
  });
}
for (const name of readdirSync(new URL("../src/pl/", import.meta.url)).filter((name) =>
  name.endsWith(".json"),
)) {
  test(`${name}: English has all Polish keys and interpolation parameters`, () => {
    const pl = new Map(leaves(read("pl", name))),
      en = new Map(leaves(read("en", name)));
    expect([...en.keys()].sort()).toEqual([...pl.keys()].sort());
    for (const [key, text] of pl) {
      const parameters = (s) =>
        [...s.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((m) => m[1]).sort();
      expect(parameters(en.get(key)), key).toEqual(parameters(text));
      expect(en.get(key).trim(), key).not.toBe("");
    }
  });
}

test("persisted warnings retain exact quantities and unknown content", async () => {
  const { localizeWarning } = await import("../dist/analytics.js");
  const templates = read("en", "analytics.json").warningTemplates;
  expect(
    localizeWarning(
      "SHORT_HISTORY",
      "Historia proxy obejmuje 123 miesięcy (< 20 lat); sprawdź tabelę wrażliwości.",
      templates,
    ),
  ).toBe("Proxy history covers 123 months (less than 20 years); see the sensitivity table.");
  expect(
    localizeWarning(
      "SEQUENCE_RISK",
      "W 12.3% scenariuszy wypłaty wyczerpały portfel przed końcem horyzontu (ryzyko sekwencji).",
      templates,
    ),
  ).toContain("12.3%");
  expect(localizeWarning("SHORT_HISTORY", "Unrecognized future message 999", templates)).toBe(
    "Unrecognized future message 999",
  );
});
