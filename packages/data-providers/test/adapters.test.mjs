import { expect, test, vi } from "vitest";
import * as XLSX from "xlsx";
import {
  FrankfurterProvider,
  GPW_HEADERS,
  NbpProvider,
  parseGpwWorkbook,
} from "../dist/adapters/index.js";

const now = () => new Date("2026-10-06T12:20:00Z");
test("NBP preserves all decimal digits and rejects changed schema", async () => {
  const request = vi.fn(
    async () =>
      new Response(
        '[{"table":"A","no":"195/A/NBP/2026","effectiveDate":"2026-10-06","rates":[{"currency":"dolar amerykański","code":"USD","mid":3.12345678}]}]',
      ),
  );
  const nbp = new NbpProvider(request, now);
  expect((await nbp.getFxRate("USD", "PLN", "2026-10-06"))[0]).toMatchObject({
    rate: "3.12345678",
    date: "2026-10-06",
    meta: { source: "nbp", stale: false, delayMinutes: 0 },
  });
  await expect(nbp.getTable("2026-01-01", "2026-04-04")).rejects.toThrow();
  expect(request).toHaveBeenCalledTimes(1);
});
test("NBP non-publication is no_data and never converted to today's exchange rate", async () => {
  const nbp = new NbpProvider(async () => {
    const { ProviderError } = await import("../dist/index.js");
    throw new ProviderError("provider_error", 1, 404);
  }, now);
  await expect(nbp.getFxRate("USD", "PLN", "2026-10-04")).rejects.toMatchObject({
    reason: "no_data",
  });
});
test("Frankfurter pins ECB, preserves source date and marks fallback", async () => {
  const request = vi.fn(
    async () =>
      new Response('[{"date":"2026-10-05","base":"USD","quote":"PLN","rate":3.12345678}]'),
  );
  const provider = new FrankfurterProvider(request, now);
  expect((await provider.getFxRate("USD", "PLN", "2026-10-05"))[0]).toMatchObject({
    rate: "3.12345678",
    meta: { source: "ecb", stale: true, staleReason: "provider_error" },
  });
  expect(String(request.mock.calls[0][0])).toContain("/providers/ecb/");
});
function workbook(row, mutate, bookType = "xls") {
  const sheet = XLSX.utils.aoa_to_sheet([GPW_HEADERS, row]);
  mutate?.(sheet);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Worksheet");
  return XLSX.write(book, { type: "buffer", bookType });
}
const row = [
  "2026-10-05",
  "SYNTH",
  "PLSYNTH00001",
  "PLN",
  "10.10",
  "10.30",
  "10.00",
  "10.20",
  "0",
  "1000",
  "10",
  "10.2",
  "0",
  "0",
  "0",
];
test("synthetic GPW BIFF8 maps by ISIN, scales turnover exactly, flags no trades", () => {
  const records = parseGpwWorkbook(workbook(row), "2026-10-05");
  expect(records[0]).toMatchObject({
    isin: "PLSYNTH00001",
    close: "10.20",
    turnover: "10200",
    noTrades: false,
  });
  expect(
    parseGpwWorkbook(
      workbook(row.map((value, index) => (index === 9 ? "0" : value))),
      "2026-10-05",
    )[0].noTrades,
  ).toBe(true);
});
test("GPW rejects wrong date, changed headers, formulas and oversized files", () => {
  expect(() => parseGpwWorkbook(workbook(row), "2026-10-06")).toThrow();
  expect(() =>
    parseGpwWorkbook(
      workbook(row, (sheet) => {
        sheet.A1.v = "Changed";
      }),
      "2026-10-05",
    ),
  ).toThrow();
  expect(() =>
    parseGpwWorkbook(
      workbook(
        row,
        (sheet) => {
          sheet.E2.f = "1+1";
        },
        "xlsx",
      ),
      "2026-10-05",
    ),
  ).toThrow();
  expect(() => parseGpwWorkbook(Buffer.alloc(10_000_001), "2026-10-05")).toThrow();
});
