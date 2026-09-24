import { type CurrencyCode, currencyCode, PLN } from "./currency.js";
import type { IsoDate } from "./dates.js";
import { Decimal } from "./decimal.js";
import { CoreError } from "./errors.js";
import type { FxRateTable } from "./fx.js";
import { type Money, money, type Quantity } from "./money.js";
import {
  ACCOUNT_TYPES,
  type Account,
  type SecurityTransferTransaction,
  type SplitTransaction,
  sortTransactions,
  type TradeTransaction,
  type Transaction,
  validateTransaction,
} from "./transactions.js";

/** User settings of the tax view (`identity.user_preferences`, 11-zgodnosc-prawna.md § 5.2). */
export interface TaxSettings {
  readonly dateBasis: "settlement" | "trade";
  readonly includeFxFee: boolean;
}

export const DEFAULT_TAX_SETTINGS: TaxSettings = Object.freeze({
  dateBasis: "settlement",
  includeFxFee: false,
});

export interface LedgerInput {
  readonly accounts: readonly Account[];
  readonly transactions: readonly Transaction[];
  readonly taxSettings?: TaxSettings | undefined;
  /** NBP table A; only `before(currency, 'PLN', taxDate)` is used (§ 2.2). */
  readonly taxRates?: FxRateTable | undefined;
}

export type LedgerIssueCode = "missing_settle_date" | "missing_tax_rate";

/** Data gap that disables the tax view of an operation; the economic view is unaffected. */
export interface LedgerIssue {
  readonly code: LedgerIssueCode;
  readonly transactionId: string;
  readonly currency?: CurrencyCode;
  readonly date?: IsoDate;
}

/** FIFO lot (`portfolio.lots`). Quantities are in current units (after splits). */
export interface Lot {
  readonly key: string;
  readonly accountId: string;
  readonly instrumentId: string;
  /** BUY, or SECURITY_TRANSFER_IN for a lot moved from another account. */
  readonly openTransactionId: string;
  /** The BUY that created the lot originally. */
  readonly originTransactionId: string;
  readonly acquiredOn: IsoDate;
  readonly taxDate: IsoDate | null;
  readonly quantityAcquired: Quantity;
  readonly splitFactor: Decimal;
  readonly quantityRemaining: Quantity;
  /** Economic cost (account currency) incl. commission, taxes and FX margin. */
  readonly cost: Money;
  readonly costRemaining: Money;
  readonly unitCost: Money | null;
  /** K_i: q·p plus costs charged in the instrument currency (§ 4.2). */
  readonly costInstrument: Money;
  readonly costInstrumentRemaining: Money;
  readonly fxFee: Money;
  readonly fxFeeRemaining: Money;
  /** Tax-view cost in PLN without FX margin (NBP D-1); null if not applicable or data missing. */
  readonly taxCost: Money | null;
  readonly taxCostRemaining: Money | null;
  readonly closedOn: IsoDate | null;
}

export interface ConsumptionTaxView {
  readonly costPln: Money;
  readonly proceedsPln: Money;
  readonly fxCostPln: Money;
  readonly realizedPlPln: Money;
}

/** Part of a sale matched to one lot (`portfolio.lot_consumptions`). */
export interface LotConsumption {
  readonly lotKey: string;
  readonly closeTransactionId: string;
  readonly accountId: string;
  readonly instrumentId: string;
  readonly closedOn: IsoDate;
  readonly quantity: Quantity;
  readonly costEconomic: Money;
  readonly proceedsEconomic: Money;
  readonly realizedPlEconomic: Money;
  readonly costInstrument: Money;
  readonly proceedsInstrument: Money;
  readonly lotFxFee: Money;
  readonly sellFxFee: Money;
  readonly tax: ConsumptionTaxView | null;
}

export interface SaleTaxView {
  readonly taxDate: IsoDate;
  readonly proceedsPln: Money;
  /** Includes `fxCostsPln` when `includeFxFee` is on. */
  readonly costPln: Money;
  /** FX margin of consumed lots plus that of the sale — shown separately by default. */
  readonly fxCostsPln: Money;
  readonly realizedPlPln: Money;
}

