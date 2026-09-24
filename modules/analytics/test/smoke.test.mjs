import { createRequire } from "node:module";
import { expect, test } from "vitest";

for (const entry of ["contracts", "server", "jobs", "ui"]) {
  test(`public entry point: ${entry}`, async () => {
    const loaded = await import(`@oliginvest/mod-analytics/${entry}`);
    expect(loaded).toBeDefined();
  });
}

test("private module definition is not exported", () => {
  const require = createRequire(import.meta.url);
  expect(() => require.resolve("@oliginvest/mod-analytics/module")).toThrowError(
    expect.objectContaining({ code: "ERR_PACKAGE_PATH_NOT_EXPORTED" }),
  );
});
