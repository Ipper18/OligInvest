import { createHash } from "node:crypto";
import type { DatabaseContext, DatabaseTransaction } from "@oliginvest/db";
import { ProblemError } from "@oliginvest/platform";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  summarySchema,
  watchlistDetail,
  watchlistInput,
  watchlistItemInput,
  watchlistItemPatch,
  watchlistItemSchema,
  watchlistPatch,
  watchlistSchema,
} from "../contracts.js";
import type { MarketRepository } from "./repository.js";

const clean = (row: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null));
const keySchema = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);
const columns = sql`w.id::text,w.name,w.position,(SELECT count(*)::integer FROM market.watchlist_items WHERE watchlist_id=w.id) AS "itemCount",to_char(w.created_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt",to_char(w.updated_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt"`;
export class WatchlistRepository {
  constructor(readonly market: MarketRepository) {}
  async readList(tx: DatabaseTransaction, id: string) {
    const row = (
      await tx.execute(sql`SELECT ${columns} FROM market.watchlists w WHERE id=${id}::uuid`)
    ).rows[0];
    if (!row) throw new ProblemError("NOT_FOUND");
    return watchlistSchema.parse(row);
  }
  async readItems(tx: DatabaseTransaction, id: string) {
    return (
      await tx.execute(
        sql`SELECT i.id::text,coalesce(i.ticker,i.isin,i.id::text) AS ticker,i.name,i.isin,i.mic,i.currency,i.type,i.country,i.is_active AS "isActive",i.exchange_short_name AS "exchangeShortName",w.note,w.position,to_char(w.added_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "addedAt" FROM market.watchlist_items w JOIN market.instruments i ON i.id=w.instrument_id WHERE w.watchlist_id=${id}::uuid ORDER BY w.position,i.id`,
      )
    ).rows.map(({ note, position, addedAt, ...instrument }) =>
      watchlistItemSchema.parse({
        instrument: summarySchema.parse(clean(instrument)),
        position,
        addedAt,
        ...(note === null ? {} : { note }),
      }),
    );
  }
  async list(context: DatabaseContext) {
    return this.market.database.transaction(context, async (tx) => ({
      data: (
        await tx.execute(sql`SELECT ${columns} FROM market.watchlists w ORDER BY position,id`)
      ).rows.map((row) => watchlistSchema.parse(row)),
    }));
  }
  async detail(context: DatabaseContext, id: string) {
    z.uuid().parse(id);
    const result = await this.market.database.transaction(context, async (tx) => ({
      ...(await this.readList(tx, id)),
      items: await this.readItems(tx, id),
    }));
    const quotes: Awaited<ReturnType<MarketRepository["quotes"]>> = [];
    for (let i = 0; i < result.items.length; i += 100)
      quotes.push(
        ...(await this.market.quotes(
          context,
          result.items.slice(i, i + 100).map((item) => item.instrument.id),
        )),
      );
    return watchlistDetail.parse({
      ...result,
      items: result.items.map((item) => {
        const quote = quotes.find((q) => q.instrumentId === item.instrument.id);
        if (!quote) return item;
        const { fetchedAt: _f, ...dto } = quote;
        return { ...item, quote: dto };
      }),
    });
  }
  async mutate<T>(
    context: DatabaseContext,
    path: string,
    input: unknown,
    key: string | undefined,
    work: (tx: DatabaseTransaction) => Promise<T>,
  ) {
    if (!context.userId) throw new ProblemError("UNAUTHENTICATED");
    if (key && !keySchema.safeParse(key).success) throw new ProblemError("VALIDATION_FAILED");
    try {
      return await this.market.database.transaction(context, async (tx) => {
        const lock = (
          await tx.execute(
            sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${`market-watchlists:${context.userId}`},0)) AS acquired`,
          )
        ).rows[0];
        if (!lock?.acquired) throw new ProblemError("CONFLICT", { retryAfterSeconds: 1 });
        const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
        if (key) {
          await tx.execute(
            sql`DELETE FROM platform.idempotency_keys WHERE key=${key} AND expires_at<=now()`,
          );
          const old = (
            await tx.execute(
              sql`SELECT method,path,request_hash,response_body FROM platform.idempotency_keys WHERE key=${key}`,
            )
          ).rows[0];
          if (old) {
            if (old.method !== "POST" || old.path !== path || old.request_hash !== hash)
              throw new ProblemError("IDEMPOTENCY_CONFLICT");
            return { value: old.response_body as T, replayed: true };
          }
        }
        const value = await work(tx);
        if (key)
          await tx.execute(
            sql`INSERT INTO platform.idempotency_keys(user_id,key,method,path,request_hash,status_code,response_body,expires_at) VALUES(${context.userId}::uuid,${key},'POST',${path},${hash},201,${JSON.stringify(value)}::jsonb,now()+interval '24 hours')`,
          );
        return { value, replayed: false };
      });
    } catch (error) {
      const pg = error as { code?: string; cause?: { code?: string } };
      const code = pg.code ?? pg.cause?.code;
      if (code === "23505") throw new ProblemError("CONFLICT");
      if (code === "23503") throw new ProblemError("NOT_FOUND");
      throw error;
    }
  }
  async create(context: DatabaseContext, raw: unknown, key?: string) {
    const input = watchlistInput.parse(raw);
    return this.mutate(context, "/market/watchlists", input, key, async (tx) => {
      const row = (
        await tx.execute(
          sql`INSERT INTO market.watchlists(user_id,name,position) SELECT ${context.userId}::uuid,${input.name},coalesce(max(position)+1,0) FROM market.watchlists RETURNING id::text`,
        )
      ).rows[0];
      return this.readList(tx, String(row?.id));
    });
  }
  async update(context: DatabaseContext, id: string, raw: unknown) {
    const input = watchlistPatch.parse(raw);
    return (
      await this.mutate(context, "", input, undefined, async (tx) => {
        await this.readList(tx, id);
        if (input.name !== undefined)
          await tx.execute(
            sql`UPDATE market.watchlists SET name=${input.name},updated_at=now() WHERE id=${id}::uuid`,
          );
        if (input.position !== undefined) {
          const ids = (
            await tx.execute(
              sql`SELECT id::text FROM market.watchlists WHERE id<>${id}::uuid ORDER BY position,id`,
            )
          ).rows.map((r) => String(r.id));
          ids.splice(Math.min(input.position, ids.length), 0, id);
          for (const [position, current] of ids.entries())
            await tx.execute(
              sql`UPDATE market.watchlists SET position=${position},updated_at=now() WHERE id=${current}::uuid`,
            );
        }
        return this.readList(tx, id);
      })
    ).value;
  }
  async remove(context: DatabaseContext, id: string) {
    await this.mutate(context, "", {}, undefined, async (tx) => {
      await this.readList(tx, id);
      await tx.execute(sql`DELETE FROM market.watchlists WHERE id=${id}::uuid`);
    });
  }
  async addItem(context: DatabaseContext, id: string, raw: unknown, key?: string) {
    const input = watchlistItemInput.parse(raw);
    return this.mutate(context, `/market/watchlists/${id}/items`, input, key, async (tx) => {
      await this.readList(tx, id);
      await tx.execute(
        sql`INSERT INTO market.watchlist_items(watchlist_id,user_id,instrument_id,note,position) SELECT ${id}::uuid,${context.userId}::uuid,${input.instrumentId}::uuid,${input.note ?? null},coalesce(max(position)+1,0) FROM market.watchlist_items WHERE watchlist_id=${id}::uuid`,
      );
      await tx.execute(sql`UPDATE market.watchlists SET updated_at=now() WHERE id=${id}::uuid`);
      return (await this.readItems(tx, id)).find(
        (item) => item.instrument.id === input.instrumentId,
      )!;
    });
  }
  async updateItem(context: DatabaseContext, id: string, instrumentId: string, raw: unknown) {
    const input = watchlistItemPatch.parse(raw);
    return (
      await this.mutate(context, "", input, undefined, async (tx) => {
        await this.readList(tx, id);
        const items = await this.readItems(tx, id);
        if (!items.some((item) => item.instrument.id === instrumentId))
          throw new ProblemError("NOT_FOUND");
        if (input.note !== undefined)
          await tx.execute(
            sql`UPDATE market.watchlist_items SET note=${input.note} WHERE watchlist_id=${id}::uuid AND instrument_id=${instrumentId}::uuid`,
          );
        if (input.position !== undefined) {
          const ids = items
            .map((item) => item.instrument.id)
            .filter((current) => current !== instrumentId);
          ids.splice(Math.min(input.position, ids.length), 0, instrumentId);
          for (const [position, current] of ids.entries())
            await tx.execute(
              sql`UPDATE market.watchlist_items SET position=${position} WHERE watchlist_id=${id}::uuid AND instrument_id=${current}::uuid`,
            );
        }
        await tx.execute(sql`UPDATE market.watchlists SET updated_at=now() WHERE id=${id}::uuid`);
        return (await this.readItems(tx, id)).find((item) => item.instrument.id === instrumentId)!;
      })
    ).value;
  }
  async removeItem(context: DatabaseContext, id: string, instrumentId: string) {
    await this.mutate(context, "", {}, undefined, async (tx) => {
      await this.readList(tx, id);
      const result = await tx.execute(
        sql`DELETE FROM market.watchlist_items WHERE watchlist_id=${id}::uuid AND instrument_id=${instrumentId}::uuid RETURNING instrument_id`,
      );
      if (!result.rows.length) throw new ProblemError("NOT_FOUND");
      await tx.execute(sql`UPDATE market.watchlists SET updated_at=now() WHERE id=${id}::uuid`);
    });
  }
}
