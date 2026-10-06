import { expect, test, vi } from "vitest";

vi.mock("../dist/auth-mail.js", () => {
  throw new Error("SMTP transport must load only when starting its worker");
});
vi.mock("../dist/feature-flags.js", () => {
  throw new Error("Database runtime must load only when starting jobs");
});

test("application skeleton loads without starting services", async () => {
  const loaded = await import("../dist/index.js");
  expect(loaded).toBeDefined();
});
