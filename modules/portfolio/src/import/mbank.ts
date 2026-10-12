import { createHash } from "node:crypto";
import {
  addMoney,
  Decimal,
  divideMoney,
  grossValue,
  isoDate,
  money,
  moneyToJson,
  multiplyMoney,
  negateMoney,
  price,
  quantity,
  subtractMoney,
  sumMoney,
} from "@oliginvest/core";
import { z } from "zod";
import { decodeCsv, MAX_FILE_BYTES } from "./workbook.js";
import { decimalText, type ParsedImport, type ParsedRow, xtbInstant } from "./xtb.js";

const accountSchema = z.object({ id: z.uuid(), currency: z.enum(["PLN", "USD", "EUR"]) }).strict();
const MAX_SCAN_ROWS = 40;
const MAX_ROWS = 50000;
/** mBank exchange codes → ISO 10383 MIC and the quote currency used when the file omits it. */
const exchanges: Record<string, { mic: string; currency?: string }> = {
  "WWA-GPW": { mic: "XWAR", currency: "PLN" },
  "USA-NYSE": { mic: "XNYS", currency: "USD" },
  "USA-NASDAQ": { mic: "XNAS", currency: "USD" },
  // LSE lines are quoted in GBP, GBX or USD — never guessed.
  "GBR-LSE": { mic: "XLON" },
  "DEU-XETRA": { mic: "XETR", currency: "EUR" },
};
const tradeColumns: Record<string, string> = {
  "czas transakcji": "time",
  papier: "name",
  giełda: "exchange",
  "k/s": "side",
  liczba: "quantity",
  kurs: "price",
  prowizja: "fee",
  wartość: "value",
};
const currencyAfter: Record<string, string> = {
  price: "priceCurrency",
  fee: "feeCurrency",
  value: "valueCurrency",
};
const cashColumns: Record<string, string> = { data: "time", opis: "description", kwota: "amount" };
const DIVIDEND =
  /^Dywidenda z ([\d\s.,]+) PW: ([A-Z]{2}[A-Z0-9]{9}\d) DP: (\d{4}-\d{2}-\d{2}) stawka brutto w wal\.: ([\d\s.,]+) stawka pod\.: ([\d\s.,]+)%(?: kurs przewalutowania: ([\d\s.,]+))?$/i;
const ISIN = /\bPW: ([A-Z]{2}[A-Z0-9]{9}\d)\b/;

/** Splits one CSV line; quoted fields may contain the separator and doubled quotes. */
export function csvLine(line: string, separator: string): string[] {
  const cells: string[] = [];
  let cell = "",
    quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (quoted) {
      if (char !== '"') cell += char;
      else if (line[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = false;
    } else if (char === '"' && !cell.trim()) {
      cell = "";
      quoted = true;
    } else if (char === separator) {
      cells.push(cell);
      cell = "";
    } else cell += char;
  }
  if (quoted) throw new Error("invalid_csv_row");
  cells.push(cell);
  return cells;
}
const label = (cell: string) => cell.trim().toLowerCase().replace(/\s+/g, " ");
function header(lines: string[]) {
  for (let index = 0; index < Math.min(MAX_SCAN_ROWS, lines.length); index++)
    for (const separator of [";", ","]) {
      let cells: string[];
      try {
        cells = csvLine(lines[index]!, separator).map(label);
      } catch {
        continue;
      }
      if (["czas transakcji", "papier", "k/s", "liczba", "kurs"].every((c) => cells.includes(c))) {
        let previous = "";
        const columns = cells.map((cell) => {
          const name =
            tradeColumns[cell] ?? (cell === "waluta" ? (currencyAfter[previous] ?? "") : "");
          if (tradeColumns[cell]) previous = name;
          return name;
        });
        return { kind: "transactions" as const, index, separator, columns };
      }
      if (cells.length === 3 && ["data", "opis", "kwota"].every((c) => cells.includes(c)))
        return {
          kind: "financial" as const,
          index,
          separator,
          columns: cells.map((c) => cashColumns[c] ?? ""),
        };
    }
  throw new Error("IMPORT_FORMAT_UNKNOWN");
}
function instant(value: string) {
  const text = value.trim();
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(text))
    return { tradeDate: isoDate(text.replace(/^(\d{2})\.(\d{2})\.(\d{4})$/, "$3-$2-$1")) };
  return xtbInstant(text);
}
const currencyText = (value: string | undefined) => {
  const text = value?.trim().toUpperCase() ?? "";
  if (text && !/^[A-Z]{3}$/.test(text)) throw new Error("invalid_currency");
  return text || undefined;
};
const positive = (value: string, reason: string) => {
  const parsed = decimalText(value);
  if (!new Decimal(parsed).isPositive() || new Decimal(parsed).isZero()) throw new Error(reason);
  return parsed;
};
const LEGAL_FORMS = new Set([
  "SA",
  "S A",
  "INC",
  "CORP",
  "CORPORATION",
  "PLC",
  "AG",
  "SE",
  "NV",
  "ASA",
  "LTD",
]);
/** Securities are matched by name: case, diacritics, punctuation and legal form are ignored. */
export function nameKey(value: string): string {
  let key = value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[łŁ]/g, "L")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
  for (const form of LEGAL_FORMS)
    if (key.endsWith(` ${form}`) && key.length > form.length + 3)
      key = key.slice(0, -form.length - 1);
  return key;
}

