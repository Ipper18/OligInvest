import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import * as XLSX from "xlsx";
import { anonymizeFile, anonymizeXtb } from "../src/import/anonymize.js";
import { parseXtb } from "../src/import/xtb.js";

const account = { id: "0198a000-0000-7000-8000-000000000001", currency: "PLN" };
const fixture = (kind) =>
  readFileSync(
    new URL(`./fixtures/anonymized/xtb/xtb-syntetyczny-${kind}-szablon-PLN.xlsx`, import.meta.url),
  );
test.each(["nowy", "stary"])(
  "anonymization of %s drops metadata and preserves paired cash structure",
  (kind) => {
    const source = XLSX.read(fixture(kind));
    source.Props = { Author: "PRIVATE_PERSON", Company: "PRIVATE_COMPANY" };
    source.Custprops = { Account: "PRIVATE_ACCOUNT" };
    XLSX.utils.book_append_sheet(
      source,
      XLSX.utils.aoa_to_sheet([["PRIVATE_HIDDEN"]]),
      "PRIVATE_SHEET",
    );
    const input = XLSX.write(source, { type: "buffer", bookType: "xlsx" });
    const output = anonymizeXtb(input, "PLN");
    const book = XLSX.read(output);
    const visible = JSON.stringify(book);
    expect(visible).not.toMatch(/PRIVATE_|90000[1-9]|AAPL|VWCE|PKO/);
    expect(book.SheetNames).toEqual(["Cash Operations"]);
    const before = parseXtb(input, account).rows;
    const after = parseXtb(output, account).rows;
    expect(after).toHaveLength(before.length);
    expect(after.map((r) => [r.status, r.reason, r.input.type])).toEqual(
      before.map((r) => [r.status, r.reason, r.input.type]),
    );
    expect(after.every((r, i) => r.input.tradeDate !== before[i].input.tradeDate)).toBe(true);
    expect(after.filter((r) => r.relatedKey)).toHaveLength(1);
    expect(after[0].raw.amount).not.toBe(before[0].raw.amount);
    expect(anonymizeXtb(input, "PLN").equals(output)).toBe(false);
  },
);
test("invalid/unknown rows, currency mismatch and formulas fail without returning source text", () => {
  const bytes = Buffer.from(
    "Currency;PLN\nType;Time;Amount;Comment\nPRIVATE_PERSON;2025-01-01 10:00:00;1;PRIVATE_ACCOUNT",
  );
  expect(() => anonymizeXtb(bytes, "PLN")).toThrow("ANONYMIZATION_UNSUPPORTED_ROW");
  expect(() => anonymizeXtb(fixture("nowy"), "USD")).toThrow();
  const book = XLSX.read(fixture("nowy"));
  book.Sheets[book.SheetNames[0]].E6 = { t: "n", v: 1, f: "1+1" };
  expect(() =>
    anonymizeXtb(XLSX.write(book, { type: "buffer", bookType: "xlsx" }), "PLN"),
  ).toThrow();
});
test("file helper refuses repository paths, overwriting and oversized inputs; leaves source untouched", () => {
  const dir = mkdtempSync(join(tmpdir(), "oliginvest-anonymize-"));
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const input = join(dir, "original.xlsx"),
    output = join(dir, "review.xlsx");
  try {
    const bytes = fixture("nowy");
    writeFileSync(input, bytes);
    anonymizeFile(input, output, "PLN", root);
    expect(readFileSync(input)).toEqual(bytes);
    const result = readFileSync(output);
    expect(() => anonymizeFile(input, output, "PLN", root)).toThrow();
    expect(readFileSync(output)).toEqual(result);
    expect(() => anonymizeFile(input, join(root, "review.xlsx"), "PLN", root)).toThrow(
      "PATH_MUST_BE_OUTSIDE_REPOSITORY",
    );
    expect(() =>
      anonymizeFile(
        fileURLToPath(
          new URL(
            "./fixtures/anonymized/xtb/xtb-syntetyczny-nowy-szablon-PLN.xlsx",
            import.meta.url,
          ),
        ),
        join(dir, "other.xlsx"),
        "PLN",
        root,
      ),
    ).toThrow("PATH_MUST_BE_OUTSIDE_REPOSITORY");
    writeFileSync(input, Buffer.alloc(10485761));
    expect(() => anonymizeFile(input, join(dir, "big.xlsx"), "PLN", root)).toThrow();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
