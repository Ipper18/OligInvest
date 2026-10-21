import { readdirSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { entries, searchGlossary } from "../src/education/catalog.ts";

test("contextual indicator and MVP metric keys have complete source content", () => {
  for (const key of [
    "sma",
    "ema",
    "bb",
    "rsi",
    "macd",
    "atr",
    "wartosc",
    "koszt",
    "pl",
    "wynik-dnia",
    "alokacja",
    "twr",
    "xirr",
    "wolumen",
  ]) {
    const entry = entries.find((entry) => entry.key === key);
    expect(entry).toBeDefined();
    for (const field of ["definition", "reading", "pitfalls", "formula", "href"])
      expect(entry[field].length).toBeGreaterThan(0);
  }
  const directory = new URL("../../../modules/education/content/", import.meta.url);
  expect(readdirSync(directory).filter((name) => name.endsWith(".mdx"))).toHaveLength(
    entries.length,
  );
  expect(entries.length).toBeGreaterThanOrEqual(30);
  for (const entry of entries)
    expect(readFileSync(new URL(`${entry.key}.mdx`, directory), "utf8")).toContain(
      entry.definition,
    );
});
test("glossary matches fragments, synonyms, case and Polish diacritics", () => {
  expect(searchGlossary("średnia prosta").map((e) => e.key)).toContain("sma");
  expect(searchGlossary("srednia prosta").map((e) => e.key)).toContain("sma");
  expect(searchGlossary("wolum").map((e) => e.key)).toContain("wolumen");
  expect(searchGlossary("SHARE").map((e) => e.key)).toContain("akcja");
  expect(searchGlossary("nieistniejace-haslo")).toEqual([]);
});