function parseTrade(row: ParsedRow, raw: Record<string, string>, currency: "PLN") {
  const exchange = exchanges[raw.exchange?.trim().toUpperCase() ?? ""];
  if (exchange) row.mic = exchange.mic;
  row.input = { ...row.input, ...instant(raw.time ?? "") };
  const side = raw.side?.trim().toUpperCase();
  if (side !== "K" && side !== "S") throw new Error("unknown_side");
  row.input.type = side === "K" ? "BUY" : "SELL";
  if (!row.symbol) throw new Error("missing_security_name");
  row.input.quantity = positive(raw.quantity ?? "", "invalid_quantity");
  row.input.price = decimalText(raw.price ?? "");
  const listed = currencyText(raw.priceCurrency);
  row.input.priceCurrency = listed ?? exchange?.currency;
  if (!row.input.priceCurrency) throw new Error("missing_price_currency");
  if (!listed) row.reason = "price_currency_from_exchange";
  const gross = grossValue(
    price(row.input.price, row.input.priceCurrency),
    quantity(row.input.quantity),
  );
  if (raw.fee?.trim()) {
    const feeCurrency = currencyText(raw.feeCurrency) ?? currency;
    if (feeCurrency !== currency) throw new Error("unsupported_fee_currency");
    row.input.fee = { amount: decimalText(raw.fee), currency };
    if (new Decimal(row.input.fee.amount).isNegative()) throw new Error("invalid_fee");
  }
  // eMakler settles in PLN; a missing or foreign settlement value is completed by the user.
  const valueCurrency =
    currencyText(raw.valueCurrency) ??
    (row.input.priceCurrency === currency ? currency : undefined);
  if (!raw.value?.trim() || valueCurrency !== currency) throw new Error("missing_settlement_value");
  const value = money(positive(raw.value, "invalid_settlement_value"), currency);
  const fee = money(row.input.fee?.amount ?? "0", currency);
  row.input.amount = moneyToJson(
    row.input.type === "BUY" ? negateMoney(addMoney(value, fee)) : subtractMoney(value, fee),
  );
  if (gross.currency === currency) {
    if (subtractMoney(gross, value).amount.abs().greaterThan("0.01"))
      throw new Error("settlement_value_mismatch");
  } else {
    row.input.fxRate = divideMoney(value, gross.amount).amount.toDecimalPlaces(8).toFixed();
    row.input.fxSource = "implied";
  }
}
function parseCash(row: ParsedRow, raw: Record<string, string>, currency: "PLN") {
  row.input = { ...row.input, ...instant(raw.time ?? "") };
  const amount = money(decimalText(raw.amount ?? ""), currency);
  row.input.amount = moneyToJson(amount);
  const description = (raw.description ?? "").trim().replace(/\s+/g, " ");
  const isin = ISIN.exec(description)?.[1];
  if (isin) row.isin = isin;
  const flow = amount.amount.isNegative() ? "WITHDRAWAL" : "DEPOSIT";
  const dividend = DIVIDEND.exec(description);
  if (dividend) {
    row.input.type = "DIVIDEND";
    row.symbol = dividend[2]!;
    row.input.quantity = positive(dividend[1]!, "missing_dividend_details");
    row.input.price = positive(dividend[4]!, "missing_dividend_details");
    const rate = dividend[6] ? positive(dividend[6], "missing_dividend_details") : undefined;
    // Without a conversion rate the dividend was declared in PLN; US lines state the USD rate.
    row.input.priceCurrency = !rate
      ? isin?.startsWith("PL")
        ? currency
        : undefined
      : isin?.startsWith("US")
        ? "USD"
        : undefined;
    if (!row.input.priceCurrency) throw new Error("missing_dividend_details");
    const declared = grossValue(
      price(row.input.price, row.input.priceCurrency),
      quantity(row.input.quantity),
    );
    const gross = money(multiplyMoney(declared, rate ?? "1").amount, currency);
    const tax = subtractMoney(gross, amount);
    if (tax.amount.isNegative() || amount.amount.isNegative())
      throw new Error("dividend_amount_mismatch");
    row.dividendGross = gross.amount.toFixed();
    row.dividendTax = tax.amount.toFixed();
    row.input.note = `DP: ${dividend[3]}; stawka pod.: ${decimalText(dividend[5]!)}%`;
  } else if (/^Dywidenda\b/i.test(description)) {
    row.input.type = "DIVIDEND";
    if (isin) row.symbol = isin;
    throw new Error("missing_dividend_details");
  } else if (
    /^(WYC|WYP)\.BK:/i.test(description) ||
    /^(Przelew z r-ku|PRZELEW NA IKZE|ZASILENIE IKZE|DOPŁATA DO LIMITU IKZE)\b/i.test(description)
  ) {
    if (amount.amount.isZero()) throw new Error("invalid_amount");
    row.input.type = flow;
  } else if (/^(Blokada|Odblokowanie) środków\b/i.test(description)) {
    row.status = "skipped";
    row.reason = "order_block";
  } else if (/^WYC:/i.test(description) && isin) {
    row.status = "skipped";
    row.reason = "trade_settlement";
  } else if (/^(IKE\/IKZE|IKZE|IKE) WYPE[LŁ]NIONY LIMIT\b/i.test(description)) {
    row.status = "skipped";
    row.reason = "informational";
  } else {
    row.status = "unsupported";
    row.reason = "unknown_description";
  }
}
/** Content key: normalised fields survive export generations that format numbers differently. */
function contentKey(kind: string, row: ParsedRow) {
  const i = row.input;
  const when = i.executedAt ?? i.tradeDate;
  const identity =
    kind === "transactions"
      ? [when, row.symbol, row.mic ?? row.raw.exchange?.trim(), i.type, i.quantity, i.price]
      : [when, (row.raw.description ?? "").trim().replace(/\s+/g, " "), i.amount?.amount];
  // Rows whose identity could not be read fall back to their raw cells.
  return JSON.stringify(identity.every(Boolean) ? [kind, ...identity] : [kind, "raw", row.raw]);
}

