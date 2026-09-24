import { expect, test } from "vitest";

test("public package entry point loads", async () => {
  const loaded = await import("@oliginvest/db");
  expect(loaded).toBeDefined();
});
