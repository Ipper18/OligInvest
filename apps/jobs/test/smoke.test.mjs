import { expect, test } from "vitest";

test("application skeleton loads without starting services", async () => {
  const loaded = await import("../dist/index.js");
  expect(loaded).toBeDefined();
});
