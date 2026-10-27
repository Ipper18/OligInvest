import { expect, test, vi } from "vitest";

// A server barrel also loads HTTP routes, broker imports and valuation jobs.
// Quick actions must use the implementations supplied by the API composition root.
vi.mock("@oliginvest/mod-portfolio/server", () => {
  throw new Error("Quick server loaded the portfolio server barrel");
});
vi.mock("@oliginvest/mod-market/server", () => {
  throw new Error("Quick server loaded the market server barrel");
});

test("server loads without foundation server barrels and uses the injected readers", async () => {
  const { QuickRepository } = await import("@oliginvest/mod-quick-actions/server");
  const zero = { amount: "0", currency: "PLN" };
  const snapshot = {
    summary: {
      totalValue: zero,
      unrealizedPl: zero,
      isComplete: true,
      exclusions: { count: 0 },
      meta: { source: "mixed", asOf: "2026-10-27T12:00:00Z", stale: false, delayMinutes: 0 },
    },
    day: { change: zero, changeRatio: null },
    positions: [],
    gaps: [],
    previousGaps: [],
    missingCosts: [],
    movers: [],
  };
  const instrument = {
    id: "0192f0c4-7b1e-7c3a-9f00-3d2a1b4c5d6e",
    ticker: "SYN",
    name: "Synthetic",
    mic: "XWAR",
    currency: "PLN",
    type: "stock",
    isActive: true,
  };
  const portfolio = { read: vi.fn().mockResolvedValue(instrument) };
  const context = { userId: "0192f0c4-7b1e-7c3a-9f00-3d2a1b4c5d6e", role: "user" };
  const read = vi.fn().mockResolvedValue(snapshot);
  const market = {
    quotes: vi
      .fn()
      .mockResolvedValue([
        { price: "100", currency: "PLN", changeRatio: null, meta: snapshot.summary.meta },
      ]),
  };
  const repository = new QuickRepository(portfolio, read, market);
  expect(await repository.snapshot(context, "portfolio")).toMatchObject({
    totalValue: zero,
    incomplete: false,
    reasons: [],
  });
  expect(read).toHaveBeenCalledExactlyOnceWith(portfolio, context, "getQuickSnapshot", {
    view: "economic",
    groupBy: "instrument",
  });
  expect(market.quotes).not.toHaveBeenCalled();
  expect(await repository.quote(context, "SYN", "XWAR")).toMatchObject({
    ticker: "SYN",
    price: "100",
    currency: "PLN",
  });
  expect(portfolio.read).toHaveBeenCalledExactlyOnceWith(context, expect.any(Function));
  expect(market.quotes).toHaveBeenCalledExactlyOnceWith(context, [instrument.id]);
});
