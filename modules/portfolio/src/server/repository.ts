import { createHash } from "node:crypto";
import { buildLedger, currencyCode, isCoreError } from "@oliginvest/core";
import type { AppDatabase, DatabaseContext, DatabaseTransaction } from "@oliginvest/db";
import { ProblemError } from "@oliginvest/platform";
import { and, asc, desc, eq, inArray, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import {
  portfolioAccounts as accounts,
  portfolioTransactions as transactions,
} from "../../db/schema.js";
import {
  accountInput,
  accountPatch,
  accountSchema,
  keySchema,
  type TransactionInput,
  type TransactionRecord,
  transactionInput,
  transactionPatch,
  transactionSchema,
} from "../contracts.js";
import { normalizeTransaction, toCoreTransaction } from "../domain/transactions.js";

export const clean = (row: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null && v !== undefined));
const instant = (value: string) => new Date(value).toISOString();
export function accountDto(row: typeof accounts.$inferSelect) {
  const { userId: _userId, ...data } = row;
  return accountSchema.parse(
    clean({ ...data, createdAt: instant(row.createdAt), updatedAt: instant(row.updatedAt) }),
  );
}
export function transactionDto(row: typeof transactions.$inferSelect): TransactionRecord {
  const {
    userId: _u,
    cashCurrency,
    feeCurrency,
    taxCurrency,
    counterCurrency,
    createdByApiKey: _k,
    ...data
  } = row;
  return transactionSchema.parse(
    clean({
      ...data,
      amount: { amount: row.amount, currency: cashCurrency },
      fee: feeCurrency ? { amount: row.fee, currency: feeCurrency } : undefined,
      tax: taxCurrency ? { amount: row.tax, currency: taxCurrency } : undefined,
      cashInLieu: row.cashInLieu ? { amount: row.cashInLieu, currency: cashCurrency } : undefined,
      acquisitionCost: row.acquisitionCost
        ? { amount: row.acquisitionCost, currency: cashCurrency }
        : undefined,
      counterAmount:
        row.counterAmount && counterCurrency
          ? { amount: row.counterAmount, currency: counterCurrency }
          : undefined,
      executedAt: row.executedAt ? instant(row.executedAt) : undefined,
      createdAt: instant(row.createdAt),
      updatedAt: instant(row.updatedAt),
    }),
  );
}
export function transactionValues(
  input: TransactionInput & { amount: { amount: string; currency: string } },
) {
  const { amount, fee, tax, counterAmount, cashInLieu, acquisitionCost, ...fields } = input;
  return {
    ...fields,
    amount: amount.amount,
    cashCurrency: amount.currency,
    fee: fee?.amount ?? "0",
    feeCurrency: fee?.currency ?? null,
    tax: tax?.amount ?? "0",
    taxCurrency: tax?.currency ?? null,
    counterAmount: counterAmount?.amount ?? null,
    counterCurrency: counterAmount?.currency ?? null,
    cashInLieu: cashInLieu?.amount ?? null,
    acquisitionCost: acquisitionCost?.amount ?? null,
  };
}
export function validationError(error: unknown): never {
  if (error instanceof ProblemError) throw error;
  if (isCoreError(error))
    throw new ProblemError("VALIDATION_FAILED", {
      errors: [
        {
          path: "transactions",
          code: error.code,
          message: "Operacje nie tworzą poprawnej księgi.",
        },
      ],
    });
  const pg = error as { code?: string; cause?: { code?: string } };
  const code = pg.code ?? pg.cause?.code;
  if (code === "23505") throw new ProblemError("CONFLICT");
  if (code === "23503") throw new ProblemError("NOT_FOUND");
  if (
    error instanceof z.ZodError ||
    code === "23514" ||
    (error instanceof Error && /^(ACCOUNT_|MISSING_|SPLIT_)/.test(error.message))
  )
    throw new ProblemError("VALIDATION_FAILED");
  throw error;
}
export async function lockOwner(tx: DatabaseTransaction, context: DatabaseContext) {
  if (!context.userId) throw new ProblemError("UNAUTHENTICATED");
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`portfolio:${context.userId}`},0))`,
  );
}
export async function loadLedger(tx: DatabaseTransaction) {
  const accountRows = await tx.select().from(accounts);
  const rows = await tx.select().from(transactions);
  const accountMap = new Map(accountRows.map((row) => [row.id, row]));
  const input = {
    accounts: accountRows.map((a) => ({
      id: a.id,
      currency: currencyCode(a.currency),
      accountType: accountSchema.parse(accountDto(a)).accountType,
    })),
    transactions: rows.map((row) =>
      toCoreTransaction(transactionDto(row), row.id, accountMap.get(row.accountId)?.broker),
    ),
  };
  return { ...input, accountRows, rows, ledger: buildLedger(input) };
}
export type EnqueueRecompute = (payload: {
  userId: string;
  accountIds: string[];
  fromDate: string;
  reason: "transactions" | "import";
}) => Promise<void>;
export class PortfolioRepository {
  constructor(
    readonly database: AppDatabase,
    readonly enqueue: EnqueueRecompute,
    readonly now = () => new Date(),
  ) {}
  async read<T>(
    context: DatabaseContext,
    work: (tx: DatabaseTransaction) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.database.transaction(context, work);
    } catch (error) {
      return validationError(error);
    }
  }
  async mutate<T>(
    context: DatabaseContext,
    work: (tx: DatabaseTransaction) => Promise<T>,
    key?: string,
  ): Promise<T> {
    return this.read(context, async (tx) => {
      if (key) {
        const [lock] = (
          await tx.execute(
            sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${`portfolio-idempotency:${context.userId}:${key}`},0)) AS acquired`,
          )
        ).rows;
        if (!lock?.acquired) throw new ProblemError("CONFLICT", { retryAfterSeconds: 1 });
      }
      await lockOwner(tx, context);
      return work(tx);
    });
  }
  async requireAccount(tx: DatabaseTransaction, id: string) {
    const [row] = await tx.select().from(accounts).where(eq(accounts.id, id));
    if (!row) throw new ProblemError("NOT_FOUND");
    return row;
  }
  async requireTransaction(tx: DatabaseTransaction, id: string) {
    const [row] = await tx.select().from(transactions).where(eq(transactions.id, id));
    if (!row) throw new ProblemError("NOT_FOUND");
    return row;
  }
  async replay<T>(
    tx: DatabaseTransaction,
    context: DatabaseContext,
    key: string | undefined,
    path: string,
    input: unknown,
    status: number,
    work: () => Promise<T>,
  ): Promise<{ value: T; replayed: boolean }> {
    if (!key) return { value: await work(), replayed: false };
    keySchema.parse(key);
    const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    await tx.execute(
      sql`DELETE FROM platform.idempotency_keys WHERE key=${key} AND expires_at<=now()`,
    );
    const [old] = (
      await tx.execute(
        sql`SELECT method,path,request_hash,response_body FROM platform.idempotency_keys WHERE key=${key}`,
      )
    ).rows;
    if (old) {
      if (old.path !== path || old.method !== "POST" || old.request_hash !== hash)
        throw new ProblemError("IDEMPOTENCY_CONFLICT");
      return { value: old.response_body as T, replayed: true };
    }
    const value = await work();
    await tx.execute(
      sql`INSERT INTO platform.idempotency_keys(user_id,key,method,path,request_hash,status_code,response_body,expires_at) VALUES(${context.userId}::uuid,${key},'POST',${path},${hash},${status},${JSON.stringify(value)}::jsonb,now()+interval '24 hours')`,
    );
    return { value, replayed: false };
  }
  async listAccounts(context: DatabaseContext, includeClosed = false) {
    return this.read(context, async (tx) => ({
      data: (
        await tx
          .select()
          .from(accounts)
          .where(includeClosed ? undefined : sql`closed_on IS NULL`)
          .orderBy(asc(accounts.createdAt), asc(accounts.id))
      ).map(accountDto),
    }));
  }
  async getAccount(context: DatabaseContext, id: string) {
    return this.read(context, async (tx) => accountDto(await this.requireAccount(tx, id)));
  }
  async createAccount(context: DatabaseContext, raw: unknown, key?: string) {
    const input = accountInput.parse(raw);
    currencyCode(input.currency);
    return this.mutate(
      context,
      (tx) =>
        this.replay(tx, context, key, "/portfolio/accounts", input, 201, async () => {
          const [row] = await tx
            .insert(accounts)
            .values({ ...input, userId: context.userId! })
            .returning();
          return accountDto(row!);
        }),
      key,
    );
  }
  async updateAccount(context: DatabaseContext, id: string, raw: unknown) {
    const patch = accountPatch.parse(raw);
    const result = await this.mutate(context, async (tx) => {
      await this.requireAccount(tx, id);
      const [row] = await tx
        .update(accounts)
        .set({ ...patch, updatedAt: this.now().toISOString() })
        .where(eq(accounts.id, id))
        .returning();
      return accountDto(row!);
    });
    await this.enqueue({
      userId: context.userId!,
      accountIds: [id],
      fromDate: result.openedOn ?? "1970-01-01",
      reason: "transactions",
    });
    return result;
  }
  async deleteAccount(context: DatabaseContext, id: string) {
    await this.mutate(context, async (tx) => {
      await this.requireAccount(tx, id);
      await tx.delete(accounts).where(eq(accounts.id, id));
      await loadLedger(tx);
    });
    await this.enqueue({
      userId: context.userId!,
      accountIds: [],
      fromDate: "1970-01-01",
      reason: "transactions",
    });
  }
  async getTransaction(context: DatabaseContext, id: string) {
    return this.read(context, async (tx) => transactionDto(await this.requireTransaction(tx, id)));
  }
  async listTransactions(
    context: DatabaseContext,
    query: {
      accountId?: string[] | undefined;
      instrumentId?: string | undefined;
      type?: string[] | undefined;
      from?: string | undefined;
      to?: string | undefined;
      sort: string;
      limit: number;
      cursor?: string | undefined;
    },
  ) {
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ ...query, cursor: undefined }))
      .digest("hex");
    let cursor: { value: string; id: string } | undefined;
    if (query.cursor) {
      try {
        cursor = z
          .object({ value: z.string(), id: z.uuid(), fingerprint: z.literal(fingerprint) })
          .strict()
          .parse(JSON.parse(Buffer.from(query.cursor, "base64url").toString()));
      } catch {
        throw new ProblemError("VALIDATION_FAILED");
      }
    }
    const column = query.sort.includes("createdAt")
      ? transactions.createdAt
      : transactions.tradeDate;
    const descending = query.sort.startsWith("-");
    const filters: SQL[] = [];
    if (query.accountId?.length) filters.push(inArray(transactions.accountId, query.accountId));
    if (query.instrumentId) filters.push(eq(transactions.instrumentId, query.instrumentId));
    if (query.type?.length) filters.push(inArray(transactions.type, query.type));
    if (query.from) filters.push(sql`${transactions.tradeDate}>=${query.from}`);
    if (query.to) filters.push(sql`${transactions.tradeDate}<=${query.to}`);
    if (cursor)
      filters.push(
        descending
          ? sql`(${column},${transactions.id})<(${cursor.value},${cursor.id}::uuid)`
          : sql`(${column},${transactions.id})>(${cursor.value},${cursor.id}::uuid)`,
      );
    return this.read(context, async (tx) => {
      const rows = await tx
        .select()
        .from(transactions)
        .where(and(...filters))
        .orderBy(
          descending ? desc(column) : asc(column),
          descending ? desc(transactions.id) : asc(transactions.id),
        )
        .limit(query.limit + 1);
      const selected = rows.slice(0, query.limit);
      const last = selected.at(-1);
      return {
        data: selected.map(transactionDto),
        page: {
          hasMore: rows.length > query.limit,
          ...(rows.length > query.limit && last
            ? {
                nextCursor: Buffer.from(
                  JSON.stringify({
                    id: last.id,
                    value: query.sort.includes("createdAt") ? last.createdAt : last.tradeDate,
                    fingerprint,
                  }),
                ).toString("base64url"),
              }
            : {}),
        },
      };
    });
  }
  async createTransaction(context: DatabaseContext, raw: unknown, key: string) {
    const input = transactionInput.parse(raw);
    const result = await this.mutate(
      context,
      (tx) =>
        this.replay(tx, context, key, "/portfolio/transactions", input, 201, async () => {
          const account = await this.requireAccount(tx, input.accountId);
          if (account.closedOn) throw new ProblemError("CONFLICT");
          const normalized = normalizeTransaction(input, {
            ...account,
            currency: currencyCode(account.currency),
            accountType: accountSchema.parse(accountDto(account)).accountType,
          });
          const [row] = await tx
            .insert(transactions)
            .values({ ...transactionValues(normalized), userId: context.userId!, source: "manual" })
            .returning();
          await loadLedger(tx);
          return transactionDto(row!);
        }),
      key,
    );
    await this.enqueue({
      userId: context.userId!,
      accountIds: [result.value.accountId],
      fromDate: result.value.tradeDate,
      reason: "transactions",
    });
    return result;
  }
  async updateTransaction(context: DatabaseContext, id: string, raw: unknown) {
    const patch = transactionPatch.parse(raw);
    let fromDate = "";
    const result = await this.mutate(context, async (tx) => {
      const before = await this.requireTransaction(tx, id);
      const account = await this.requireAccount(tx, before.accountId);
      if (account.closedOn) throw new ProblemError("CONFLICT");
      const {
        id: _id,
        source: _s,
        createdAt: _c,
        updatedAt: _u,
        externalId: _e,
        importBatchId: _b,
        ...original
      } = transactionDto(before);
      const normalized = normalizeTransaction(
        { ...original, ...patch },
        {
          ...account,
          currency: currencyCode(account.currency),
          accountType: accountSchema.parse(accountDto(account)).accountType,
        },
      );
      fromDate = before.tradeDate < normalized.tradeDate ? before.tradeDate : normalized.tradeDate;
      const [row] = await tx
        .update(transactions)
        .set({ ...transactionValues(normalized), updatedAt: this.now().toISOString() })
        .where(eq(transactions.id, id))
        .returning();
      await loadLedger(tx);
      return transactionDto(row!);
    });
    await this.enqueue({
      userId: context.userId!,
      accountIds: [result.accountId],
      fromDate,
      reason: "transactions",
    });
    return result;
  }
  async deleteTransaction(context: DatabaseContext, id: string) {
    const before = await this.mutate(context, async (tx) => {
      const row = await this.requireTransaction(tx, id);
      await tx.delete(transactions).where(eq(transactions.id, id));
      await loadLedger(tx);
      return row;
    });
    await this.enqueue({
      userId: context.userId!,
      accountIds: [before.accountId],
      fromDate: before.tradeDate,
      reason: "transactions",
    });
  }
}
