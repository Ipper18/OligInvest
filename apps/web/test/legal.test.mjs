import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { generateLegal } from "../scripts/generate-legal.mjs";

test("public legal MDX and i18n preserve complete versioned source documents", () => {
  for (const [path, expected] of Object.entries(generateLegal()))
    expect(
      readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8").replaceAll("\r\n", "\n"),
    ).toBe(expected);
});
