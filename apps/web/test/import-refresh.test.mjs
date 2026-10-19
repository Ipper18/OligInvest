import { expect, test } from "vitest";
import { importRefreshInterval } from "../src/portfolio/import-refresh.ts";

test("unfinished imports recover missed completion events and stop polling at terminal states", () => {
  for (const status of ["uploaded", "parsing"])
    expect(importRefreshInterval("import", { status })).toBe(5000);
  for (const status of ["parsed", "committed", "failed", "discarded"])
    expect(importRefreshInterval("import", { status })).toBe(false);
  expect(importRefreshInterval("rows", { status: "uploaded" })).toBe(false);
});
