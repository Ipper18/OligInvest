import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parse } from "yaml";
import { disclaimers, errorMessages, formatMessage, messages, pluralForm } from "../dist/index.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const rows = (text) =>
  text
    .split("\n")
    .filter((line) => line.startsWith("| `"))
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );

test("all twelve disclaimers match the legal source verbatim, including their version", () => {
  const section = read("../../../docs/11-zgodnosc-prawna.md")
    .split("### 4.3 ")[1]
    .split("### 4.4")[0];
  const version = section.match(/wersja `([^`]+)`/)[1];
  const expected = Object.fromEntries(
    rows(section).map(([key, , text]) => [key.replaceAll("`", ""), { version, text }]),
  );
  expect(Object.keys(expected)).toHaveLength(12);
  expect(disclaimers).toEqual(expected);
});

test("contract errors use the exact title and help text from the UI source", () => {
  const section = read("../../../docs/04-frontend/teksty-ui.md")
    .split("## 7. ")[1]
    .split("## 8.")[0];
  const expected = Object.fromEntries(
    rows(section)
      .filter(([key]) => key !== "`code`")
      .map(([key, title, description]) => [key.replaceAll("`", ""), { title, description }]),
  );
  expect(errorMessages).toEqual(expected);
  const api = parse(read("../../../docs/02-api/openapi.yaml"));
  expect(Object.keys(errorMessages).sort()).toEqual(api.components.schemas.ProblemCode.enum.sort());
});

test("keyed navigation, column and action messages match the source", () => {
  for (const [key, text] of rows(read("../../../docs/04-frontend/teksty-ui.md"))) {
    const path = key.replaceAll("`", "").split(".");
    if (!["nav", "shell", "col", "action"].includes(path[0])) continue;
    expect(path.reduce((value, part) => value[part], messages)).toBe(text);
  }
});

test("interpolation is plain text, checks missing variables and does not recursively interpolate", () => {
  expect(formatMessage("{value}: {value}", { value: "<b>{other}</b>" })).toBe(
    "<b>{other}</b>: <b>{other}</b>",
  );
  expect(() => formatMessage("{value}", {})).toThrow();
  expect(() => formatMessage("{constructor}", {})).toThrow();
});

test("Polish plural categories include teens, large counts and fractions", () => {
  expect([0, 1, 2, 5, 12, 22, 101, 1.5].map(pluralForm)).toEqual([
    "many",
    "one",
    "few",
    "many",
    "many",
    "few",
    "many",
    "other",
  ]);
});
