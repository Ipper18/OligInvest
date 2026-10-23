import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { buildLedger } from "@oliginvest/core";
import { describe, expect, test } from "vitest";
import { BULK_TEST_TIMEOUT_MS } from "../../../scripts/test-timeouts.mjs";
import { toCoreTransaction } from "../src/domain/transactions.js";
import { nameKey, parseMbank } from "../src/import/mbank.js";
import { prepareImportInput } from "../src/server/imports.js";

const accountId = "0198a000-0000-7000-8000-000000000001";
const instrumentId = "0198a000-0000-7000-8000-0000000000a1";
const account = { id: accountId, currency: "PLN" };
const fixture = (kind) =>
  readFileSync(
    new URL(`./fixtures/anonymized/mbank/mbank-syntetyczny-historia-${kind}.csv`, import.meta.url),
  );
const expected = JSON.parse(
  readFileSync(new URL("./fixtures/anonymized/oczekiwane-wyniki.json", import.meta.url), "utf8"),
).mbank;
const parse = (bytes) => parseMbank(bytes, account);
const trades = (lines, separator = ";") =>
  Buffer.from(
    [
      "mBank S.A.",
      "Historia transakcji",
      "",
      [
        "Czas transakcji",
        "Papier",
        "Giełda",
        "K/S",
        "Liczba",
        "Kurs",
        "Waluta",
        "Prowizja",
        "Waluta",
        "Wartość",
        "Waluta",
      ].join(separator),
      ...lines,
    ].join("\r\n"),
  );
const cash = (lines) =>
  Buffer.from(["Historia finansowa", "", "Data;Opis;Kwota", ...lines].join("\n"));
const byLine = (result, line) => result.rows.find((r) => r.rowNumber === line);

