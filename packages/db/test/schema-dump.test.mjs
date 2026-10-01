import { expect, test } from "vitest";
import { normalizeSchemaDump } from "../scripts/schema-dump.mjs";

test("dump normalization ignores only psql guards and the test database name", () => {
  expect(
    normalizeSchemaDump(
      "\\restrict random\r\nCREATE DATABASE bl007_reference;\r\n\\unrestrict random\r\n",
      "bl007_reference",
    ),
  ).toBe("CREATE DATABASE bl007_database;");
  for (const sql of [
    "ALTER TABLE portfolio.accounts OWNER TO oliginvest_owner;",
    "GRANT SELECT ON portfolio.accounts TO oliginvest_app;",
    "ALTER TABLE portfolio.accounts FORCE ROW LEVEL SECURITY;",
    "CREATE POLICY owner_all ON portfolio.accounts USING (false);",
    "COMMENT ON TABLE portfolio.accounts IS 'contract';",
    "ALTER TABLE portfolio.accounts ADD COLUMN unexpected text;",
  ]) {
    expect(normalizeSchemaDump(sql, "bl007_reference")).toBe(sql);
  }
  expect(() => normalizeSchemaDump("", "production")).toThrow("Unexpected test database");
});
