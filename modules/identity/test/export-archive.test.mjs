import { inflateRawSync } from "node:zlib";
import { expect, test } from "vitest";
import { buildExportArchive, csvField, neutralizeCell, zip } from "../src/domain/export-archive.js";

// Synthetic data only (ADR-013).
const USER = "0198a000-0000-7000-8000-00000000000a";

/** Minimal reader for the archive written by `zip()` (central directory, deflate only). */
function unzip(bytes) {
  const buffer = Buffer.from(bytes);
  const end = buffer.length - 22;
  expect(buffer.readUInt32LE(end)).toBe(0x06054b50);
  const count = buffer.readUInt16LE(end + 10);
  let cursor = buffer.readUInt32LE(end + 16);
  const files = new Map();
  for (let index = 0; index < count; index += 1) {
    expect(buffer.readUInt32LE(cursor)).toBe(0x02014b50);
    expect(buffer.readUInt16LE(cursor + 8) & 0x0800).toBe(0x0800);
    const compressed = buffer.readUInt32LE(cursor + 20);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const offset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    const localName = buffer.readUInt16LE(offset + 26);
    const start = offset + 30 + localName + buffer.readUInt16LE(offset + 28);
    const data = inflateRawSync(buffer.subarray(start, start + compressed));
    expect(data.length).toBe(size);
    files.set(name, data);
    cursor += 46 + nameLength;
  }
  return files;
}

const datasets = [
  {
    name: "portfolio.transactions",
    columns: ["id", "quantity", "amount", "currency", "note", "metadata", "active", "row_number"],
    rows: [
      [
        "t1",
        "12.50000000",
        "-1204.20",
        "PLN",
        '=HYPERLINK("x")',
        { raw: '{"a": 1}' },
        true,
        { raw: "7" },
      ],
      ["t2", "1", "0.10", "USD", "@SUM(A1)", null, false, { raw: "8" }],
      ["t3", "3", "5", "EUR", 'line,with "quote"\nnext', null, null, null],
    ],
  },
  {
    name: "portfolio.import_files",
    columns: ["id", "content_type", "content"],
    rows: [["f1", "text/csv; charset=utf-8", new TextEncoder().encode("a;b\n1;2\n")]],
  },
];

test("CSV cells that start a formula are neutralized, plain numbers are not", () => {
  expect(neutralizeCell("=1+1")).toBe("'=1+1");
  expect(neutralizeCell("+48 600")).toBe("'+48 600");
  expect(neutralizeCell("-cmd")).toBe("'-cmd");
  expect(neutralizeCell("@SUM(A1)")).toBe("'@SUM(A1)");
  expect(neutralizeCell("\tx")).toBe("'\tx");
  expect(neutralizeCell("-1204.20")).toBe("-1204.20");
  expect(neutralizeCell("+5")).toBe("+5");
  expect(neutralizeCell("PLN")).toBe("PLN");
  expect(csvField('a,"b"')).toBe('"a,""b"""');
  expect(csvField("=A1,B1")).toBe('"\'=A1,B1"');
});

test("archive holds README, exact JSON, one CSV per dataset and binary files", () => {
  const files = unzip(
    buildExportArchive({
      userId: USER,
      exportedAt: new Date("2026-11-14T10:00:00.000Z"),
      datasets,
      readme: "Synthetic README",
    }),
  );
  expect([...files.keys()]).toEqual([
    "README.txt",
    "data.json",
    "csv/portfolio.transactions.csv",
    "csv/portfolio.import_files.csv",
    "files/portfolio.import_files/1-content.csv",
  ]);
  const data = JSON.parse(files.get("data.json").toString("utf8"));
  expect(data).toMatchObject({ format: "oliginvest-gdpr-export", version: 1, userId: USER });
  const [first] = data.datasets["portfolio.transactions"];
  // Amounts stay decimal strings (ADR-014); integers and JSON are literals.
  expect(first).toEqual({
    id: "t1",
    quantity: "12.50000000",
    amount: "-1204.20",
    currency: "PLN",
    note: '=HYPERLINK("x")',
    metadata: { a: 1 },
    active: true,
    row_number: 7,
  });
  expect(data.datasets["portfolio.import_files"][0].content).toBe(
    "files/portfolio.import_files/1-content.csv",
  );
  const csv = files.get("csv/portfolio.transactions.csv").toString("utf8");
  expect(csv.startsWith("﻿id,quantity,amount")).toBe(true);
  expect(csv).toContain(`t1,12.50000000,-1204.20,PLN,"'=HYPERLINK(""x"")",`);
  expect(csv).toContain("t2,1,0.10,USD,'@SUM(A1),,false,8\r\n");
  expect(csv).toContain('"line,with ""quote""\nnext"');
  expect(files.get("files/portfolio.import_files/1-content.csv").toString("utf8")).toBe(
    "a;b\n1;2\n",
  );
});

test("unsafe dataset or entry names and invalid raw JSON are rejected", () => {
  const base = { userId: USER, exportedAt: new Date(), readme: "" };
  expect(() =>
    buildExportArchive({ ...base, datasets: [{ name: "../evil", columns: [], rows: [] }] }),
  ).toThrow("EXPORT_DATASET_NAME_INVALID");
  expect(() =>
    buildExportArchive({
      ...base,
      datasets: [{ name: "x.y", columns: ["a"], rows: [[{ raw: "{broken" }]] }],
    }),
  ).toThrow();
  expect(() => zip([{ name: "a/../b", data: new Uint8Array() }], new Date())).toThrow(
    "EXPORT_ENTRY_NAME_INVALID",
  );
  expect(() =>
    zip(
      [
        { name: "a", data: new Uint8Array() },
        { name: "a", data: new Uint8Array() },
      ],
      new Date(),
    ),
  ).toThrow("EXPORT_ENTRY_DUPLICATE");
});