describe("mBank eMakler transaction history", () => {
  test("Windows-1250 fixture: metadata skipped, PLN trades complete, US row awaits value", () => {
    const result = parse(fixture("transakcji"));
    expect(result.format).toBe("mbank.transactions");
    expect(result).toMatchObject({ cash: null, reconcileCash: false, positions: {} });
    expect(result.rows).toHaveLength(4);
    expect(result.rows[0]).toMatchObject({
      rowNumber: 11,
      symbol: "KGHM",
      mic: "XWAR",
      status: "new",
      raw: { exchange: "WWA-GPW", valueCurrency: "PLN" },
      input: {
        type: "BUY",
        tradeDate: "2025-02-10",
        executedAt: "2025-02-10T08:01:12.000Z",
        quantity: "10",
        price: "150.5",
        priceCurrency: "PLN",
        fee: { amount: "5", currency: "PLN" },
        amount: { amount: "-1510", currency: "PLN" },
      },
    });
    expect(result.rows.map((r) => r.input.amount?.amount)).toEqual([
      "-1510",
      "-705",
      "1915",
      undefined,
    ]);
    expect(result.rows[3]).toMatchObject({
      symbol: "MICROSOFT",
      mic: "XNAS",
      status: "error",
      reason: "missing_settlement_value",
      input: { type: "BUY", quantity: "2", price: "400", priceCurrency: "USD" },
    });
    expect(new Set(result.rows.map((r) => r.key)).size).toBe(4);
    expect(parse(fixture("transakcji")).rows.map((r) => r.key)).toEqual(
      result.rows.map((r) => r.key),
    );
  });

  test("FIFO through packages/core reproduces the expected KGHM position and P/L", () => {
    const result = parse(fixture("transakcji"));
    const transactions = result.rows
      .filter((r) => r.status === "new")
      .map((r, i) =>
        toCoreTransaction(
          prepareImportInput(
            { input: { ...r.input, instrumentId }, symbol: r.symbol, key: r.key },
            {
              ...account,
              accountType: "regular",
              broker: "mbank",
            },
          ),
          `t${i}`,
          "mbank",
        ),
      );
    const ledger = buildLedger({
      accounts: [{ id: accountId, currency: "PLN", accountType: "regular" }],
      transactions,
    });
    const [position] = expected.positions_end;
    const [sale] = expected.realized_pl_economic;
    expect(ledger.positions[0].quantity.toFixed()).toBe(position.qty);
    expect(ledger.positions[0].cost.amount.toFixed(2)).toBe(position.cost_pln);
    expect(ledger.sales[0]).toMatchObject({ tradeDate: sale.date });
    expect(ledger.sales[0].proceedsEconomic.amount.toFixed(2)).toBe(sale.proceeds_pln);
    expect(ledger.sales[0].costEconomic.amount.toFixed(2)).toBe(sale.cost_pln);
    expect(ledger.sales[0].realizedPlEconomic.amount.toFixed(2)).toBe(sale.pl_pln);
  });

  test("comma-separated UTF-8 export with Polish numbers yields the same keys and inputs", () => {
    const legacy = parse(fixture("transakcji"));
    const modern = parse(
      trades(
        [
          '10.02.2025 09:01:12,KGHM,WWA-GPW,K,10,"150,50",PLN,"5,00",PLN,"1 505,00",PLN',
          '15.05.2025 11:22:05,KGHM,WWA-GPW,K,5,"140,00",PLN,"5,00",PLN,"700,00",PLN',
          '03.09.2025 14:45:30,KGHM,WWA-GPW,S,12,"160,00",PLN,"5,00",PLN,"1 920,00",PLN',
          '17.11.2025 16:10:00,MICROSOFT,USA-NASDAQ,K,2,"400,00",USD,,,,',
        ],
        ",",
      ),
    );
    const logical = (r) =>
      r.rows.map(({ key, status, reason, input }) => ({ key, status, reason, input }));
    expect(logical(modern)).toEqual(logical(legacy));
  });

  test("foreign value, currency fallbacks and malformed rows are reported, never dropped", () => {
    const result = parse(
      trades([
        "17.11.2025 16:10:00;Microsoft Corp.;USA-NASDAQ;K;2;400.00;USD;;;3216.00;PLN",
        "17.11.2025 16:10:00;APPLE;USA-NASDAQ;S;1;200;USD;1;USD;200;USD",
        "18.11.2025 10:00:00;PKOBP;WWA-GPW;K;1;50,00;;;;50,00;",
        "18.11.2025 10:00:00;SHELL;GBR-LSE;K;1;30;;;;;",
        "18.11.2025 10:00:00;PKOBP;WWA-GPW;X;1;50;PLN;;;50;PLN",
        "18.11.2025 10:00:00;PKOBP;WWA-GPW;K;1;50;PLN;;;60;PLN",
        "18.11.2025 10:00:00;PKOBP;WWA-GPW;K;0;50;PLN;;;0;PLN",
        '18.11.2025 10:00:00;"PKOBP;WWA-GPW;K;1;50;PLN;;;50;PLN',
        "30.03.2025 02:30:00;PKOBP;WWA-GPW;K;1;50;PLN;;;50;PLN",
        "Suma;;;;;;;;;100;PLN",
      ]),
    );
    expect(result.rows).toHaveLength(10);
    expect(byLine(result, 5)).toMatchObject({
      symbol: "MICROSOFT",
      status: "new",
      input: {
        amount: { amount: "-3216" },
        fxRate: "4.02",
        fxSource: "implied",
      },
    });
    expect(byLine(result, 6)).toMatchObject({
      status: "error",
      reason: "unsupported_fee_currency",
    });
    expect(byLine(result, 7)).toMatchObject({
      status: "new",
      reason: "price_currency_from_exchange",
      input: { priceCurrency: "PLN", amount: { amount: "-50" } },
    });
    expect(byLine(result, 8)).toMatchObject({
      mic: "XLON",
      status: "error",
      reason: "missing_price_currency",
    });
    expect(byLine(result, 9).reason).toBe("unknown_side");
    expect(byLine(result, 10).reason).toBe("settlement_value_mismatch");
    expect(byLine(result, 11).reason).toBe("invalid_quantity");
    expect(byLine(result, 12)).toMatchObject({ status: "error", reason: "invalid_csv_row" });
    expect(byLine(result, 12).raw.line).toContain("PKOBP");
    expect(byLine(result, 13)).toMatchObject({
      status: "error",
      reason: "ambiguous_or_invalid_time",
    });
    expect(byLine(result, 14).status).toBe("error");
  });

  test("security names compare without case, diacritics, punctuation or legal form", () => {
    expect(nameKey("  Microsoft   Corporation ")).toBe("MICROSOFT");
    expect(nameKey("KGHM Polska Miedź S.A.")).toBe("KGHM POLSKA MIEDZ");
    expect(nameKey("Orlen SA")).toBe("ORLEN");
    expect(nameKey("PZU")).toBe("PZU");
    expect(nameKey("ŁÓDŹ-ZAKŁADY")).toBe("LODZ ZAKLADY");
  });
});

