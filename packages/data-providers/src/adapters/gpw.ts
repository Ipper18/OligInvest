import { Decimal } from "@oliginvest/core";
import * as XLSX from "xlsx";
import { z } from "zod";
import { currencySchema, decimalText, ProviderError } from "../contracts.js";

export const GPW_HEADERS = [
  "Data",
  "Nazwa",
  "ISIN",
  "Waluta",
  "Kurs otwarcia",
  "Kurs max",
  "Kurs min",
  "Kurs zamknięcia",
  "Zmiana",
  "Wolumen",
  "Liczba Transakcji",
  "Obrót",
  "Liczba otwartych pozycji",
  "Wartość otwartych pozycji",
  "Cena nominalna",
];
const gpwRecord = z
  .object({
    date: z.iso.date(),
    name: z.string().min(1),
    isin: z.string().regex(/^[A-Z]{2}[A-Z0-9]{9}\d$/u),
    currency: currencySchema,
    open: decimalText,
    high: decimalText,
    low: decimalText,
    close: decimalText,
    volume: decimalText,
    turnover: decimalText,
    noTrades: z.boolean(),
  })
  .strict();
export type GpwRecord = z.infer<typeof gpwRecord>;
export function parseGpwWorkbook(bytes: Uint8Array, date: string): GpwRecord[] {
  z.iso.date().parse(date);
  if (
    bytes.byteLength > 10_000_000 ||
    !Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from("d0cf11e0a1b11ae1", "hex"))
  )
    throw new ProviderError("provider_error");
  const workbook = XLSX.read(bytes, {
    type: "array",
    cellFormula: true,
    cellText: true,
    sheetRows: 50_002,
  });
  if (workbook.SheetNames.length !== 1 || workbook.SheetNames[0] !== "Worksheet")
    throw new ProviderError("provider_error");
  const sheet = workbook.Sheets.Worksheet;
  if (!sheet || XLSX.utils.decode_range(sheet["!fullref"] ?? sheet["!ref"] ?? "A1").e.r > 50_000)
    throw new ProviderError("provider_error");
  for (const [key, cell] of Object.entries(sheet))
    if (!key.startsWith("!") && cell.f) throw new ProviderError("provider_error");
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  });
  if (JSON.stringify(rows.shift()) !== JSON.stringify(GPW_HEADERS))
    throw new ProviderError("provider_error");
  return rows.map((row) => {
    if (row.length !== GPW_HEADERS.length || row[0] !== date)
      throw new ProviderError("provider_error");
    const decimal = (index: number) =>
      decimalText.parse(row[index]?.replaceAll("\u00a0", "").replaceAll(" ", "").replace(",", "."));
    return gpwRecord.parse({
      date: row[0],
      name: row[1],
      isin: row[2],
      currency: row[3],
      open: decimal(4),
      high: decimal(5),
      low: decimal(6),
      close: decimal(7),
      volume: decimal(9),
      turnover: new Decimal(decimal(11)).times("1000").toFixed(),
      noTrades: new Decimal(decimal(9)).isZero(),
    });
  });
}
export async function fetchGpw(date: string, request: typeof fetch): Promise<GpwRecord[]> {
  z.iso.date().parse(date);
  const formatted = `${date.slice(8, 10)}-${date.slice(5, 7)}-${date.slice(0, 4)}`;
  const response = await request(
    `https://www.gpw.pl/archiwum-notowan?fetch=1&type=10&instrument=&date=${formatted}`,
  );
  if (!response.headers.get("content-type")?.includes("application/vnd.ms-excel"))
    throw new ProviderError("provider_error");
  const reader = response.body?.getReader();
  if (!reader) throw new ProviderError("no_data");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 10_000_000) throw new ProviderError("provider_error");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return parseGpwWorkbook(Buffer.concat(chunks), date);
}