/** Parses an mBank eMakler CSV: transaction history or financial history (one file per batch). */
export function parseMbank(bytes: Uint8Array, rawAccount: unknown): ParsedImport {
  const account = accountSchema.parse(rawAccount);
  if (!bytes.byteLength || bytes.byteLength > MAX_FILE_BYTES) throw new Error("FILE_TOO_LARGE");
  const magic = Buffer.from(bytes.subarray(0, 4)).toString("hex");
  if (["504b0304", "d0cf11e0"].includes(magic)) throw new Error("IMPORT_FORMAT_UNKNOWN");
  const lines = decodeCsv(bytes).replace(/^﻿/, "").split(/\r?\n/);
  if (lines.length > MAX_ROWS + 100) throw new Error("IMPORT_FORMAT_UNKNOWN");
  const { kind, index, separator, columns } = header(lines);
  // eMakler books every trade and cash flow in PLN.
  if (account.currency !== "PLN") throw new Error("account_currency_mismatch");
  const currency = account.currency;
  const occurrences = new Map<string, number>();
  const rows: ParsedRow[] = [];
  for (let line = index + 1; line < lines.length; line++) {
    const text = lines[line]!;
    if (!text.trim()) continue;
    if (rows.length >= MAX_ROWS || text.length > 10000) throw new Error("IMPORT_FORMAT_UNKNOWN");
    let cells: string[] = [],
      malformed = false;
    try {
      cells = csvLine(text, separator);
    } catch {
      malformed = true;
    }
    if (cells.every((cell) => !cell.trim()) && !malformed) continue;
    const raw: Record<string, string> = malformed
      ? { line: text }
      : Object.fromEntries(columns.flatMap((c, i) => (c ? [[c, cells[i] ?? ""]] : [])));
    const row: ParsedRow = {
      rowNumber: line + 1,
      sheet: kind,
      raw,
      key: "",
      symbol: kind === "transactions" ? nameKey(raw.name ?? "") : "",
      status: "new",
      input: { accountId: account.id, sequence: rows.length + 1 },
    };
    rows.push(row);
    try {
      if (malformed) throw new Error("invalid_csv_row");
      if (kind === "transactions") parseTrade(row, raw, currency);
      else parseCash(row, raw, currency);
    } catch (error) {
      row.status = "error";
      row.reason = error instanceof Error ? error.message : "invalid_row";
    }
    const hash = createHash("sha256").update(contentKey(kind, row)).digest("hex");
    const occurrence = (occurrences.get(hash) ?? 0) + 1;
    occurrences.set(hash, occurrence);
    row.key = `mbank:${createHash("sha256").update(`${hash}:${occurrence}`).digest("hex")}`;
  }
  // Financial history lists every cash movement; order blocks are reservations, not flows.
  const flows = rows.filter(
    (r) => r.input.amount && !["order_block", "informational"].includes(r.reason ?? ""),
  );
  return {
    format: `mbank.${kind}`,
    rows,
    positions: {},
    cash:
      kind === "financial"
        ? sumMoney(
            flows.map((r) => money(r.input.amount!.amount, currency)),
            currency,
          ).amount.toFixed()
        : null,
    reconcileCash: kind === "financial",
  };
}
