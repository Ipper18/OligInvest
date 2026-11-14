import { crc32, deflateRawSync } from "node:zlib";

/**
 * GDPR data export archive (BL-114, FR-07.09): `data.json` (every dataset), one CSV per
 * dataset and the user's uploaded files. Pure functions over values already read under the
 * owner's RLS context; the ZIP container uses only `node:zlib` (no archive dependency).
 *
 * Values keep their exact database text: numeric and bigint columns stay decimal strings
 * (ADR-014), integers and JSON documents are spliced as JSON literals, timestamps are UTC ISO.
 */
export type ExportValue = null | boolean | string | { readonly raw: string } | Uint8Array;
export interface ExportDataset {
  /** `schema.table` (or `auth.<name>` for account data returned by `identity.export_auth_data`). */
  readonly name: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly ExportValue[])[];
}
export interface ArchiveEntry {
  readonly name: string;
  readonly data: Uint8Array;
}

export const EXPORT_FORMAT = "oliginvest-gdpr-export";
export const EXPORT_FORMAT_VERSION = 1;
/** The stored archive must stay well inside the jobs container memory limit (384 MiB). */
export const EXPORT_MAX_BYTES = 64 * 1024 * 1024;
const ZIP_MAX_ENTRIES = 0xffff;
const ZIP_MAX_BYTES = 0xffffffff;

const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;
const formulaStart = /^[=+\-@\t\r]/u;
const safeName = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const fileTypes: Readonly<Record<string, string>> = Object.freeze({
  "text/csv": "csv",
  "text/plain": "txt",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
});

/**
 * CSV injection (OWASP): a cell starting with `=`, `+`, `-`, `@`, tab or CR is prefixed with an
 * apostrophe so spreadsheets show it as text. Plain numbers (for example `-1204.20`) cannot run
 * as formulas and stay unchanged, so amounts remain numeric.
 */
export function neutralizeCell(value: string): string {
  return formulaStart.test(value) && !numeric.test(value) ? `'${value}` : value;
}

/** RFC 4180 field: neutralized first, then quoted when it holds a separator, quote or newline. */
export function csvField(value: string): string {
  const safe = neutralizeCell(value);
  return /[",\r\n]|^\s|\s$/u.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function isRaw(value: ExportValue): value is { readonly raw: string } {
  return typeof value === "object" && value !== null && !(value instanceof Uint8Array);
}

function datasetName(name: string): string {
  if (!safeName.test(name)) throw new Error("EXPORT_DATASET_NAME_INVALID");
  return name;
}

function fileExtension(dataset: ExportDataset, row: readonly ExportValue[]): string {
  const index = dataset.columns.indexOf("content_type");
  const value = index < 0 ? undefined : row[index];
  const type = typeof value === "string" ? (value.split(";")[0]?.trim().toLowerCase() ?? "") : "";
  return Object.hasOwn(fileTypes, type) ? (fileTypes[type] ?? "bin") : "bin";
}

/** Binary cells become archive files; the cell then holds the file's path. */
function resolveFiles(datasets: readonly ExportDataset[]) {
  const files: ArchiveEntry[] = [];
  const resolved = datasets.map((dataset) => ({
    name: datasetName(dataset.name),
    columns: dataset.columns,
    rows: dataset.rows.map((row, rowIndex) =>
      row.map((value, columnIndex): Exclude<ExportValue, Uint8Array> => {
        if (!(value instanceof Uint8Array)) return value;
        const column = dataset.columns[columnIndex] ?? "file";
        const path = `files/${dataset.name}/${rowIndex + 1}-${column}.${fileExtension(dataset, row)}`;
        files.push({ name: path, data: value });
        return path;
      }),
    ),
  }));
  return { resolved, files };
}

function jsonValue(value: Exclude<ExportValue, Uint8Array>): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (isRaw(value)) return value.raw;
  return JSON.stringify(value);
}

function csvValue(value: Exclude<ExportValue, Uint8Array>): string {
  if (value === null) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return isRaw(value) ? value.raw : value;
}

export function buildExportArchive(input: {
  readonly userId: string;
  readonly exportedAt: Date;
  readonly datasets: readonly ExportDataset[];
  readonly readme: string;
}): Uint8Array {
  const { resolved, files } = resolveFiles(input.datasets);
  const encoder = new TextEncoder();
  const json = [
    `{"format":${JSON.stringify(EXPORT_FORMAT)},"version":${EXPORT_FORMAT_VERSION}`,
    `,"exportedAt":${JSON.stringify(input.exportedAt.toISOString())}`,
    `,"userId":${JSON.stringify(input.userId)},"datasets":{`,
    resolved
      .map(
        (dataset) =>
          `${JSON.stringify(dataset.name)}:[${dataset.rows
            .map(
              (row) =>
                `{${dataset.columns
                  .map(
                    (column, index) => `${JSON.stringify(column)}:${jsonValue(row[index] ?? null)}`,
                  )
                  .join(",")}}`,
            )
            .join(",")}]`,
      )
      .join(","),
    "}}",
  ].join("");
  // Fails fast if a raw literal from the database was not valid JSON.
  JSON.parse(json);
  const entries: ArchiveEntry[] = [
    { name: "README.txt", data: encoder.encode(input.readme) },
    { name: "data.json", data: encoder.encode(json) },
    ...resolved.map((dataset) => ({
      name: `csv/${dataset.name}.csv`,
      data: encoder.encode(
        `﻿${[dataset.columns, ...dataset.rows.map((row) => row.map(csvValue))]
          .map((line) => line.map(csvField).join(","))
          .join("\r\n")}\r\n`,
      ),
    })),
    ...files,
  ];
  return zip(entries, input.exportedAt);
}

function dosDateTime(at: Date) {
  const year = Math.max(1980, at.getUTCFullYear());
  return {
    time: (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | Math.floor(at.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate(),
  };
}

/** Minimal ZIP (APPNOTE 6.3.10): deflate, UTF-8 names (flag bit 11), no ZIP64, no encryption. */
export function zip(entries: readonly ArchiveEntry[], modified: Date): Uint8Array {
  if (entries.length > ZIP_MAX_ENTRIES) throw new Error("EXPORT_TOO_MANY_FILES");
  const { time, date } = dosDateTime(modified);
  const names = new Set<string>();
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,250}$/u.test(entry.name) || entry.name.includes(".."))
      throw new Error("EXPORT_ENTRY_NAME_INVALID");
    if (names.has(entry.name)) throw new Error("EXPORT_ENTRY_DUPLICATE");
    names.add(entry.name);
    const name = Buffer.from(entry.name, "utf8");
    const data = deflateRawSync(entry.data);
    const checksum = crc32(entry.data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(entry.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x0800, 8);
    record.writeUInt16LE(8, 10);
    record.writeUInt16LE(time, 12);
    record.writeUInt16LE(date, 14);
    record.writeUInt32LE(checksum, 16);
    record.writeUInt32LE(data.length, 20);
    record.writeUInt32LE(entry.data.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(offset, 42);
    local.push(header, name, data);
    central.push(record, name);
    offset += header.length + name.length + data.length;
    if (offset > ZIP_MAX_BYTES || entry.data.length > ZIP_MAX_BYTES)
      throw new Error("EXPORT_TOO_LARGE");
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  const archive = Buffer.concat([...local, directory, end]);
  if (archive.length > EXPORT_MAX_BYTES) throw new Error("EXPORT_TOO_LARGE");
  return new Uint8Array(archive.buffer, archive.byteOffset, archive.length);
}