export type TaxStatus = "computed" | "not_applicable" | "missing_data";

export interface RealizedSale {
  readonly transactionId: string;
  readonly accountId: string;
  readonly instrumentId: string;
  readonly tradeDate: IsoDate;
  readonly quantity: Quantity;
  readonly proceedsEconomic: Money;
  readonly costEconomic: Money;
  readonly realizedPlEconomic: Money;
  readonly sellFxFee: Money;
  readonly taxStatus: TaxStatus;
  readonly tax: SaleTaxView | null;
  readonly consumptions: readonly LotConsumption[];
}

export interface Ledger {
  readonly lots: readonly Lot[];
  readonly sales: readonly RealizedSale[];
  readonly issues: readonly LedgerIssue[];
}

interface WorkingLot {
  key: string;
  accountId: string;
  instrumentId: string;
  openTransactionId: string;
  originTransactionId: string;
  acquiredOn: IsoDate;
  taxDate: IsoDate | null;
  order: number;
  quantityAcquired: Decimal;
  splitFactor: Decimal;
  quantityRemaining: Decimal;
  costCurrency: CurrencyCode;
  instrumentCurrency: CurrencyCode;
  cost: Decimal;
  costRemaining: Decimal;
  costInstrument: Decimal;
  costInstrumentRemaining: Decimal;
  fxFee: Decimal;
  fxFeeRemaining: Decimal;
  taxCost: Decimal | null;
  taxCostRemaining: Decimal | null;
  fxFeePln: Decimal | null;
  fxFeePlnRemaining: Decimal | null;
  closedOn: IsoDate | null;
}

interface Share {
  quantity: Decimal;
  cost: Decimal;
  costInstrument: Decimal;
  fxFee: Decimal;
  taxCost: Decimal | null;
  fxFeePln: Decimal | null;
}

const ZERO = new Decimal(0);

function plus(a: Decimal | null, b: Decimal | null): Decimal | null {
  return a === null || b === null ? null : a.plus(b);
}

/** Proportional part of a lot; taking all remaining units takes every remaining amount exactly. */
function takeShare(lot: WorkingLot, units: Decimal, date: IsoDate): Share {
  const all = units.equals(lot.quantityRemaining);
  const part = (remaining: Decimal) =>
    all ? remaining : remaining.times(units).div(lot.quantityRemaining);
  const share: Share = {
    quantity: units,
    cost: part(lot.costRemaining),
    costInstrument: part(lot.costInstrumentRemaining),
    fxFee: part(lot.fxFeeRemaining),
    taxCost: lot.taxCostRemaining === null ? null : part(lot.taxCostRemaining),
    fxFeePln: lot.fxFeePlnRemaining === null ? null : part(lot.fxFeePlnRemaining),
  };
  lot.quantityRemaining = lot.quantityRemaining.minus(units);
  lot.costRemaining = lot.costRemaining.minus(share.cost);
  lot.costInstrumentRemaining = lot.costInstrumentRemaining.minus(share.costInstrument);
  lot.fxFeeRemaining = lot.fxFeeRemaining.minus(share.fxFee);
  if (lot.taxCostRemaining !== null && share.taxCost !== null) {
    lot.taxCostRemaining = lot.taxCostRemaining.minus(share.taxCost);
  }
  if (lot.fxFeePlnRemaining !== null && share.fxFeePln !== null) {
    lot.fxFeePlnRemaining = lot.fxFeePlnRemaining.minus(share.fxFeePln);
  }
  if (lot.quantityRemaining.isZero()) lot.closedOn = date;
  return share;
}

/** Splits `total` over `weights` proportionally; the last part takes the remainder (exact sum). */
function allocate(total: Decimal, weights: readonly Decimal[], sum: Decimal): Decimal[] {
  let left = total;
  return weights.map((weight, index) => {
    if (index === weights.length - 1) return left;
    const part = total.times(weight).div(sum);
    left = left.minus(part);
    return part;
  });
}

