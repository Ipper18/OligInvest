import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { describe, expect, test } from "vitest";
import * as XLSX from "xlsx";
import { parseXtb } from "../src/import/xtb.js";

const accountId = "0198a000-0000-7000-8000-000000000001";
const fixture = (kind) =>
  readFileSync(
    new URL(
      `../../../docs/03-dane/fixtures/anonymized/xtb/xtb-syntetyczny-${kind}-szablon-PLN.xlsx`,
      import.meta.url,
    ),
  );
const parse = (bytes) => parseXtb(bytes, { id: accountId, currency: "PLN" });
const csv = (lines) =>
  Buffer.from(["Currency;PLN", "Type;Ticker;Time;Amount;ID;Comment;Product", ...lines].join("\n"));
describe("XTB content detection and lossless parsing", () => {
  test("both generations preserve every cash row, paired sales, CFD and incomplete dividend", () => {
    const modern = parse(fixture("nowy"));
    const legacy = parse(fixture("stary"));
    const logical = (result) =>
      result.rows.map(({ key, status, reason, input, relatedKey }) => ({
        key,
        status,
        reason,
        input: { ...input, sequence: undefined },
        relatedKey,
      }));
    expect(logical(legacy)).toEqual(logical(modern));
    expect(modern.rows).toHaveLength(17);
    expect(modern.rows.find((r) => r.key === "900008").input.amount.amount).toBe("10023.63");
    expect(modern.rows.find((r) => r.key === "900004")).toMatchObject({
      status: "unsupported",
      input: { type: "ADJUSTMENT", category: "cfd_pl", amount: { amount: "45.1" } },
    });
    expect(modern.rows.find((r) => r.key === "900006")).toMatchObject({
      status: "error",
      reason: "missing_dividend_details",
      input: { amount: { amount: "12.14" }, price: "0.26", priceCurrency: "USD" },
    });
    expect(modern.rows.find((r) => r.key === "900010").relatedKey).toBe("900008");
    expect(legacy.positions).toEqual({ "AAPL.US": "3", "PKO.PL": "15", "VWCE.DE": "0.75" });
  });
  test("CSV quotes, Polish decimals, signed deposits, fallback IDs and DST boundaries", () => {
    const result = parse(
      csv([
        'deposit;;2025-01-10 10:00:00;"1 234,56";;"quoted; text";',
        'deposit;;2025-01-10 10:00:00;"1 234,56";;"quoted; text";',
        "withdrawal;;2025-07-10 10:00:00;10;x;;",
        "deposit;;2025-03-30 02:30:00;10;y;;",
      ]),
    );
    expect(result.rows[0].input.amount.amount).toBe("1234.56");
    expect(result.rows[0].key).not.toBe(result.rows[1].key);
    expect(result.rows[0].input.executedAt).toBe("2025-01-10T09:00:00.000Z");
    expect(result.rows[2].input.executedAt).toBe("2025-07-10T08:00:00.000Z");
    expect(result.rows[2].input.type).toBe("DEPOSIT");
    expect(result.rows[3].status).toBe("error");
    expect(parse(csv(["unknown;;2025-01-10 10:00:00;1;x;;"])).rows[0].status).toBe("unsupported");
  });
  test("rejects wrong currency, excessive size, formulas and ZIP expansion", () => {
    expect(() => parse(Buffer.alloc(10485761))).toThrow();
    expect(() => parseXtb(fixture("nowy"), { id: accountId, currency: "USD" })).toThrow();
    const book = XLSX.read(fixture("nowy"));
    book.Sheets[book.SheetNames[0]].E6 = { t: "n", v: 1, f: "1+1" };
    expect(() => parse(XLSX.write(book, { type: "buffer", bookType: "xlsx" }))).toThrow();
    const bytes = Buffer.from(fixture("nowy"));
    const entry = bytes.indexOf(Buffer.from("504b0102", "hex"));
    bytes.writeUInt32LE(52428801, entry + 24);
    expect(() => parse(bytes)).toThrow();
  });
  test("5000 rows parse within 30 seconds and 50001 rows fail closed", () => {
    const rows = Array.from({ length: 5000 }, (_, i) => `deposit;;2025-01-10 10:00:00;1;${i};;`);
    const start = performance.now();
    expect(parse(csv(rows)).rows).toHaveLength(5000);
    expect(performance.now() - start).toBeLessThan(30000);
    expect(() => parse(csv(Array(50001).fill(rows[0])))).toThrow();
  });
});
