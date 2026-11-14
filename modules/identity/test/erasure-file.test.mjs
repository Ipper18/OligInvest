import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { syncErasureFile } from "../src/gdpr.js";

// Synthetic identifiers only (ADR-013).
const OLD = "0198a000-0000-7000-8000-0000000000a1";
const KEPT = "0198a000-0000-7000-8000-0000000000a2";
const NEW = "0198a000-0000-7000-8000-0000000000a3";
const NOW = new Date("2026-11-14T03:30:00.000Z");
let directory;

/** The function only reads `platform.erasure_log` in the system context. */
function database(rows) {
  return {
    transaction: async (context, work) => {
      expect(context).toEqual({ userId: null, role: "system" });
      return work({ execute: async () => ({ rows }) });
    },
  };
}
const line = (id, at) => `${JSON.stringify({ erased_user_id: id, erased_at: at })}\n`;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "erasure-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

test("appends identifiers missing from the file without rewriting it", async () => {
  const file = join(directory, "erasure-log.jsonl");
  await writeFile(file, line(KEPT, "2026-11-01T00:00:00.000000Z"));
  const result = await syncErasureFile(
    database([
      { id: KEPT, at: "2026-11-01T00:00:00.000000Z" },
      { id: NEW, at: "2026-11-14T03:30:00.000000Z" },
    ]),
    file,
    NOW,
  );
  expect(result).toEqual({ appended: 1, removed: 0, invalid: 0, unrecorded: [] });
  expect(await readFile(file, "utf8")).toBe(
    line(KEPT, "2026-11-01T00:00:00.000000Z") + line(NEW, "2026-11-14T03:30:00.000000Z"),
  );
});

test("purges lines older than 40 days, keeps damaged lines and reports unrecorded ids", async () => {
  const file = join(directory, "erasure-log.jsonl");
  await writeFile(
    file,
    `${line(OLD, "2026-09-01T00:00:00.000000Z")}not json\n${line(KEPT, "2026-11-01T00:00:00.000000Z")}`,
  );
  const result = await syncErasureFile(database([]), file, NOW);
  expect(result).toEqual({ appended: 0, removed: 1, invalid: 1, unrecorded: [KEPT] });
  expect(await readFile(file, "utf8")).toBe(`not json
${line(KEPT, "2026-11-01T00:00:00.000000Z")}`);
});

test("a missing file or relative path fails instead of creating one", async () => {
  await expect(
    syncErasureFile(database([]), join(directory, "missing.jsonl"), NOW),
  ).rejects.toThrow(expect.objectContaining({ code: "ENOENT" }));
  await expect(syncErasureFile(database([]), "erasure-log.jsonl", NOW)).rejects.toThrow(
    "ERASURE_FILE_PATH_INVALID",
  );
});
