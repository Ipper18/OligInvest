import { randomInt } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Decimal } from "@oliginvest/core";
import { expect, test, vi } from "vitest";
import * as XLSX from "xlsx";
import { anonymizeFile, anonymizeXtb } from "../src/import/anonymize.js";
import { parseXtb } from "../src/import/xtb.js";

vi.mock("node:crypto", async (original) => {
  const crypto = await original();
  return { ...crypto, randomInt: vi.fn(crypto.randomInt) };
});

function seeded(bytes, seed = 731) {
  let output;
  randomInt.withImplementation(
    (min, max) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return min + (seed % (max - min));
    },
    () => {
      output = parseXtb(anonymizeXtb(bytes, "PLN"), account).rows;
    },
  );
  return output;
}

function assertCash(rows) {
  let cash = new Decimal(0);
  for (const row of [...rows].sort((a, b) =>
    a.input.executedAt.localeCompare(b.input.executedAt),
  )) {
    cash = cash.plus(row.raw.amount);
    expect(cash.gte(0)).toBe(true);
  }
}

function series(changed = false) {
  const lines = ["Currency;PLN", "Type;Ticker;Time;Amount;ID;Comment;Quantity"];
  lines.push(
    `deposit;;${changed ? "2018" : "2020"}-01-02 10:00:00;${changed ? "7654321" : "100000000"};fund;;`,
  );
  for (let i = 0; i < 480; i++) {
    const date = new Date(Date.UTC(changed ? 2018 : 2020, 0, 3 + i * (changed ? 3 : 1)));
    const q = changed ? 100 + (i % 31) : 1 + (i % 13);
    const p = changed ? 1000 + (i % 17) * 13 : 10 + i;
    lines.push(
      `stock purchase;PRIVATE.PL;${date.toISOString().slice(0, 10)} 10:00:00;-${q * p};buy${i};OPEN BUY ${q} @ ${p};${q}`,
    );
    lines.push(
      `stock sale;PRIVATE.PL;${date.toISOString().slice(0, 10)} 12:00:00;${q * (p + 3)};sell${i};CLOSE BUY ${q} @ ${p + 3};${q}`,
    );
  }
  return Buffer.from(lines.join("\n"));
}

function correlation(xs, ys) {
  const mean = (vs) => vs.reduce((a, b) => a + b, 0) / vs.length;
  const x = xs.map((v) => v - mean(xs)),
    y = ys.map((v) => v - mean(ys));
  return (
    x.reduce((s, v, i) => s + v * y[i], 0) /
    Math.sqrt(x.reduce((s, v) => s + v * v, 0) * y.reduce((s, v) => s + v * v, 0))
  );
}

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
    assertCash(after);
    expect(
      after.every((r) => ![0, 6].includes(new Date(`${r.input.tradeDate}T12:00:00Z`).getUTCDay())),
    ).toBe(true);
    expect(anonymizeXtb(input, "PLN").equals(output)).toBe(false);
  },
);

test("synthetic output is independent of input prices, quantities and amount magnitudes", () => {
  const before = parseXtb(series(), account).rows;
  const after = seeded(series());
  expect(after).toEqual(seeded(series(true)));
  for (const seed of [17, 2901]) expect(seeded(series(), seed)).toEqual(seeded(series(true), seed));
  const trades = after.filter((r) => r.input.type === "BUY");
  const source = before.filter((r) => r.input.type === "BUY");
  expect(
    Math.abs(
      correlation(
        source.map((r) => Number(r.input.price)),
        trades.map((r) => Number(r.input.price)),
      ),
    ),
  ).toBeLessThan(0.25);
  expect(
    new Set(trades.map((r, i) => new Decimal(r.raw.amount).div(source[i].raw.amount).toFixed(8)))
      .size,
  ).toBeGreaterThan(400);
  let held = new Decimal(0);
  for (const row of after) {
    if (!["BUY", "SELL"].includes(row.input.type)) continue;
    const gross = new Decimal(row.input.quantity)
      .mul(row.input.price)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    expect(new Decimal(row.raw.amount).abs().eq(gross)).toBe(true);
    held = held.plus(new Decimal(row.input.quantity).mul(row.input.type === "BUY" ? 1 : -1));
    expect(held.gte(0)).toBe(true);
  }
  assertCash(after);
});

test("reverse-ordered exports retain row order and funding, charges and split sales reconcile", () => {
  const lines = [
    "Currency;PLN",
    "Type;Ticker;Time;Amount;ID;Comment;Quantity",
    "deposit;;2020-01-03 10:00:00;10000;d1;;",
    "stock purchase;TEST.PL;2020-01-06 10:00:00;-100;b;OPEN BUY 2/3 @ 50;2",
    "commission;TEST.PL;2020-01-06 10:00:00;-1;c;;",
    "stock sale;TEST.PL;2020-01-07 10:00:00;100;s;CLOSE BUY 1 @ 110;1",
    "close trade;TEST.PL;2020-01-07 10:00:00;10;p;;",
    "sec fee;TEST.PL;2020-01-08 10:00:00;-0.1;sec;2020-01-07;",
    "deposit;;2020-01-09 10:00:00;200;d2;;",
    "withdrawal;;2020-01-10 10:00:00;-300;w;;",
  ];
  const output = seeded(
    Buffer.from([...lines.slice(0, 2), ...lines.slice(2).reverse()].join("\n")),
  );
  expect(output.map((r) => r.raw.type)).toEqual(
    lines
      .slice(2)
      .reverse()
      .map((l) => l.split(";")[0]),
  );
  expect(output.every((r) => r.status !== "error")).toBe(true);
  const buy = output.find((r) => r.input.type === "BUY");
  expect(buy.raw.comment).toMatch(/^OPEN BUY [\d.]+\/[\d.]+ @ [\d.]+$/);
  const buyGross = new Decimal(buy.input.quantity)
    .mul(buy.input.price)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  expect(new Decimal(buy.input.amount.amount).eq(buyGross.plus(buy.input.fee.amount).neg())).toBe(
    true,
  );
  const sell = output.find((r) => r.input.type === "SELL");
  expect(
    new Decimal(sell.input.amount.amount).eq(
      new Decimal(sell.input.quantity)
        .mul(sell.input.price)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    ),
  ).toBe(true);
  expect(output.find((r) => r.raw.type === "sec fee").relatedKey).toBe(sell.key);
  assertCash(output);
});

test("incomplete histories fail rather than create negative cash or add source rows", () => {
  const prefix = "Currency;PLN\nType;Ticker;Time;Amount;Comment\n";
  for (const row of [
    "withdrawal;;2020-01-03 10:00:00;-100;",
    "stock sale;TEST.PL;2020-01-03 10:00:00;100;CLOSE BUY 1 @ 100",
  ])
    expect(() => anonymizeXtb(Buffer.from(prefix + row), "PLN")).toThrow(
      "ANONYMIZATION_INCOMPLETE_HISTORY",
    );
});
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
