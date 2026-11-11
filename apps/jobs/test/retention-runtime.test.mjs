import { Metrics } from "@oliginvest/platform";
import { expect, test } from "vitest";
import { enqueueRetention, processRetention, RETENTION_JOB } from "../src/retention-runtime.js";

function fakeDatabase(estimate = "42") {
  return {
    async transaction(_context, work) {
      return work({
        async execute(query) {
          const sql = JSON.stringify(query);
          if (sql.includes("user_directory")) return { rows: [] };
          if (sql.includes("pg_class")) return { rows: [{ estimate }] };
          if (sql.includes("pg_try_advisory_xact_lock")) return { rows: [{ acquired: true }] };
          return { rowCount: 0, rows: [] };
        },
      });
    },
  };
}

function recorder() {
  const entries = [];
  const push = (level) => (entry) => entries.push({ level, ...entry });
  return { entries, info: push("info"), warn: push("warn"), error: push("error") };
}

test("retention is queued once per run with deduplication and no extra retries", async () => {
  const calls = [];
  await enqueueRetention({ add: async (...args) => calls.push(args) });
  expect(calls).toEqual([
    [
      RETENTION_JOB,
      {},
      {
        deduplication: { id: RETENTION_JOB },
        removeOnComplete: true,
        removeOnFail: { age: 86400 },
      },
    ],
  ]);
  expect(calls[0][2]).not.toHaveProperty("attempts");
});

test("a run reports counts per target and audit size without identifiers", async () => {
  const metrics = new Metrics();
  const logger = recorder();
  await processRetention({}, { database: fakeDatabase(), logger, metrics });
  const rendered = metrics.render();
  for (const target of ["import_files", "invitations", "role_quota_usage", "web_vitals"])
    expect(rendered).toContain(`retention_rows_total{target="${target}"} 0`);
  expect(rendered).toContain("audit_log_rows_estimate 42");
  expect(logger.entries.map((e) => e.event)).toEqual(["retention.completed"]);
  expect(Object.keys(logger.entries[0]).sort()).toEqual(["duration_ms", "event", "level"]);
});

test("audit above the documented threshold raises a warning, never a deletion", async () => {
  const logger = recorder();
  await processRetention({}, { database: fakeDatabase("1000001"), logger });
  expect(logger.entries[0]).toEqual({
    level: "warn",
    event: "retention.audit_partitioning_due",
    code: "AUDIT_PARTITIONING_DUE",
  });
  await expect(
    processRetention({ unexpected: true }, { database: fakeDatabase(), logger }),
  ).rejects.toThrow();
});
