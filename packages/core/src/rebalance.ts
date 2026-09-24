import { PLN } from "./currency.js";
import { Decimal, type DecimalInput, toDecimal } from "./decimal.js";
import { PIT_CAPITAL_RATE } from "./dividends.js";
import { CoreError } from "./errors.js";
import type { Lot } from "./ledger.js";
import { assertSameCurrency, type Money, money } from "./money.js";

export interface RebalanceHolding {
  readonly instrumentId: string;
  /** Current market value in the account currency (0 for a target not held yet). */
  readonly value: Money;
  /** Price of one unit in the account currency; needed to round to whole units. */
  readonly unitPrice?: Money | undefined;
  /** Fractional units allowed by the broker (default: whole units when `unitPrice` is given). */
  readonly fractional?: boolean | undefined;
  /** Open FIFO lots of the position (ledger `positions[].lots`) for the estimated tax of a sale. */
  readonly lots?: readonly Lot[] | undefined;
}

export interface RebalanceInput {
  readonly holdings: readonly RebalanceHolding[];
  /** Target weights t_i (fractions, sum exactly 1); held instruments without a target have 0. */
  readonly targets: readonly { readonly instrumentId: string; readonly weight: DecimalInput }[];
  readonly mode: "full" | "buy_only";
  /** Uninvested cash already on the account (part of W). */
  readonly cash?: Money | undefined;
  /** New cash to invest; `buy_only` distributes only this amount. */
  readonly newCash?: Money | undefined;
  /** Tolerance band in weight points (default 0.05 = ±5 p.p.). */
  readonly band?: DecimalInput | undefined;
  readonly minOrder?: Money | undefined;
  /** Proportional cost per order (commission, FX, slippage — cost model of § 12.7). */
  readonly costRate?: DecimalInput | undefined;
  readonly minCost?: Money | undefined;
  /** Regular account: estimated 19 % tax on FIFO gains of sales (tax-view cost); IKE/IKZE: false. */
  readonly taxable: boolean;
  /** § 12.5 lock: reconciled import within 7 days and no open differences (checked by the caller). */
  readonly reconciled: boolean;
}

export interface RebalanceTrade {
  readonly instrumentId: string;
  readonly side: "buy" | "sell";
  /** Signed: purchase +, sale −. */
  readonly amount: Money;
  readonly quantity: Decimal | null;
  readonly cost: Money;
  /**
   * Estimate only (UI label „szacunek”): 19 % of (sale value − order cost − FIFO tax-view cost of the
   * lots: settlement date, NBP D-1, FX margin excluded — § 2.2). Null without lots, with lots lacking
   * a tax cost (missing rate, IKE/IKZE) or on an account not in PLN.
   */
  readonly estimatedTax: Money | null;
}

export interface RebalanceWeight {
  readonly instrumentId: string;
  readonly weight: number;
}

export interface RebalanceResult {
  /** `blocked`: unreconciled data — show the warning and no trade list (§ 12.5, § 13.2). */
  readonly status: "ok" | "blocked";
  /** W = Σ V_i + cash + new cash. */
  readonly total: Money;
  readonly trades: readonly RebalanceTrade[];
  /** Instruments within the tolerance band. */
  readonly skipped: readonly string[];
  readonly weightsBefore: readonly RebalanceWeight[];
  readonly weightsAfter: readonly RebalanceWeight[];
  readonly costs: Money;
  readonly estimatedTax: Money | null;
  readonly cashAfter: Money;
}

interface Line {
  holding: RebalanceHolding;
  target: Decimal;
  skipped: boolean;
  amount: Decimal;
  quantity: Decimal | null;
}

const ZERO = new Decimal(0);

function invalid(message: string): never {
  throw new CoreError("invalid_allocation", message);
}

/**
 * Rebalancing calculator (obliczenia-finansowe.md § 12.5): weights outside the band are brought to
 * target (`full`: t_i·W − V_i; `buy_only`: new cash in proportion to positive gaps), rounded to
 * whole units (buys down, sales to the nearest unit), leftover cash buys further units while a
 * target allows, then costs, estimated tax and weights after. A calculation, not a recommendation.
 */
