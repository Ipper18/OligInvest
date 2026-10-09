import { inflateRawSync } from "node:zlib";
import * as XLSX from "xlsx";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_EXPANDED = 50 * 1024 * 1024;
function reject(): never {
  throw new Error("IMPORT_FORMAT_UNKNOWN");
}

/** Inspect and inflate bounded ZIP entries before handing the archive to SheetJS. */
function checkZip(bytes: Buffer) {
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (
      bytes.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + bytes.readUInt16LE(i + 20) === bytes.length
    ) {
      end = i;
      break;
    }
  if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) reject();
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16),
    total = 0;
  if (!count || count > 100 || bytes.readUInt16LE(end + 8) !== count) reject();
  const names = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50) reject();
    const flags = bytes.readUInt16LE(offset + 8),
      method = bytes.readUInt16LE(offset + 10);
    const compressed = bytes.readUInt32LE(offset + 20),
      size = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28),
      extra = bytes.readUInt16LE(offset + 30),
      comment = bytes.readUInt16LE(offset + 32);
    const local = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    total += size;
    if (
      flags & 1 ||
      ![0, 8].includes(method) ||
      total > MAX_EXPANDED ||
      size > Math.max(1, compressed) * 100 ||
      names.has(name) ||
      /(^[/\\]|\.\.)/.test(name)
    )
      reject();
    names.add(name);
    if (
      local + 30 > offset ||
      bytes.readUInt32LE(local) !== 0x04034b50 ||
      bytes.readUInt16LE(local + 8) !== method
    )
      reject();
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    if (start + compressed > offset) reject();
    const input = bytes.subarray(start, start + compressed);
    const output =
      method === 0 ? input : inflateRawSync(input, { maxOutputLength: Math.max(1, size) });
    if (output.length !== size) reject();
    offset += 46 + nameLength + extra + comment;
  }
  if (offset !== end) reject();
}
function decodeCsv(bytes: Buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1250", { fatal: true }).decode(bytes);
  }
}
export function readImportWorkbook(bytes: Uint8Array): XLSX.WorkBook {
  if (!bytes.byteLength || bytes.byteLength > MAX_FILE_BYTES) throw new Error("FILE_TOO_LARGE");
  const buffer = Buffer.from(bytes);
  const zip = buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50;
  const biff = buffer.subarray(0, 8).equals(Buffer.from("d0cf11e0a1b11ae1", "hex"));
  if (zip) checkZip(buffer);
  const book = XLSX.read(zip || biff ? buffer : decodeCsv(buffer), {
    type: zip || biff ? "buffer" : "string",
    raw: true,
    cellFormula: true,
    cellText: false,
    cellDates: false,
    sheetRows: 50042,
  });
  let rows = 0;
  for (const sheet of Object.values(book.Sheets)) {
    const range = XLSX.utils.decode_range(sheet["!fullref"] ?? sheet["!ref"] ?? "A1");
    rows += range.e.r + 1;
    if (range.e.c > 100 || rows > 50400) reject();
    for (const [key, cell] of Object.entries(sheet))
      if (!key.startsWith("!") && (cell.f || cell.l || String(cell.v ?? "").length > 10000))
        reject();
  }
  return book;
}
export function grid(sheet: XLSX.WorkSheet): string[][] {
  return XLSX.utils
    .sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "", blankrows: true })
    .map((row) => row.map((v) => String(v)));
}
