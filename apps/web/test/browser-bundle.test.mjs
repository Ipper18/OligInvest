import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

function chunks(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? chunks(path) : path.endsWith(".js") ? [path] : [];
  });
}
test("production browser chunks do not contain the server API client or configuration", () => {
  const files = chunks(fileURLToPath(new URL("../.next/static", import.meta.url)));
  expect(files.length).toBeGreaterThan(0);
  for (const file of files)
    expect(readFileSync(file, "utf8")).not.toMatch(
      /API_INTERNAL_URL|API boundary violation|DB_APP_PASSWORD|server-only|openapi-fetch/,
    );
});

test("web sources do not load custom font faces or next/font", () => {
  function scan(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) scan(path);
      else if (/\.(tsx?|css)$/.test(path))
        expect(readFileSync(path, "utf8")).not.toMatch(/@font-face|next\/font/);
    }
  }
  scan(fileURLToPath(new URL("../src", import.meta.url)));
});