function freezeLot(lot: WorkingLot): Lot {
  const m = (value: Decimal, currency: CurrencyCode) => money(value, currency);
  const tax = (value: Decimal | null) => (value === null ? null : money(value, PLN));
  return Object.freeze({
    key: lot.key,
    accountId: lot.accountId,
    instrumentId: lot.instrumentId,
    openTransactionId: lot.openTransactionId,
    originTransactionId: lot.originTransactionId,
    acquiredOn: lot.acquiredOn,
    taxDate: lot.taxDate,
    quantityAcquired: lot.quantityAcquired as Quantity,
    splitFactor: lot.splitFactor,
    quantityRemaining: lot.quantityRemaining as Quantity,
    cost: m(lot.cost, lot.costCurrency),
    costRemaining: m(lot.costRemaining, lot.costCurrency),
    unitCost: lot.quantityRemaining.isZero()
      ? null
      : m(lot.costRemaining.div(lot.quantityRemaining), lot.costCurrency),
    costInstrument: m(lot.costInstrument, lot.instrumentCurrency),
    costInstrumentRemaining: m(lot.costInstrumentRemaining, lot.instrumentCurrency),
    fxFee: m(lot.fxFee, lot.costCurrency),
    fxFeeRemaining: m(lot.fxFeeRemaining, lot.costCurrency),
    taxCost: tax(lot.taxCost),
    taxCostRemaining: tax(lot.taxCostRemaining),
    closedOn: lot.closedOn,
  });
}

function positionKey(accountId: string, instrumentId: string): string {
  return `${accountId}\u0000${instrumentId}`;
}

function indexAccounts(accounts: readonly Account[]): Map<string, Account> {
  const byId = new Map<string, Account>();
  for (const account of accounts) {
    if (
      typeof account?.id !== "string" ||
      byId.has(account.id) ||
      !(ACCOUNT_TYPES as readonly string[]).includes(account.accountType)
    ) {
      throw new CoreError("invalid_account", "Invalid or duplicate account", {
        accountId: typeof account?.id === "string" ? account.id : null,
      });
    }
    currencyCode(account.currency);
    byId.set(account.id, account);
  }
  return byId;
}

/**
 * Replays operations into FIFO lots per account and instrument (§ 3) and realized P/L in the
 * economic view (account currency, broker amounts) and the informational tax view (PLN, NBP D-1).
 * Pure: the same input always gives the same output; data errors throw `CoreError`.
 */
