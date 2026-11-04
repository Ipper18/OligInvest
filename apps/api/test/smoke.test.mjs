import { expect, test, vi } from "vitest";

// Authentication, database and queue code loads only when the runtime handles its first
// authenticated request (runtime.ts → auth/runtime.js), so importing the skeleton stays cheap.
vi.mock("../dist/auth/runtime.js", () => {
  throw new Error("Auth runtime must load only on the first authenticated request");
});
vi.mock("../dist/auth/config.js", () => {
  throw new Error("better-auth must load only with the auth runtime");
});
vi.mock("../dist/auth/service.js", () => {
  throw new Error("Auth service must load only with the auth runtime");
});
vi.mock("better-auth", () => {
  throw new Error("better-auth must load only with the auth runtime");
});
vi.mock("bullmq", () => {
  throw new Error("Queue client must load only when a job is enqueued");
});
vi.mock("ioredis", () => {
  throw new Error("Valkey client must load only with the auth runtime");
});

test("application skeleton loads without starting services", async () => {
  const loaded = await import("../dist/index.js");
  expect(loaded).toBeDefined();
});