describe("mBank eMakler financial history", () => {
  test("fixture: deposit, blocks and T+2 settlements skipped, dividend gross/tax/net", () => {
    const result = parse(fixture("finansowa"));
    expect(result.format).toBe("mbank.financial");
    expect(result.rows.map((r) => [r.status, r.reason, r.input.type])).toEqual([
      ["new", undefined, "DEPOSIT"],
      ["skipped", "order_block", undefined],
      ["skipped", "trade_settlement", undefined],
      ["new", undefined, "DIVIDEND"],
    ]);
    expect(result.rows[0].input.amount.amount).toBe(
      Number.parseFloat(expected.financial_history.deposits[0]).toString(),
    );
    expect(result.rows[2]).toMatchObject({
      isin: "PLKGHM000017",
      input: { tradeDate: "2025-02-12", amount: { amount: "-1510" } },
    });
    // Reconciliation target: every cash flow except order blocks.
    expect(result.cash).toBe("3526.45");
    const dividend = result.rows[3];
    expect(dividend).toMatchObject({
      symbol: "PLKGHM000017",
      isin: "PLKGHM000017",
      dividendGross: "45",
      dividendTax: "8.55",
      input: { quantity: "15", price: "3", priceCurrency: "PLN", amount: { amount: "36.45" } },
    });
    const prepared = prepareImportInput(
      {
        input: { ...dividend.input, instrumentId },
        symbol: dividend.symbol,
        key: dividend.key,
        dividendGross: dividend.dividendGross,
        dividendTax: dividend.dividendTax,
      },
      { ...account, accountType: "regular", broker: "mbank" },
    );
    const ledger = buildLedger({
      accounts: [{ id: accountId, currency: "PLN", accountType: "regular" }],
      transactions: [toCoreTransaction(prepared, "d1", "mbank")],
    });
    const [want] = expected.dividends;
    expect(ledger.dividends[0].credited.amount.toFixed(2)).toBe(want.net_pln);
    expect(ledger.dividends[0].gross.amount.toFixed(2)).toBe(want.gross_pln);
    expect(prepared.tax).toEqual({ amount: want.withholding_pln, currency: "PLN" });
  });

  test("description patterns map by sign; unknown descriptions stay visible", () => {
    const result = parse(
      cash([
        "01.03.2025 10:00:00;WYP.BK: 000002 POZ: 0000002;-200,00",
        "02.03.2025 10:00:00;Przelew z r-ku 00000000;1 000,00",
        "03.03.2025 10:00:00;PRZELEW NA IKZE 00000000;-300,00",
        "04.03.2025 10:00:00;ZASILENIE IKZE;300,00",
        "05.03.2025 10:00:00;DOPŁATA DO LIMITU IKZE 2025;50,00",
        "06.03.2025 10:00:00;Odblokowanie środków z zlecenia nr 1;1 510,00",
        "07.03.2025;IKE/IKZE WYPELNIONY LIMIT;0,00",
        "08.03.2025 10:00:00;Opłata za prowadzenie rachunku;-10,00",
        "09.03.2025 10:00:00;Dywidenda z 2 PW: US5949181045 DP: 2025-02-20 stawka brutto w wal.: 0.83 stawka pod.: 19% kurs przewalutowania: 4,0000;5,38",
        "10.03.2025 10:00:00;Dywidenda z 2 PW: IE00B4L5Y983 DP: 2025-02-20 stawka brutto w wal.: 0.50 stawka pod.: 19%;1,00",
        "11.03.2025 10:00:00;Dywidenda z 2 PW: PLKGHM000017 DP: 2025-02-20 stawka brutto w wal.: 1.00 stawka pod.: 19%;3,00",
        "12.03.2025 10:00:00;WYC.BK: 000003;abc",
      ]),
    );
    const view = result.rows.map((r) => [r.status, r.reason ?? r.input.type]);
    expect(view).toEqual([
      ["new", "WITHDRAWAL"],
      ["new", "DEPOSIT"],
      ["new", "WITHDRAWAL"],
      ["new", "DEPOSIT"],
      ["new", "DEPOSIT"],
      ["skipped", "order_block"],
      ["skipped", "informational"],
      ["unsupported", "unknown_description"],
      ["new", "DIVIDEND"],
      ["error", "missing_dividend_details"],
      ["error", "dividend_amount_mismatch"],
      ["error", "invalid_decimal"],
    ]);
    expect(result.rows[6].input).toMatchObject({ tradeDate: "2025-03-07" });
    expect(result.rows[6].input.executedAt).toBeUndefined();
    expect(result.rows[7].input.type).toBeUndefined();
    // US dividend: gross USD 1.66 × 4.0000 = 6.64 PLN, tax 1.26 PLN; withholding converted back to USD.
    expect(result.rows[8]).toMatchObject({
      dividendGross: "6.64",
      dividendTax: "1.26",
      input: { priceCurrency: "USD", quantity: "2", price: "0.83" },
    });
    const prepared = prepareImportInput(
      {
        input: { ...result.rows[8].input, instrumentId },
        symbol: "x",
        key: "k",
        dividendGross: "6.64",
        dividendTax: "1.26",
      },
      { ...account, accountType: "regular", broker: "mbank" },
    );
    expect(prepared.tax).toEqual({ amount: "0.315", currency: "USD" });
    // Blocks and informational rows are not cash flows; the unknown fee is.
    expect(result.cash).toBe("849.38");
  });
});

