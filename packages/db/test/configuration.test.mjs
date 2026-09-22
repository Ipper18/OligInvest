import { expect, test } from "vitest";
import { createAppDatabase } from "../src/index.ts";

test("invalid pool configuration cannot override role or expose supplied secrets", () => {
  for (const input of [
    {},
    { host: "localhost", port: 0, database: "test", password: "synthetic-secret" },
    {
      host: "localhost",
      port: 5432,
      database: "test",
      password: "synthetic-secret",
      user: "postgres",
    },
    {
      host: "localhost",
      port: 5432,
      database: "test",
      password: "synthetic-secret",
      options: "-c app.role=admin",
    },
  ]) {
    expect(() => createAppDatabase(input)).toThrow(/^Invalid database configuration$/);
  }
});
