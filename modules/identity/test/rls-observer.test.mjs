import { expect, test } from "vitest";
import { isRlsViolation, observeRlsViolations } from "../src/server/rls-observer.js";

test("RLS detection follows driver causes and excludes unrelated permission errors", () => {
  const violation = {
    code: "42501",
    message: 'new row violates row-level security policy for table "synthetic"',
  };
  expect(isRlsViolation(violation)).toBe(true);
  expect(isRlsViolation(new Error("query withheld", { cause: violation }))).toBe(true);
  expect(isRlsViolation({ code: "42501", message: "permission denied for table synthetic" })).toBe(
    false,
  );
  expect(isRlsViolation({ code: "23505", message: "row-level security" })).toBe(false);
  const cycle = new Error("cycle");
  cycle.cause = cycle;
  expect(isRlsViolation(cycle)).toBe(false);
});

test("observer reports only after rollback, preserves error identity and omits SQL details", async () => {
  const error = Object.assign(new Error("new row violates row-level security policy"), {
    code: "42501",
    detail: "private",
  });
  const sequence = [];
  const actor = { userId: "00000000-0000-4000-8000-000000000001", role: "user" };
  const database = {
    transaction: async () => {
      sequence.push("rollback");
      throw error;
    },
    close: async () => {},
  };
  const monitored = observeRlsViolations(
    database,
    async (context) => {
      sequence.push("report");
      expect(context).toEqual(actor);
      throw new Error("notification unavailable");
    },
    () => sequence.push("report-failed"),
  );
  await expect(monitored.transaction(actor, async () => {})).rejects.toBe(error);
  expect(sequence).toEqual(["rollback", "report", "report-failed"]);
});
