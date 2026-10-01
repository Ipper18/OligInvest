import { expect, test } from "vitest";
import { selectById } from "../spike/typescript-7.ts";

test("Drizzle compiles a typed parameterized PostgreSQL query without I/O", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const query = selectById(id);
  expect(query.sql).toContain("$1");
  expect(query.sql).not.toContain(id);
  expect(query.params).toEqual([id]);
});
