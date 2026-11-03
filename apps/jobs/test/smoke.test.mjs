import { expect, test, vi } from "vitest";

vi.mock("../dist/auth-mail.js", () => {
  throw new Error("SMTP transport must load only when starting its worker");
});
vi.mock("../dist/feature-flags.js", () => {
  throw new Error("Database runtime must load only when starting jobs");
});
vi.mock("../dist/modules.js", () => {
  throw new Error("Domain module jobs must load only when starting jobs");
});
vi.mock("../dist/monitoring.js", () => {
  throw new Error("Monitoring must load only when starting jobs");
});
vi.mock("bullmq", () => {
  throw new Error("Queue client must load only when starting jobs");
});
vi.mock("drizzle-orm", () => {
  throw new Error("Database runtime must load only when starting jobs");
});

test("application skeleton loads without starting services", async () => {
  const loaded = await import("../dist/index.js");
  expect(loaded).toBeDefined();
});