export function rebalance(input: RebalanceInput): RebalanceResult {
  const currency =
    input.holdings[0]?.value.currency ?? input.cash?.currency ?? input.newCash?.currency ?? PLN;
  const same = (m: Money | undefined) => {
    if (m) assertSameCurrency(currency, m.currency);
  };
  const ids = new Set<string>();
  for (const h of input.holdings) {
    if (ids.has(h.instrumentId)) invalid(`Duplicate holding ${h.instrumentId}`);
    ids.add(h.instrumentId);
    same(h.value);
    same(h.unitPrice);
    if (h.unitPrice && (!h.unitPrice.amount.isPositive() || h.unitPrice.amount.isZero())) {
      invalid("Unit price must be positive");
    }
  }
  for (const m of [input.cash, input.newCash, input.minOrder, input.minCost]) same(m);
  const targets = new Map<string, Decimal>();
  let sum = ZERO;
  for (const t of input.targets) {
    const weight = toDecimal(t.weight);
    if (!ids.has(t.instrumentId) || targets.has(t.instrumentId)) {
      invalid(`Target ${t.instrumentId} must be a single holding (value 0 if not held)`);
    }
    if (weight.isNegative() || weight.greaterThan(1)) invalid("Target weights must be in [0, 1]");
    targets.set(t.instrumentId, weight);
    sum = sum.plus(weight);
  }
  if (!sum.equals(1)) invalid("Target weights must sum to exactly 1");
  const band = toDecimal(input.band ?? "0.05");
  if (band.isNegative()) invalid("Band must not be negative");
  const costRate = toDecimal(input.costRate ?? "0");
  if (costRate.isNegative()) invalid("Cost rate must not be negative");

  const cash = input.cash?.amount ?? ZERO;
  const fresh = input.newCash?.amount ?? ZERO;
  const invested = input.holdings.reduce((s, h) => s.plus(h.value.amount), ZERO);
  const baseW = invested.plus(cash);
  const W = baseW.plus(fresh);
  const weightOf = (value: Decimal, total: Decimal) =>
    total.isZero() ? 0 : value.div(total).toNumber();
  const weightsBefore = input.holdings.map((h) =>
    Object.freeze({ instrumentId: h.instrumentId, weight: weightOf(h.value.amount, baseW) }),
  );
  const m = (d: Decimal) => money(d, currency);

  if (!input.reconciled) {
    return Object.freeze({
      status: "blocked",
      total: m(W),
      trades: [],
      skipped: [],
      weightsBefore,
      weightsAfter: [],
      costs: m(ZERO),
      estimatedTax: m(ZERO),
      cashAfter: m(cash.plus(fresh)),
    });
  }

  const lines: Line[] = input.holdings.map((holding) => {
    const target = targets.get(holding.instrumentId) ?? ZERO;
    const current = baseW.isZero() ? ZERO : holding.value.amount.div(baseW);
    return {
      holding,
      target,
      skipped: current.minus(target).abs().lessThanOrEqualTo(band),
      amount: ZERO,
      quantity: null,
    };
  });
  const gapOf = (l: Line) => l.target.times(W).minus(l.holding.value.amount).minus(l.amount);

  if (input.mode === "full") {
    for (const l of lines) if (!l.skipped) l.amount = gapOf(l);
  } else {
    const gaps = lines.map((l) => (l.skipped ? ZERO : Decimal.max(gapOf(l), ZERO)));
    const total = gaps.reduce((s, g) => s.plus(g), ZERO);
    if (!total.isZero()) {
      lines.forEach((l, i) => {
        l.amount = fresh.times(gaps[i] as Decimal).div(total);
      });
    }
  }

  const wholeUnits = (l: Line) => l.holding.unitPrice !== undefined && !l.holding.fractional;
  for (const l of lines) {
    const p = l.holding.unitPrice?.amount;
    if (l.amount.isZero() || !p) continue;
    const units = l.amount.abs().div(p);
    if (!wholeUnits(l)) {
      l.quantity = units;
      continue;
    }
    let q = l.amount.isPositive()
      ? units.toDecimalPlaces(0, Decimal.ROUND_DOWN)
      : units.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    if (l.amount.isNegative()) q = Decimal.min(q, l.holding.value.amount.div(p));
    l.quantity = q;
    l.amount = l.amount.isPositive() ? q.times(p) : q.times(p).negated();
  }
  const minOrder = input.minOrder?.amount;
  for (const l of lines) {
    if (l.amount.isZero() || (minOrder && l.amount.abs().lessThan(minOrder))) {
      l.amount = ZERO;
      l.quantity = null;
    }
  }

  const costOf = (amount: Decimal) =>
    amount.isZero()
      ? ZERO
      : Decimal.max(amount.abs().times(costRate), input.minCost?.amount ?? ZERO);
  // buy_only spends only the new cash (§ 12.5, C-09); cash already on the account stays.
  const budget = input.mode === "buy_only" ? fresh : cash.plus(fresh);
  const idle = input.mode === "buy_only" ? cash : ZERO;
  const available = () => lines.reduce((s, l) => s.minus(l.amount).minus(costOf(l.amount)), budget);

  // Buys may exceed the cash (band skips, rounding, costs): trim the largest purchase.
  for (let guard = 0; available().isNegative() && guard < 10_000; guard += 1) {
    const largest = lines
      .filter((l) => l.amount.isPositive())
      .sort((a, b) => b.amount.comparedTo(a.amount))[0];
    if (!largest) break;
    const p = largest.holding.unitPrice?.amount;
    if (p && wholeUnits(largest)) {
      largest.quantity = (largest.quantity as Decimal).minus(1);
      largest.amount = (largest.quantity as Decimal).times(p);
    } else {
      largest.amount = Decimal.max(largest.amount.plus(available()), ZERO);
      if (p) largest.quantity = largest.amount.div(p);
    }
    if (largest.amount.isZero()) largest.quantity = null;
  }

  // Leftover cash buys further whole units while a target is not exceeded (§ 12.5 step 4).
  for (let guard = 0; guard < 10_000; guard += 1) {
    const cashLeft = available();
    const candidates = lines.filter((l) => {
      const p = l.holding.unitPrice?.amount;
      if (!p || !wholeUnits(l) || l.skipped || l.amount.isNegative()) return false;
      const extraCost = costOf(l.amount.plus(p)).minus(costOf(l.amount));
      // Never recreate an order below the minimum value (C-10).
      if (minOrder && l.amount.plus(p).lessThan(minOrder)) return false;
      return gapOf(l).greaterThanOrEqualTo(p) && cashLeft.greaterThanOrEqualTo(p.plus(extraCost));
    });
    const best = candidates.sort((a, b) => gapOf(b).comparedTo(gapOf(a)))[0];
    if (!best) break;
    const p = best.holding.unitPrice?.amount as Decimal;
    best.quantity = (best.quantity ?? ZERO).plus(1);
    best.amount = best.amount.plus(p);
  }

  // Trimming may push an order below the minimum: drop it (the cash stays).
  for (const l of lines) {
    if (minOrder && !l.amount.isZero() && l.amount.abs().lessThan(minOrder)) {
      l.amount = ZERO;
      l.quantity = null;
    }
  }

  const estimate = (l: Line, cost: Decimal): Decimal | null => {
    if (!input.taxable || !l.amount.isNegative()) return ZERO;
    const lots = l.holding.lots;
    if (currency !== PLN || !lots || lots.some((lot) => lot.taxCostRemaining === null)) return null;
    const held = lots.reduce((s, lot) => s.plus(lot.quantityRemaining), ZERO);
    let left = l.quantity ?? held.times(l.amount.abs()).div(l.holding.value.amount);
    let basis = ZERO;
    for (const lot of lots) {
      if (left.isZero()) break;
      const take = Decimal.min(left, lot.quantityRemaining);
      basis = basis.plus(
        (lot.taxCostRemaining as Money).amount.times(take).div(lot.quantityRemaining),
      );
      left = left.minus(take);
    }
    const gain = l.amount.abs().minus(cost).minus(basis);
    return gain.isPositive() ? gain.times(PIT_CAPITAL_RATE) : ZERO;
  };

  const trades: RebalanceTrade[] = [];
  let costs = ZERO;
  let tax: Decimal | null = ZERO;
  for (const l of lines) {
    if (l.amount.isZero()) continue;
    const cost = costOf(l.amount);
    const estimated = estimate(l, cost);
    costs = costs.plus(cost);
    tax = tax === null || estimated === null ? null : tax.plus(estimated);
    trades.push(
      Object.freeze({
        instrumentId: l.holding.instrumentId,
        side: l.amount.isPositive() ? "buy" : "sell",
        amount: m(l.amount),
        quantity: l.quantity,
        cost: m(cost),
        estimatedTax: estimated === null ? null : m(estimated),
      }),
    );
  }
  const cashAfter = available().plus(idle);
  const after = lines.map((l) => l.holding.value.amount.plus(l.amount));
  const totalAfter = after.reduce((s, v) => s.plus(v), cashAfter);
  return Object.freeze({
    status: "ok",
    total: m(W),
    trades: Object.freeze(trades),
    skipped: Object.freeze(lines.filter((l) => l.skipped).map((l) => l.holding.instrumentId)),
    weightsBefore: Object.freeze(weightsBefore),
    weightsAfter: Object.freeze(
      lines.map((l, i) =>
        Object.freeze({
          instrumentId: l.holding.instrumentId,
          weight: weightOf(after[i] as Decimal, totalAfter),
        }),
      ),
    ),
    costs: m(costs),
    estimatedTax: tax === null ? null : m(tax),
    cashAfter: m(cashAfter),
  });
}
