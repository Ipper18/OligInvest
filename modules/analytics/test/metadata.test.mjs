import { analyticsSeriesMetadataSchema } from "@oliginvest/contracts";
import { PgDialect } from "drizzle-orm/pg-core";
import { expect, test } from "vitest";
import { runDto } from "../dist/src/server/runs.js";
import { collectSeriesMetadata } from "../dist/src/server/series-metadata.js";

const id = "01900000-0000-7000-8000-000000000001";
test("metadata is strict and optional for existing DTOs", () => {
  const row = {
    id,
    type: "monte_carlo",
    status: "done",
    progress: 100,
    params: {},
    result: null,
    assumptions: null,
    warnings: [],
    seed: 42,
    algorithmVersion: "mc-1",
    dataVersion: null,
    error: null,
    createdAt: "2026-10-01T00:00:00Z",
    startedAt: null,
    finishedAt: null,
    durationMs: null,
  };
  expect(runDto(row)).not.toHaveProperty("seriesMetadata");
  const seriesMetadata = [
    {
      seriesKey: id,
      meta: { source: "yahoo", asOf: "2026-09-30T00:00:00Z", delayMinutes: 0, stale: false },
    },
  ];
  expect(runDto({ ...row, dataVersion: { seriesMetadata } }).seriesMetadata).toEqual(
    seriesMetadata,
  );
  expect(
    analyticsSeriesMetadataSchema.safeParse([{ ...seriesMetadata[0], extra: true }]).success,
  ).toBe(false);
});
test("collector scopes monthly observations to result ranges, preserves sources and quality", async () => {
  const queries = [];
  const tx = {
    execute: async (sql) => {
      queries.push(new PgDialect().sqlToQuery(sql));
      return {
        rows: [
          { seriesKey: id, source: "yahoo", date: "2026-09-30", quality: "WARN" },
          { seriesKey: "fx:USD", source: "nbp", date: "2026-09-30", quality: null },
        ],
      };
    },
  };
  const result = {
    result: { kind: "monte_carlo" },
    assumptions: {},
    reproducibility: { dataVersion: { [id]: "2000-01..2026-09" } },
  };
  const meta = await collectSeriesMetadata(tx, result, {});
  expect(meta).toHaveLength(2);
  expect(meta[0].meta).toMatchObject({
    source: "yahoo",
    qualityStatus: "WARN",
    stale: false,
    delayMinutes: 0,
  });
  expect(queries[0].sql).toContain("DISTINCT ON");
  expect(queries[0].params).toContain("2000-01-01");
  expect(queries[0].params).toContain("2026-09-30");
  expect(queries[0].sql).not.toContain(id);
});
test("missing provenance remains missing; BLOCK is explicit", async () => {
  const result = {
    result: { kind: "goal" },
    assumptions: {},
    reproducibility: { dataVersion: {} },
  };
  expect(
    await collectSeriesMetadata(
      {
        execute: () => {
          throw Error("unexpected query");
        },
      },
      result,
      {},
    ),
  ).toEqual([]);
  result.reproducibility.dataVersion[id] = "2000-01..2026-09";
  const meta = await collectSeriesMetadata(
    {
      execute: async () => ({
        rows: [{ seriesKey: id, source: "gpw", date: "2026-09-30", quality: "BLOCK" }],
      }),
    },
    result,
    {},
  );
  expect(meta[0].meta).toMatchObject({
    stale: true,
    staleReason: "data_quality_hold",
    qualityStatus: "BLOCK",
  });
});
