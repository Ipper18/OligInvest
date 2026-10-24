// Synthetic HTTP boundary data for rendering, accessibility and performance only.
import { randomUUID } from "node:crypto";
import { marketFixture } from "./market-fixture.mjs";
import { watchlistFixture } from "./watchlist-fixture.mjs";
export const instrumentId = "01900000-0000-7000-8000-000000000101";
export const accountId = "01900000-0000-7000-8000-000000000102";
export const transactionId = "01900000-0000-7000-8000-000000000103";
export const importId = "01900000-0000-7000-8000-000000000104";
const instant = "2026-10-13T12:00:00Z";
const money = (amount, currency = "PLN") => ({ amount, currency });
const instrument = {
  id: instrumentId,
  ticker: "TEST",
  name: "Instrument syntetyczny",
  mic: "XWAR",
  type: "stock",
  currency: "PLN",
  isActive: true,
};
const account = {
  id: accountId,
  name: "Rachunek syntetyczny",
  broker: "xtb",
  accountType: "regular",
  currency: "PLN",
  createdAt: instant,
  updatedAt: instant,
  reconciliationStatus: "never_imported",
};
const meta = {
  source: "gpw",
  asOf: instant,
  delayMinutes: 0,
  stale: true,
  staleReason: "no_data",
  attribution: "Źródło: GPW",
};
const emptyPage = { hasMore: false };
const users = new Map();
export async function portfolioFixture(request, response, key) {
  const url = new URL(request.url, "https://example.test"),
    path = url.pathname.replace("/api/v1", "");
  if (!path.startsWith("/portfolio/") && !path.startsWith("/market/")) return false;
  const send = (value, status = 200) => {
    response.writeHead(status).end(value === undefined ? undefined : JSON.stringify(value));
    return true;
  };
  if (!key)
    return send(
      {
        type: "https://example.test/problems/auth",
        title: "Brak sesji",
        status: 401,
        code: "UNAUTHENTICATED",
      },
      401,
    );
  if (marketFixture(path, url, send, instrumentId, instant)) return true;
  if (await watchlistFixture(request, path, send, key, instrument, instant)) return true;
  if (!users.has(key))
    users.set(key, {
      accounts: [
        { ...account },
        {
          ...account,
          id: "01900000-0000-7000-8000-000000000105",
          name: "mBank syntetyczny",
          broker: "mbank",
        },
      ],
      transactions: [],
      committed: false,
      mapped: false,
      source: "xtb",
    });
  const state = users.get(key);
  let body = "";
  if (request.method !== "GET") for await (const chunk of request) body += chunk;
  const data =
    body && !request.headers["content-type"]?.includes("multipart") ? JSON.parse(body) : {};
  const view = url.searchParams.get("view") ?? "economic";
  const exclusions = { count: 1, positions: [{ accountId, instrumentId }] };
  if (path === "/portfolio/day-change")
    return send({
      change: null,
      changeRatio: null,
      previousValue: money("1000"),
      currentValue: null,
      flowsToday: money("0"),
      residualChange: null,
      positions: [{ instrument, change: null, contributionRatio: null }],
      meta,
    });
  if (path === "/portfolio/accounts") {
    if (request.method === "POST") {
      const value = { ...account, ...data, id: randomUUID() };
      state.accounts.push(value);
      return send(value, 201);
    }
    return send({ data: state.accounts });
  }
  if (path.startsWith("/portfolio/accounts/")) {
    const found = state.accounts.find((a) => a.id === path.split("/").at(-1));
    if (request.method === "DELETE") {
      state.accounts = state.accounts.filter((a) => a !== found);
      return send(undefined, 204);
    }
    if (request.method === "PATCH") Object.assign(found, data);
    return send(found ?? account);
  }
  if (path === "/portfolio/summary")
    return send({
      totalValue: money("1000"),
      marketValue: money("0"),
      cash: money("1000"),
      unrealizedPl: money("0"),
      dayChange: null,
      dayChangeRatio: null,
      view,
      isComplete: false,
      exclusions,
      meta,
      accounts: [
        { accountId, name: account.name, totalValue: money("1000"), totalValueBase: money("1000") },
      ],
    });
  if (path === "/portfolio/positions")
    return send({
      data: [
        {
          instrument,
          ...(url.searchParams.get("groupBy") === "instrument" ? {} : { accountId }),
          quantity: "4",
          averageCost: null,
          costBasis: null,
          marketValue: null,
          marketValueBase: null,
          weight: null,
          unrealizedPl: null,
          meta,
        },
      ],
      totals: {
        marketValueBase: money("0"),
        costBasis: money("0"),
        unrealizedPl: money("0"),
        exclusions,
      },
      view,
      isComplete: false,
      meta,
    });
  if (path === "/portfolio/cash")
    return send({
      data: [{ accountId, balance: money("1000"), balanceBase: money("1000"), asOf: "2026-10-13" }],
    });
  if (path === "/portfolio/lots") return send({ data: [], page: emptyPage, method: "fifo" });
  if (path === "/portfolio/realized")
    return send({
      view,
      groupBy: "month",
      rows: [],
      totals: { proceeds: money("0"), cost: money("0"), realizedPl: money("0") },
      isComplete: true,
      exclusions: [],
    });
  if (path === "/portfolio/transactions") {
    if (request.method === "POST") {
      const value = {
        ...data,
        id: randomUUID(),
        amount: data.amount ?? money("-10"),
        createdAt: instant,
        updatedAt: instant,
        source: "manual",
      };
      state.transactions.push(value);
      return send(value, 201);
    }
    return send({ data: state.transactions, page: emptyPage });
  }
  if (path.startsWith("/portfolio/transactions/")) {
    const value = state.transactions.find((t) => t.id === path.split("/").at(-1)) ?? {
      id: transactionId,
      accountId,
      type: "DEPOSIT",
      tradeDate: "2026-10-13",
      amount: money("1000"),
      source: "manual",
      createdAt: instant,
      updatedAt: instant,
    };
    if (request.method === "DELETE") {
      state.transactions = state.transactions.filter((t) => t.id !== value.id);
      return send(undefined, 204);
    }
    if (request.method === "PATCH") Object.assign(value, data);
    return send(value);
  }
  if (path === "/market/instruments") return send({ data: [instrument], page: emptyPage });
  if (path.endsWith("/chart"))
    return send({
      instrumentId,
      interval: url.searchParams.get("interval") ?? "1d",
      adjusted: true,
      currency: "PLN",
      t: [1791763200, 1791849600],
      o: ["10", "11"],
      h: ["12", "13"],
      l: ["9", "10"],
      c: ["11", "12"],
      v: ["1000", "1200"],
      decimated: false,
      meta: { ...meta, staleReason: "eod_only" },
    });
  if (path.startsWith("/market/instruments/"))
    return send({
      ...instrument,
      lotSize: "1",
      supportsFractional: false,
      dataSources: { eod: "gpw", intraday: "yahoo" },
      range52w: { low: "8", high: "14" },
      quote: {
        instrumentId,
        price: "12",
        currency: "PLN",
        prevClose: "11",
        change: "1",
        changeRatio: 0.0909,
        volume: "1200",
        meta: { ...meta, staleReason: "eod_only" },
      },
    });
  if (path === "/portfolio/imports" && request.method === "POST") {
    state.source = body.includes("\r\nmbank\r\n") ? "mbank" : "xtb";
    state.awaitingParse = true;
  }
  const row = {
    id: "01900000-0000-7000-8000-000000000106",
    rowNumber: 2,
    raw: { instrument: "TEST" },
    status: state.mapped ? "new" : "needs_mapping",
    ...(state.mapped ? { instrumentId } : {}),
  };
  if (path.includes("/rows/") && request.method === "PATCH") {
    state.mapped = true;
    return send({ ...row, status: "new", instrumentId });
  }
  const batch = {
    id: importId,
    accountId,
    source: state.source,
    fileName: "synthetic.xlsx",
    status: state.committed ? "committed" : "parsed",
    createdAt: instant,
    summary: { rowsTotal: 2, byStatus: state.mapped ? { new: 2 } : { new: 1, needs_mapping: 1 } },
    reconciliation: {
      ok: false,
      cash: [
        {
          currency: "PLN",
          expected: money("1000"),
          computed: money("999"),
          difference: money("-1"),
        },
      ],
      positions: [],
    },
  };
  if (path === "/portfolio/imports")
    return request.method === "POST" ? send(batch, 201) : send({ data: [batch], page: emptyPage });
  if (path.endsWith("/rows"))
    return send({
      data: state.mapped && url.searchParams.has("status") ? [] : [row],
      page: emptyPage,
    });
  if (path.endsWith("/commit")) {
    state.committed = true;
    return send({ ...batch, status: "committed" });
  }
  if (path.startsWith("/portfolio/imports/") && request.method === "GET" && state.awaitingParse) {
    // Completion happens before the screen subscribes; no SSE event is replayed.
    state.awaitingParse = false;
    return send({ ...batch, status: "parsing", summary: undefined, reconciliation: undefined });
  }
  if (path.startsWith("/portfolio/imports/"))
    return request.method === "DELETE" ? send(undefined, 204) : send(batch);
  return false;
}
