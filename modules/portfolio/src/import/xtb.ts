import { createHash } from "node:crypto";
import {
  addMoney,
  Decimal,
  divideMoney,
  grossValue,
  isoDate,
  money,
  moneyToJson,
  negateMoney,
  price,
  quantity,
} from "@oliginvest/core";
import { z } from "zod";
import type { TransactionInput } from "../contracts.js";
import { grid, readImportWorkbook } from "./workbook.js";

export interface ParsedRow {
  rowNumber: number;
  sheet: string;
  raw: Record<string, string>;
  key: string;
  symbol: string;
  isin?: string;
  status: "new" | "error" | "unsupported" | "skipped";
  reason?: string;
  input: Partial<TransactionInput>;
  relatedKey?: string;
  pairedTo?: string;
  dividendGross?: string;
  dividendTax?: string;
}
export interface ParsedImport {
  format: string;
  rows: ParsedRow[];
  positions: Record<string, string>;
  cash: string | null;
}
const accountSchema = z.object({ id: z.uuid(), currency: z.enum(["PLN", "USD", "EUR"]) }).strict();
const names: Record<string, string> = {
  type: "type",
  typ: "type",
  ticker: "symbol",
  symbol: "symbol",
  instrument: "instrument",
  time: "time",
  czas: "time",
  amount: "amount",
  kwota: "amount",
  id: "id",
  comment: "comment",
  komentarz: "comment",
  product: "product",
  produkt: "product",
  isin: "isin",
  quantity: "quantity",
  volume: "quantity",
  liczba: "quantity",
  ilość: "quantity",
};
export function decimalText(value: string): string {
  const text = value
    .trim()
    .replace(/[\s\u00a0]/gu, "")
    .replace("−", "-")
    .replace(",", ".");
  if (!/^-?\d{1,14}(?:\.\d{1,10})?$/.test(text)) throw new Error("invalid_decimal");
  return new Decimal(text).toFixed();
}
const formatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Warsaw",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
export function xtbInstant(
  value: string,
  date1904 = false,
): { tradeDate: string; executedAt: string } {
  let text = value.trim();
  if (/^\d{5}(?:\.\d+)?$/.test(text)) {
    const origin = Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 30);
    text = new Date(origin + Math.round(Number(text) * 86400) * 1000).toISOString().slice(0, 19);
  }
  text = text.replace(/^(\d{2})[./](\d{2})[./](\d{4})/, "$3-$2-$1").replace(" ", "T");
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/.test(text)) {
    const executedAt = new Date(text).toISOString();
    return { tradeDate: formatter.format(new Date(executedAt)).slice(0, 10), executedAt };
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(text)) throw new Error("invalid_time");
  isoDate(text.slice(0, 10));
  const wall = Date.parse(`${text}Z`);
  const candidates = [1, 2]
    .map((h) => new Date(wall - h * 3600000))
    .filter((d) => formatter.format(d).replace(" ", "T") === text);
  if (candidates.length !== 1) throw new Error("ambiguous_or_invalid_time");
  return { tradeDate: text.slice(0, 10), executedAt: candidates[0]!.toISOString() };
}
function currencyFor(symbol: string) {
  const suffix = symbol.split(".").at(-1);
  return suffix === "US"
    ? "USD"
    : suffix === "PL"
      ? "PLN"
      : ["DE", "FR", "NL", "IT", "ES"].includes(suffix ?? "")
        ? "EUR"
        : undefined;
}
function isCfd(row: ParsedRow) {
  return (
    /cfd/i.test(row.raw.product ?? "") ||
    /^(US\d+|DE\d+|GOLD|SILVER|OIL[.]|NATGAS)/.test(row.symbol)
  );
}
export function parseXtb(bytes: Uint8Array, rawAccount: unknown): ParsedImport {
  const account = accountSchema.parse(rawAccount);
  const book = readImportWorkbook(bytes);
  let selected: { name: string; table: string[][]; header: number; columns: string[] } | undefined;
  for (const name of book.SheetNames) {
    const table = grid(book.Sheets[name]!);
    for (let header = 0; header < Math.min(40, table.length); header++) {
      const columns = table[header]!.map((v) => names[v.trim().toLowerCase()] ?? "");
      if (["type", "time", "amount", "comment"].every((c) => columns.includes(c))) {
        if (selected) throw new Error("IMPORT_FORMAT_UNKNOWN");
        selected = { name, table, header, columns };
        break;
      }
    }
  }
  if (!selected) throw new Error("IMPORT_FORMAT_UNKNOWN");
  const { name, table, header, columns } = selected;
  const meta = table.slice(0, header).flat().join(" ");
  const currencies = [...new Set(meta.match(/\b(?:PLN|USD|EUR)\b/g))];
  if (currencies.length !== 1 || currencies[0] !== account.currency)
    throw new Error("account_currency_mismatch");
  const occurrences = new Map<string, number>();
  const rows: ParsedRow[] = [];
  let cash: string | null = null;
  for (let index = header + 1; index < table.length; index++) {
    const cells = table[index]!;
    if (cells.every((cell) => !cell.trim())) continue;
    if (rows.length >= 50000) throw new Error("IMPORT_FORMAT_UNKNOWN");
    const raw = Object.fromEntries(
      columns.flatMap((column, i) => (column ? [[column, cells[i] ?? ""]] : [])),
    );
    const hash = createHash("sha256").update(JSON.stringify(raw)).digest("hex");
    const occurrence = (occurrences.get(hash) ?? 0) + 1;
    occurrences.set(hash, occurrence);
    const row: ParsedRow = {
      rowNumber: index + 1,
      sheet: name,
      raw,
      key: raw.id?.trim() || createHash("sha256").update(`${hash}:${occurrence}`).digest("hex"),
      symbol:
        raw.symbol?.trim() ||
        (/^[A-Z0-9-]+\.[A-Z]{2}$/.test(raw.instrument ?? "")
          ? raw.instrument!
          : (raw.instrument ?? "")),
      ...(raw.isin ? { isin: raw.isin } : {}),
      status: "new",
      input: {},
    };
    rows.push(row);
    try {
      const amount = decimalText(raw.amount ?? "");
      row.input = {
        accountId: account.id,
        ...xtbInstant(raw.time ?? "", book.Workbook?.WBProps?.date1904 === true),
        amount: { amount, currency: account.currency },
        sequence: rows.length,
      };
      const type = raw.type?.trim().toLowerCase();
      if (isCfd(row) || ["swap", "rollover", "dividend equivalent"].includes(type ?? "")) {
        row.status = "unsupported";
        row.reason = "cfd";
        row.input.type = "ADJUSTMENT";
        row.input.category = "cfd_pl";
      } else if (["deposit", "withdrawal"].includes(type ?? ""))
        row.input.type = new Decimal(amount).isNegative() ? "WITHDRAWAL" : "DEPOSIT";
      else if (type === "subaccount transfer")
        row.input.type = new Decimal(amount).isNegative()
          ? "CASH_TRANSFER_OUT"
          : "CASH_TRANSFER_IN";
      else if (["stock purchase", "zakup akcji/etf", "stock sale"].includes(type ?? "")) {
        row.input.type = type === "stock sale" ? "SELL" : "BUY";
        const match = /(?:OPEN |CLOSE )?BUY ([\d.,]+)(?:\/[\d.,]+)? @ ([\d.,]+)/i.exec(
          raw.comment ?? "",
        );
        if (!match) throw new Error("missing_trade_details");
        row.input.quantity = decimalText(match[1]!);
        row.input.price = decimalText(match[2]!);
        row.input.priceCurrency = currencyFor(row.symbol);
        if (!row.input.priceCurrency) throw new Error("unknown_price_currency");
      } else if (["divident", "dividend", "dywidenda"].includes(type ?? "")) {
        row.input.type = "DIVIDEND";
        row.dividendGross = amount;
        const match = /\b([A-Z]{3})\s+([\d.,]+)\s*\/\s*SHR/i.exec(raw.comment ?? "");
        if (match) {
          row.input.priceCurrency = match[1]!;
          row.input.price = decimalText(match[2]!);
        }
        if (raw.quantity) row.input.quantity = decimalText(raw.quantity);
        if (!row.input.quantity || !row.input.price) throw new Error("missing_dividend_details");
      } else if (type === "free-funds interest") row.input.type = "INTEREST";
      else if (type === "free-funds interest tax") {
        row.input.type = "TAX";
        row.input.category = "interest_tax";
      } else if (type === "sec fee") {
        row.input.type = "FEE";
        row.input.category = "sec_fee";
      } else if (type === "commission") row.input.type = "FEE";
      else if (type?.startsWith("tax if")) {
        row.input.type = "TAX";
        row.input.category = "ftt";
      } else if (["withholding tax", "podatek od dywidend"].includes(type ?? ""))
        row.input.type = "TAX";
      else if (type !== "close trade") {
        row.status = "unsupported";
        row.reason = "unknown_operation_type";
      }
    } catch (error) {
      row.status = "error";
      row.reason = error instanceof Error ? error.message : "invalid_row";
    }
  }
  // FIFO pairing retains the contributing source row and its dedupe key.
  const paired = new Set<string>();
  for (const row of rows) {
    const type = row.raw.type?.toLowerCase();
    const targetType =
      type === "close trade"
        ? "SELL"
        : ["withholding tax", "podatek od dywidend"].includes(type ?? "")
          ? "DIVIDEND"
          : type === "commission"
            ? "TRADE"
            : undefined;
    if (!targetType || isCfd(row) || !row.input.amount) continue;
    const target = rows.find(
      (r) =>
        r.symbol === row.symbol &&
        r.input.executedAt === row.input.executedAt &&
        (targetType === "TRADE"
          ? ["BUY", "SELL"].includes(r.input.type ?? "")
          : r.input.type === targetType) &&
        !paired.has(`${targetType}:${r.key}`),
    );
    if (!target?.input.amount) {
      row.status = "error";
      row.reason = "unpaired_cash_operation";
      continue;
    }
    paired.add(`${targetType}:${target.key}`);
    target.input.amount = moneyToJson(
      addMoney(
        money(target.input.amount.amount, account.currency),
        money(row.input.amount.amount, account.currency),
      ),
    );
    if (targetType === "DIVIDEND")
      target.dividendTax = negateMoney(
        money(row.input.amount.amount, account.currency),
      ).amount.toFixed();
    if (targetType === "TRADE")
      target.input.fee = moneyToJson(negateMoney(money(row.input.amount.amount, account.currency)));
    row.status = "skipped";
    row.reason = "paired_cash_operation";
    row.pairedTo = target.key;
  }
  for (const row of rows) {
    if (
      (row.input.type === "FEE" && row.input.category === "sec_fee") ||
      row.input.category === "ftt"
    ) {
      const date = row.raw.comment?.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? row.input.tradeDate;
      const candidates = rows.filter(
        (r) =>
          r.symbol === row.symbol &&
          r.input.tradeDate === date &&
          r.input.type === (row.input.category === "ftt" ? "BUY" : "SELL"),
      );
      if (candidates.length === 1) row.relatedKey = candidates[0]!.key;
      else {
        row.status = "error";
        row.reason = "ambiguous_linked_charge";
      }
    }
    if (
      ["BUY", "SELL"].includes(row.input.type ?? "") &&
      row.input.priceCurrency !== account.currency &&
      row.input.quantity &&
      row.input.price &&
      row.input.amount
    ) {
      const gross = grossValue(
        price(row.input.price, row.input.priceCurrency!),
        quantity(row.input.quantity),
      );
      const cashAmount = money(row.input.amount.amount, account.currency);
      const signed = row.input.type === "BUY" ? negateMoney(cashAmount) : cashAmount;
      row.input.fxRate = divideMoney(signed, gross.amount).amount.toDecimalPlaces(8).toFixed();
      row.input.fxSource = "implied";
    }
  }
  const positions: Record<string, string> = {};
  for (const sheetName of book.SheetNames.filter((s) => /^OPEN POSITION/i.test(s))) {
    const values = grid(book.Sheets[sheetName]!);
    const h = values.findIndex((r) => r.includes("Symbol") && r.includes("Volume"));
    if (h < 0) continue;
    const symbolColumn = values[h]!.indexOf("Symbol"),
      volumeColumn = values[h]!.indexOf("Volume");
    for (const row of values.slice(h + 1)) {
      const symbol = row[symbolColumn];
      if (!symbol || !currencyFor(symbol)) continue;
      positions[symbol] = new Decimal(positions[symbol] ?? "0")
        .plus(decimalText(row[volumeColumn]!))
        .toFixed();
    }
  }
  for (const row of table.slice(0, header)) {
    const joined = row.join(" ");
    const value = /(?:closing balance|saldo końcowe)\s*:?\s*([-\d.,\s]+)/i.exec(joined)?.[1];
    if (value) cash = decimalText(value);
  }
  return {
    format:
      name === "CASH OPERATION HISTORY" ? "xtb.cash_operations.legacy" : "xtb.cash_operations.new",
    rows,
    positions,
    cash,
  };
}
