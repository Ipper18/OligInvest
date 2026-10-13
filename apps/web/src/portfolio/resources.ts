import "server-only";
import { loadConfig } from "@oliginvest/config";
import { chartSchema, instrumentSchema, pageSchema } from "@oliginvest/mod-market/contracts";
import {
  accountSchema,
  cashBalanceSchema,
  dayChangeResponse,
  importBatchPage,
  importBatchSchema,
  importRowPage,
  lotPage,
  portfolioSummary,
  positionsResponse,
  realizedResponse,
  transactionPage,
  transactionSchema,
} from "@oliginvest/mod-portfolio/contracts";
import { headers } from "next/headers";
import * as z from "zod";
import { problemSchema } from "../api/validation";

export const readSpecs = {
  accounts: {
    path: "/portfolio/accounts",
    output: z.object({ data: z.array(accountSchema) }).strict(),
  },
  account: { path: "/portfolio/accounts/:id", output: accountSchema },
  summary: { path: "/portfolio/summary", output: portfolioSummary },
  day: { path: "/portfolio/day-change", output: dayChangeResponse },
  positions: { path: "/portfolio/positions", output: positionsResponse },
  cash: {
    path: "/portfolio/cash",
    output: z.object({ data: z.array(cashBalanceSchema) }).strict(),
  },
  lots: { path: "/portfolio/lots", output: lotPage },
  realized: { path: "/portfolio/realized", output: realizedResponse },
  transactions: { path: "/portfolio/transactions", output: transactionPage },
  transaction: { path: "/portfolio/transactions/:id", output: transactionSchema },
  imports: { path: "/portfolio/imports", output: importBatchPage },
  import: { path: "/portfolio/imports/:id", output: importBatchSchema },
  rows: { path: "/portfolio/imports/:id/rows", output: importRowPage },
  search: { path: "/market/instruments", output: pageSchema },
  instrument: { path: "/market/instruments/:id", output: instrumentSchema },
  chart: { path: "/market/instruments/:id/chart", output: chartSchema },
} as const;
export type ReadKey = keyof typeof readSpecs;
export type Resource<K extends ReadKey> = z.infer<(typeof readSpecs)[K]["output"]>;
export const readArgs = z
  .object({
    id: z.uuid().optional(),
    accountId: z.uuid().optional(),
    instrumentId: z.uuid().optional(),
    view: z.enum(["economic", "tax"]).optional(),
    groupBy: z
      .enum(["account_instrument", "instrument", "account", "day", "month", "year"])
      .optional(),
    cursor: z.string().max(512).optional(),
    type: z.string().max(32).optional(),
    status: z.string().max(32).optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    q: z.string().max(64).optional(),
    interval: z.enum(["1d", "1w", "1mo"]).optional(),
  })
  .strict();
export type ReadArgs = z.infer<typeof readArgs>;
export class DomainError extends Error {
  constructor(
    readonly code: string,
    readonly requestId: string,
    readonly fields: { path: string; message: string }[] = [],
  ) {
    super(code);
  }
}
export async function domainRequest(path: string, init: RequestInit = {}) {
  if (!path.startsWith("/portfolio/") && !path.startsWith("/market/"))
    throw new Error("INVALID_DOMAIN_PATH");
  const config = loadConfig("web", process.env, {
    mode: process.env.NODE_ENV as "production" | "development" | "test",
  });
  const incoming = await headers();
  const outgoing = new Headers(init.headers);
  outgoing.set("cookie", incoming.get("cookie") ?? "");
  outgoing.set("origin", new URL(config.PUBLIC_BASE_URL).origin);
  outgoing.set("x-request-id", incoming.get("x-request-id") ?? "");
  const response = await fetch(new URL(`/api/v1${path}`, new URL(config.API_INTERNAL_URL).origin), {
    ...init,
    headers: outgoing,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const problem = problemSchema.parse(await response.json());
    throw new DomainError(
      problem.code,
      response.headers.get("x-request-id") ?? "",
      problem.errors ?? [],
    );
  }
  return response.status === 204 ? undefined : response.json();
}
export async function fetchResource<K extends ReadKey>(
  key: K,
  raw: ReadArgs = {},
): Promise<Resource<K>> {
  if (!Object.hasOwn(readSpecs, key)) throw new Error("INVALID_RESOURCE");
  const { id, ...args } = readArgs.parse(raw);
  const spec = readSpecs[key];
  const path = spec.path.includes(":id") ? spec.path.replace(":id", z.uuid().parse(id)) : spec.path;
  const query = new URLSearchParams(
    Object.entries(args).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  return spec.output.parse(
    await domainRequest(`${path}${query.size ? `?${query}` : ""}`),
  ) as Resource<K>;
}