describe("mBank eMakler file safety", () => {
  test("rejects non-PLN accounts, spreadsheets, unknown headers and oversized input", () => {
    expect(() => parseMbank(fixture("transakcji"), { id: accountId, currency: "USD" })).toThrow(
      "account_currency_mismatch",
    );
    expect(() => parse(Buffer.from("504b030414000000", "hex"))).toThrow("IMPORT_FORMAT_UNKNOWN");
    expect(() => parse(Buffer.from("Type;Ticker;Time;Amount;ID;Comment\n"))).toThrow(
      "IMPORT_FORMAT_UNKNOWN",
    );
    expect(() => parse(Buffer.alloc(10485761, 0x41))).toThrow("FILE_TOO_LARGE");
    expect(() => parse(Buffer.alloc(0))).toThrow("FILE_TOO_LARGE");
  });

  test(
    "5000 rows parse within 30 seconds and 50001 rows fail closed",
    () => {
      const line = (i) =>
        `05.02.2025 10:00:00;WYC.BK: ${String(i).padStart(6, "0")} POZ: 0000001;1,00`;
      const start = performance.now();
      const result = parse(cash(Array.from({ length: 5000 }, (_, i) => line(i))));
      expect(result.rows).toHaveLength(5000);
      expect(result.cash).toBe("5000");
      expect(performance.now() - start).toBeLessThan(30000);
      expect(() => parse(cash(Array.from({ length: 50001 }, (_, i) => line(i))))).toThrow();
    },
    BULK_TEST_TIMEOUT_MS,
  );
});
