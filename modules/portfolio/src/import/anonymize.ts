import { randomInt } from "node:crypto";
import { readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { Decimal } from "@oliginvest/core";
import * as XLSX from "xlsx";
import { z } from "zod";
import { decimalText, parseXtb, xtbInstant } from "./xtb.js";

const currencySchema = z.enum(["PLN", "USD", "EUR"]);
const allowedTypes = new Set([
  "deposit",
  "withdrawal",
  "subaccount transfer",
  "stock purchase",
  "zakup akcji/etf",
  "stock sale",
  "close trade",
  "divident",
  "dividend",
  "dywidenda",
  "free-funds interest",
  "free-funds interest tax",
  "sec fee",
  "commission",
  "withholding tax",
  "podatek od dywidend",
  "swap",
  "rollover",
  "dividend equivalent",
  "tax if",
]);

/** Reconstruct only known fields; never copy workbook metadata or free-form source text. */
export function anonymizeXtb(bytes: Uint8Array, currency: unknown): Buffer {
  const accountCurrency = currencySchema.parse(currency);
  const parsed = parseXtb(bytes, {
    id: "0198a000-0000-7000-8000-000000000001",
    currency: accountCurrency,
  });
  const moneyFactor = new Decimal(randomInt(201, 950)).div(100);
  const quantityFactor = new Decimal(randomInt(2, 10));
  const priceFactor = moneyFactor.div(quantityFactor);
  const shift = randomInt(400, 1500) * 86400000;
  const shifted = (instant: string) =>
    new Date(Date.parse(instant) - shift).toISOString().slice(0, 19) + "Z";
  const scale = (value: string, factor: Decimal) =>
    new Decimal(decimalText(value)).mul(factor).toDecimalPlaces(8).toFixed();
  const symbols = new Map<string, string>();
  const types = parsed.rows.map((row) => {
    const type = row.raw.type?.trim().toLowerCase() ?? "";
    const canonical = type.startsWith("tax if") ? "tax if" : type;
    if (
      !allowedTypes.has(canonical) ||
      !row.input.executedAt ||
      !row.input.amount ||
      (row.status === "error" && row.reason !== "missing_dividend_details") ||
      (row.input.type === "DIVIDEND" && (!row.input.price || !row.input.priceCurrency))
    )
      throw new Error("ANONYMIZATION_UNSUPPORTED_ROW");
    return canonical;
  });
  const rows: string[][] = [
    ["Synthetic account", "DEMO-00000001"],
    ["Currency", accountCurrency],
    ["Type", "Ticker", "Instrument", "Time", "Amount", "ID", "Comment", "Product", "Quantity"],
  ];
  for (const [index, row] of parsed.rows.entries()) {
    const input = row.input;
    const cfd = input.category === "cfd_pl";
    let symbol = "";
    if (row.symbol) {
      symbol = symbols.get(row.symbol) ?? "";
      if (!symbol) {
        const suffix = cfd ? "CFD" : row.symbol.match(/\.(US|PL|DE|FR|NL|IT|ES)$/)?.[1];
        if (!suffix) throw new Error("ANONYMIZATION_UNSUPPORTED_SYMBOL");
        symbol = `SYN${String(symbols.size + 1).padStart(3, "0")}.${suffix}`;
        symbols.set(row.symbol, symbol);
      }
    }
    let comment = "";
    if (input.type === "BUY" || input.type === "SELL") {
      if (!input.quantity || !input.price) throw new Error("ANONYMIZATION_UNSUPPORTED_ROW");
      comment = `${input.type === "BUY" ? "OPEN" : "CLOSE"} BUY ${scale(input.quantity, quantityFactor)} @ ${scale(input.price, priceFactor)}`;
    } else if (input.type === "DIVIDEND") {
      // Only an enum currency and decimal value are emitted, even if input text contains PII.
      comment = `${currencySchema.parse(input.priceCurrency)} ${scale(input.price!, priceFactor)} / SHR`;
    } else if (row.relatedKey) {
      const target = parsed.rows.find((r) => r.key === row.relatedKey);
      if (!target?.input.executedAt) throw new Error("ANONYMIZATION_UNSUPPORTED_ROW");
      comment = xtbInstant(shifted(target.input.executedAt)).tradeDate;
    }
    rows.push([
      types[index]!,
      symbol,
      symbol ? "Synthetic instrument" : "",
      shifted(input.executedAt!),
      scale(row.raw.amount!, moneyFactor),
      String(100000 + index),
      comment,
      cfd ? "CFD" : "Stocks",
      input.quantity ? scale(input.quantity, quantityFactor) : "",
    ]);
  }
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "Cash Operations");
  // No original properties, hidden sheets, hyperlinks, formulas, or reversible mapping.
  return XLSX.write(book, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer;
}

export function anonymizeFile(
  input: string,
  output: string,
  currency: unknown,
  repository: string,
) {
  const root = realpathSync(repository);
  const outside = (path: string) => {
    const rel = relative(root, path);
    if (
      !(
        rel === ".." ||
        rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
        isAbsolute(rel)
      )
    )
      throw new Error("PATH_MUST_BE_OUTSIDE_REPOSITORY");
  };
  const source = realpathSync(input);
  const destination = resolve(output);
  outside(source);
  outside(realpathSync(dirname(destination)));
  if (!/\.xlsx$/i.test(destination)) throw new Error("OUTPUT_MUST_BE_XLSX");
  if (statSync(source).size > 10485760) throw new Error("IMPORT_TOO_LARGE");
  const bytes = anonymizeXtb(readFileSync(source), currency);
  writeFileSync(destination, bytes, { flag: "wx", mode: 0o600 });
}
