import { randomInt } from "node:crypto";
import { readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { Decimal } from "@oliginvest/core";
import * as XLSX from "xlsx";
import { z } from "zod";
import { type ParsedRow, parseXtb, xtbInstant } from "./xtb.js";

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

interface SyntheticRow {
  amount: Decimal;
  quantity: Decimal;
  price: Decimal;
  executedAt: string;
}

const randomDecimal = (min: number, max: number, divisor = 100) =>
  new Decimal(randomInt(min, max)).div(divisor);
const cashValue = (value: Decimal) => value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const isFunding = (row: ParsedRow) =>
  row.input.type === "DEPOSIT" || row.input.type === "CASH_TRANSFER_IN";

/** Keep ordering/equality of timestamps, but discard source dates, gaps and time of day. */
function syntheticTimes(rows: ParsedRow[]): Map<string, string> {
  const days = new Map<string, Set<string>>();
  for (const row of rows) {
    const day = row.input.tradeDate!;
    const instants = days.get(day) ?? new Set<string>();
    instants.add(row.input.executedAt!);
    days.set(day, instants);
  }
  const result = new Map<string, string>();
  const date = new Date(Date.UTC(randomInt(2000, 2020), randomInt(0, 12), randomInt(1, 29)));
  for (const day of [...days.keys()].sort().reverse()) {
    for (let remaining = randomInt(1, 6); remaining > 0; ) {
      date.setUTCDate(date.getUTCDate() - 1);
      if (![0, 6].includes(date.getUTCDay())) remaining--;
    }
    const instants = [...days.get(day)!].sort();
    const seconds = new Set<number>();
    // At most 50,000 distinct instants; [00:00, 20:00) UTC stays on the same Warsaw date.
    while (seconds.size < instants.length) seconds.add(randomInt(0, 72000));
    for (const [i, second] of [...seconds].sort((a, b) => a - b).entries()) {
      result.set(
        instants[i]!,
        `${new Date(date.getTime() + second * 1000).toISOString().slice(0, 19)}Z`,
      );
    }
  }
  return result;
}

function syntheticValues(rows: ParsedRow[], currency: string): Map<ParsedRow, SyntheticRow> {
  const chronological = [...rows].sort((a, b) =>
    a.input.executedAt!.localeCompare(b.input.executedAt!),
  );
  const times = syntheticTimes(rows);
  const result = new Map<ParsedRow, SyntheticRow>();
  const holdings = new Map<string, Decimal>();
  const lastBuy = new Map<string, SyntheticRow>();
  for (const row of chronological) {
    const value: SyntheticRow = {
      amount: new Decimal(0),
      quantity: randomDecimal(1, 10001),
      price: new Decimal(0),
      executedAt: times.get(row.input.executedAt!)!,
    };
    result.set(row, value);
    if (row.input.type === "BUY") {
      holdings.set(row.symbol, (holdings.get(row.symbol) ?? new Decimal(0)).plus(value.quantity));
      lastBuy.set(row.symbol, value);
    } else if (row.input.type === "SELL") {
      const buy = lastBuy.get(row.symbol);
      if (!buy) throw new Error("ANONYMIZATION_INCOMPLETE_HISTORY");
      let held = holdings.get(row.symbol)!;
      if (held.lt(value.quantity)) {
        const extra = value.quantity.minus(held).plus(randomDecimal(1, 10001));
        buy.quantity = buy.quantity.plus(extra);
        held = held.plus(extra);
      }
      holdings.set(row.symbol, held.minus(value.quantity));
    }
  }
  const prices = new Map<string, { base: Decimal; current: Decimal }>();
  const exchangeRates = new Map<string, Decimal>();
  for (const row of chronological) {
    const value = result.get(row)!;
    const type = row.input.type;
    if (type === "BUY" || type === "SELL" || type === "DIVIDEND") {
      let path = prices.get(row.symbol);
      if (!path) {
        const base = randomDecimal(1000, 100001);
        path = { base, current: base };
        prices.set(row.symbol, path);
      }
      if (type === "DIVIDEND") {
        value.quantity = randomDecimal(100, 10001);
        value.price = randomDecimal(1, 501);
      } else {
        path.current = path.current
          .mul("0.65")
          .plus(path.base.mul("0.35"))
          .mul(randomDecimal(8000, 12001, 10000))
          .toDecimalPlaces(4);
        value.price = path.current;
      }
      const priceCurrency = currencySchema.parse(row.input.priceCurrency);
      let fx = exchangeRates.get(priceCurrency);
      if (!fx) {
        fx = priceCurrency === currency ? new Decimal(1) : randomDecimal(5000, 60001, 10000);
        exchangeRates.set(priceCurrency, fx);
      }
      value.amount = cashValue(value.quantity.mul(value.price).mul(fx));
      if (type === "BUY") value.amount = value.amount.neg();
    } else if (["FEE", "TAX", "WITHDRAWAL", "CASH_TRANSFER_OUT"].includes(type ?? "")) {
      value.amount = randomDecimal(1, 20001).neg();
    } else if (type === "ADJUSTMENT") {
      value.amount = randomDecimal(1, 20001).mul(randomInt(0, 2) === 0 ? -1 : 1);
    } else if (type === "INTEREST" || isFunding(row)) {
      value.amount = randomDecimal(1, 20001);
    }
  }
  const byKey = new Map(rows.map((row) => [row.key, row]));
  if (byKey.size !== rows.length) throw new Error("ANONYMIZATION_UNSUPPORTED_ROW");
  for (const row of rows) {
    if (row.input.type === "TAX" && row.pairedTo) {
      const dividend = byKey.get(row.pairedTo);
      if (!dividend) throw new Error("ANONYMIZATION_UNSUPPORTED_ROW");
      result.get(row)!.amount = cashValue(
        result.get(dividend)!.amount.mul(randomDecimal(1, 3501, 10000)),
      ).neg();
    }
  }
  for (const row of rows) {
    if (row.raw.type?.trim().toLowerCase() !== "close trade" || row.input.category === "cfd_pl")
      continue;
    const target = byKey.get(row.pairedTo ?? "");
    if (!target) throw new Error("ANONYMIZATION_UNSUPPORTED_ROW");
    const sale = result.get(target)!;
    const pnl = result.get(row)!;
    // The two cash rows must add up to synthetic sale proceeds, with no source P/L ratio.
    pnl.amount = cashValue(sale.amount.mul(randomDecimal(-5000, 5001, 10000)));
    sale.amount = sale.amount.minus(pnl.amount);
  }
  // Backward funding reserves the largest future deficit before the next deposit/transfer.
  let required = new Decimal(0);
  for (const row of [...chronological].reverse()) {
    const value = result.get(row)!;
    if (isFunding(row)) {
      value.amount = required.plus(randomDecimal(10000, 100001));
      required = new Decimal(0);
    } else required = Decimal.max(0, required.minus(value.amount));
  }
  if (required.gt(0)) throw new Error("ANONYMIZATION_INCOMPLETE_HISTORY");
  return result;
}

/** Reconstruct only known fields; never copy workbook metadata or free-form source text. */
export function anonymizeXtb(bytes: Uint8Array, currency: unknown): Buffer {
  const accountCurrency = currencySchema.parse(currency);
  const parsed = parseXtb(bytes, {
    id: "0198a000-0000-7000-8000-000000000001",
    currency: accountCurrency,
  });
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
  const values = syntheticValues(parsed.rows, accountCurrency);
  const rows: string[][] = [
    ["Synthetic account", "DEMO-00000001"],
    ["Currency", accountCurrency],
    ["Type", "Ticker", "Instrument", "Time", "Amount", "ID", "Comment", "Product", "Quantity"],
  ];
  for (const [index, row] of parsed.rows.entries()) {
    const input = row.input;
    const value = values.get(row)!;
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
      const format = /\b((?:OPEN |CLOSE )?BUY)\s+[\d.,]+(\/[\d.,]+)?\s*@/i.exec(
        row.raw.comment ?? "",
      );
      if (!format) throw new Error("ANONYMIZATION_UNSUPPORTED_ROW");
      const total = format[2] ? `/${value.quantity.plus(randomDecimal(1, 10001)).toFixed()}` : "";
      comment = `${format[1]!.toUpperCase()} ${value.quantity.toFixed()}${total} @ ${value.price.toFixed()}`;
    } else if (input.type === "DIVIDEND") {
      // Only an enum currency and decimal value are emitted, even if input text contains PII.
      comment = `${currencySchema.parse(input.priceCurrency)} ${value.price.toFixed()} / SHR`;
    } else if (row.relatedKey) {
      const target = parsed.rows.find((r) => r.key === row.relatedKey);
      if (!target?.input.executedAt) throw new Error("ANONYMIZATION_UNSUPPORTED_ROW");
      comment = xtbInstant(values.get(target)!.executedAt).tradeDate;
    }
    rows.push([
      types[index]!,
      symbol,
      symbol ? "Synthetic instrument" : "",
      value.executedAt,
      value.amount.toFixed(2),
      String(100000 + index),
      comment,
      cfd ? "CFD" : "Stocks",
      input.quantity ? value.quantity.toFixed() : "",
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
