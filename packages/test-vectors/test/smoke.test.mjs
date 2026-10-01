import { expect, test } from "vitest";

test("public package entry point loads", async () => {
  const loaded = await import("@oliginvest/test-vectors");
  expect(loaded).toBeDefined();
});
