import { readFile } from "node:fs/promises";
import { getTableConfig } from "drizzle-orm/pg-core";
import { expect, test } from "vitest";

test("Drizzle covers every normative table and keeps numeric values as strings", async () => {
  const ddl = await readFile(new URL("../../../docs/03-dane/schema.sql", import.meta.url), "utf8");
  const expected = [...ddl.matchAll(/CREATE TABLE (\w+\.\w+)/g)].map((match) => match[1]).sort();
  const paths = [
    "identity",
    "notifications",
    "market",
    "portfolio",
    "analytics",
    "alerts",
    "education",
  ];
  const schemas = await Promise.all(
    paths.map((name) => import(`../../../modules/${name}/db/schema.ts`)),
  );
  schemas.push(await import("../src/schema.ts"));
  const tables = schemas.flatMap((schema) =>
    Object.values(schema).filter((value) => {
      try {
        getTableConfig(value);
        return true;
      } catch {
        return false;
      }
    }),
  );
  expect(
    tables
      .map((table) => {
        const c = getTableConfig(table);
        return `${c.schema}.${c.name}`;
      })
      .sort(),
  ).toEqual(expected);
  for (const table of tables) {
    for (const column of getTableConfig(table).columns) {
      if (column.getSQLType().startsWith("numeric")) {
        expect(column.mapFromDriverValue("123456789012.12345678")).toBe("123456789012.12345678");
      }
    }
  }
});