export function buildLedger(input: LedgerInput): Ledger {
  const settings = input.taxSettings ?? DEFAULT_TAX_SETTINGS;
  const accounts = indexAccounts(input.accounts);
  const seen = new Set<string>();
  for (const tx of input.transactions) {
    const account = accounts.get(tx.accountId);
    if (!account) {
      throw new CoreError("invalid_account", "Transaction refers to an unknown account", {
        transactionId: tx.id,
        accountId: tx.accountId,
      });
    }
    validateTransaction(tx, account);
    if (seen.has(tx.id)) {
      throw new CoreError("invalid_transaction", "Duplicate transaction id", {
        transactionId: tx.id,
      });
    }
    seen.add(tx.id);
  }

  const openLots = new Map<string, WorkingLot[]>();
  const allLots: WorkingLot[] = [];
  const sales: RealizedSale[] = [];
  const issues: LedgerIssue[] = [];
  const issueKeys = new Set<string>();
  const transferred = new Map<string, { tx: SecurityTransferTransaction; lots: WorkingLot[] }>();

  function report(issue: LedgerIssue) {
    const key = `${issue.code}|${issue.transactionId}|${issue.currency ?? ""}|${issue.date ?? ""}`;
    if (!issueKeys.has(key)) {
      issueKeys.add(key);
      issues.push(Object.freeze(issue));
    }
  }

  const taxApplies = (tx: Transaction) => {
    const type = (accounts.get(tx.accountId) as Account).accountType;
    return type !== "ike" && type !== "ikze";
  };

  function taxDateOf(tx: Transaction): IsoDate | null {
    if (settings.dateBasis === "trade") return tx.tradeDate;
    if (tx.settleDate !== undefined) return tx.settleDate;
    report({ code: "missing_settle_date", transactionId: tx.id });
    return null;
  }

  function toPln(value: Money | undefined, date: IsoDate | null, txId: string): Decimal | null {
    if (value === undefined) return ZERO;
    if (value.currency === PLN) return value.amount;
    if (date === null) return null;
    const rate = input.taxRates?.before(value.currency, PLN, date);
    if (!rate) {
      report({ code: "missing_tax_rate", transactionId: txId, currency: value.currency, date });
      return null;
    }
    return value.amount.times(rate.rate);
  }

  const inInstrumentCurrency = (tx: TradeTransaction, value: Money | undefined) =>
    value !== undefined && value.currency === tx.price.currency ? value.amount : ZERO;

  function lotsOf(accountId: string, instrumentId: string): WorkingLot[] {
    const key = positionKey(accountId, instrumentId);
    let list = openLots.get(key);
    if (!list) {
      list = [];
      openLots.set(key, list);
    }
    return list;
  }

  function insertLot(lot: WorkingLot) {
    const list = lotsOf(lot.accountId, lot.instrumentId);
    const at = list.findIndex(
      (other) =>
        other.acquiredOn > lot.acquiredOn ||
        (other.acquiredOn === lot.acquiredOn && other.order > lot.order),
    );
    list.splice(at === -1 ? list.length : at, 0, lot);
    allLots.push(lot);
  }

  function consume(accountId: string, instrumentId: string, units: Decimal, tx: Transaction) {
    const list = lotsOf(accountId, instrumentId);
    const available = list.reduce((sum, lot) => sum.plus(lot.quantityRemaining), ZERO);
    if (units.greaterThan(available)) {
      throw new CoreError("short_position", "Sale or transfer exceeds the quantity held", {
        transactionId: tx.id,
        available: available.toFixed(),
        requested: units.toFixed(),
      });
    }
    const taken: { lot: WorkingLot; share: Share }[] = [];
    let left = units;
    while (!left.isZero()) {
      const lot = list[0] as WorkingLot;
      const unitsFromLot = Decimal.min(left, lot.quantityRemaining);
      taken.push({ lot, share: takeShare(lot, unitsFromLot, tx.tradeDate) });
      left = left.minus(unitsFromLot);
      if (lot.quantityRemaining.isZero()) list.shift();
    }
    return taken;
  }

  function buy(tx: TradeTransaction, order: number) {
    const applies = taxApplies(tx);
    const taxDate = applies ? taxDateOf(tx) : null;
    const gross = tx.price.amount.times(tx.quantity);
    const fxFee = tx.fxFee?.amount ?? ZERO;
    const costInstrument = gross
      .plus(inInstrumentCurrency(tx, tx.fee))
      .plus(inInstrumentCurrency(tx, tx.tax));
    let taxCost: Decimal | null = null;
    let fxFeePln: Decimal | null = null;
    if (applies) {
      const grossMoney = money(gross, tx.price.currency);
      taxCost = plus(
        plus(toPln(grossMoney, taxDate, tx.id), toPln(tx.fee, taxDate, tx.id)),
        toPln(tx.tax, taxDate, tx.id),
      );
      fxFeePln = toPln(tx.fxFee, taxDate, tx.id);
    }
    insertLot({
      key: tx.id,
      accountId: tx.accountId,
      instrumentId: tx.instrumentId,
      openTransactionId: tx.id,
      originTransactionId: tx.id,
      acquiredOn: tx.tradeDate,
      taxDate,
      order,
      quantityAcquired: tx.quantity,
      splitFactor: new Decimal(1),
      quantityRemaining: tx.quantity,
      costCurrency: tx.amount.currency,
      instrumentCurrency: tx.price.currency,
      cost: tx.amount.amount.negated(),
      costRemaining: tx.amount.amount.negated(),
      costInstrument,
      costInstrumentRemaining: costInstrument,
      fxFee,
      fxFeeRemaining: fxFee,
      taxCost,
      taxCostRemaining: taxCost,
      fxFeePln,
      fxFeePlnRemaining: fxFeePln,
      closedOn: null,
    });
  }

  function sell(tx: TradeTransaction) {
    const applies = taxApplies(tx);
    const taxDate = applies ? taxDateOf(tx) : null;
    const taken = consume(tx.accountId, tx.instrumentId, tx.quantity, tx);
    const currency = tx.amount.currency;
    const instrumentCurrency = tx.price.currency;
    const gross = tx.price.amount.times(tx.quantity);
    const proceedsInstrument = gross
      .minus(inInstrumentCurrency(tx, tx.fee))
      .minus(inInstrumentCurrency(tx, tx.tax));
    const sellFxFee = tx.fxFee?.amount ?? ZERO;
    let proceedsTax: Decimal | null = null;
    let sellFxFeePln: Decimal | null = null;
    if (applies) {
      const grossPln = toPln(money(gross, instrumentCurrency), taxDate, tx.id);
      const feePln = toPln(tx.fee, taxDate, tx.id);
      const taxPln = toPln(tx.tax, taxDate, tx.id);
      proceedsTax =
        grossPln === null || feePln === null || taxPln === null
          ? null
          : grossPln.minus(feePln).minus(taxPln);
      sellFxFeePln = toPln(tx.fxFee, taxDate, tx.id);
    }

    const weights = taken.map(({ share }) => share.quantity);
    const proceedsParts = allocate(tx.amount.amount, weights, tx.quantity);
    const proceedsInstrumentParts = allocate(proceedsInstrument, weights, tx.quantity);
    const sellFxParts = allocate(sellFxFee, weights, tx.quantity);
    const proceedsTaxParts =
      proceedsTax === null ? null : allocate(proceedsTax, weights, tx.quantity);
    const sellFxPlnParts =
      sellFxFeePln === null ? null : allocate(sellFxFeePln, weights, tx.quantity);

    let costTotal = ZERO;
    let taxCostTotal: Decimal | null = applies && taxDate !== null ? ZERO : null;
    let fxCostTotal: Decimal | null = taxCostTotal;
    const consumptions = taken.map(({ lot, share }, index): LotConsumption => {
      const proceeds = proceedsParts[index] as Decimal;
      costTotal = costTotal.plus(share.cost);
      const fxCostPln = plus(share.fxFeePln, sellFxPlnParts?.[index] ?? null);
      const baseCostPln = share.taxCost;
      const proceedsPln = proceedsTaxParts?.[index] ?? null;
      let tax: ConsumptionTaxView | null = null;
      if (
        taxCostTotal !== null &&
        fxCostPln !== null &&
        baseCostPln !== null &&
        proceedsPln !== null
      ) {
        const costPln = settings.includeFxFee ? baseCostPln.plus(fxCostPln) : baseCostPln;
        tax = Object.freeze({
          costPln: money(costPln, PLN),
          proceedsPln: money(proceedsPln, PLN),
          fxCostPln: money(fxCostPln, PLN),
          realizedPlPln: money(proceedsPln.minus(costPln), PLN),
        });
        taxCostTotal = taxCostTotal.plus(costPln);
        fxCostTotal = (fxCostTotal as Decimal).plus(fxCostPln);
      } else {
        taxCostTotal = null;
        fxCostTotal = null;
      }
      return Object.freeze({
        lotKey: lot.key,
        closeTransactionId: tx.id,
        accountId: tx.accountId,
        instrumentId: tx.instrumentId,
        closedOn: tx.tradeDate,
        quantity: share.quantity as Quantity,
        costEconomic: money(share.cost, currency),
        proceedsEconomic: money(proceeds, currency),
        realizedPlEconomic: money(proceeds.minus(share.cost), currency),
        costInstrument: money(share.costInstrument, instrumentCurrency),
        proceedsInstrument: money(proceedsInstrumentParts[index] as Decimal, instrumentCurrency),
        lotFxFee: money(share.fxFee, lot.costCurrency),
        sellFxFee: money(sellFxParts[index] as Decimal, currency),
        tax,
      });
    });

    let taxView: SaleTaxView | null = null;
    if (taxDate !== null && taxCostTotal !== null && fxCostTotal !== null && proceedsTax !== null) {
      taxView = Object.freeze({
        taxDate,
        proceedsPln: money(proceedsTax, PLN),
        costPln: money(taxCostTotal, PLN),
        fxCostsPln: money(fxCostTotal, PLN),
        realizedPlPln: money(proceedsTax.minus(taxCostTotal), PLN),
      });
    }
    sales.push(
      Object.freeze({
        transactionId: tx.id,
        accountId: tx.accountId,
        instrumentId: tx.instrumentId,
        tradeDate: tx.tradeDate,
        quantity: tx.quantity,
        proceedsEconomic: tx.amount,
        costEconomic: money(costTotal, currency),
        realizedPlEconomic: money(tx.amount.amount.minus(costTotal), currency),
        sellFxFee: money(sellFxFee, currency),
        taxStatus: !applies ? "not_applicable" : taxView ? "computed" : "missing_data",
        tax: taxView,
        consumptions: Object.freeze(consumptions),
      }),
    );
  }

  function split(tx: SplitTransaction) {
    for (const lot of lotsOf(tx.accountId, tx.instrumentId)) {
      lot.quantityRemaining = lot.quantityRemaining.times(tx.splitRatio);
      lot.splitFactor = lot.splitFactor.times(tx.splitRatio);
    }
  }

  function transferOut(tx: SecurityTransferTransaction) {
    const taken = consume(tx.accountId, tx.instrumentId, tx.quantity, tx);
    const lots = taken.map(
      ({ lot, share }): WorkingLot => ({
        ...lot,
        quantityAcquired: share.quantity.div(lot.splitFactor),
        quantityRemaining: share.quantity,
        cost: share.cost,
        costRemaining: share.cost,
        costInstrument: share.costInstrument,
        costInstrumentRemaining: share.costInstrument,
        fxFee: share.fxFee,
        fxFeeRemaining: share.fxFee,
        taxCost: share.taxCost,
        taxCostRemaining: share.taxCost,
        fxFeePln: share.fxFeePln,
        fxFeePlnRemaining: share.fxFeePln,
        closedOn: null,
      }),
    );
    transferred.set(tx.id, { tx, lots });
    if (tx.relatedTransactionId !== undefined) {
      transferred.set(`in:${tx.relatedTransactionId}`, { tx, lots });
    }
  }

  function transferIn(tx: SecurityTransferTransaction) {
    const match =
      (tx.relatedTransactionId === undefined
        ? undefined
        : transferred.get(tx.relatedTransactionId)) ?? transferred.get(`in:${tx.id}`);
    if (
      !match ||
      match.tx.instrumentId !== tx.instrumentId ||
      !match.tx.quantity.equals(tx.quantity)
    ) {
      throw new CoreError(
        "unmatched_security_transfer",
        "SECURITY_TRANSFER_IN needs an earlier matching SECURITY_TRANSFER_OUT (same instrument and quantity)",
        { transactionId: tx.id },
      );
    }
    transferred.delete(match.tx.id);
    transferred.delete(`in:${tx.id}`);
    for (const source of match.lots) {
      insertLot({
        ...source,
        key: `${tx.id}/${source.key}`,
        accountId: tx.accountId,
        openTransactionId: tx.id,
      });
    }
  }

  sortTransactions(input.transactions).forEach((tx, order) => {
    switch (tx.type) {
      case "BUY":
        buy(tx, order);
        break;
      case "SELL":
        sell(tx);
        break;
      case "SPLIT":
        split(tx);
        break;
      case "SECURITY_TRANSFER_OUT":
        transferOut(tx);
        break;
      case "SECURITY_TRANSFER_IN":
        transferIn(tx);
        break;
      default:
        break;
    }
  });

  return Object.freeze({
    lots: Object.freeze(allLots.map(freezeLot)),
    sales: Object.freeze(sales),
    issues: Object.freeze(issues),
  });
}
