import { expect, test } from "vitest";
import { spikeApp } from "../spike/typescript-7.ts";

test("Hono and Zod OpenAPI preserve the typed response", async () => {
  const response = await spikeApp.request("/spike");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
});
