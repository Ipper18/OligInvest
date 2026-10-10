import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { realtimeSchemas } from "@oliginvest/contracts";
import { type AppEnv, ProblemError } from "@oliginvest/platform";
import { streamSSE } from "hono/streaming";
import { marketError } from "./modules.js";
import type { StreamOwner, StreamStore } from "./stream-store.js";

export interface StreamDependencies {
  store(): Promise<StreamStore>;
  authorize(request: Request): Promise<StreamOwner>;
  ownedInstruments(owner: StreamOwner): Promise<string[]>;
  valuation?(
    owner: StreamOwner,
  ): Promise<z.infer<(typeof realtimeSchemas)["portfolio.valuation.updated"]>>;
  origin: string;
  now?: () => number;
}
export function mountStream(api: OpenAPIHono<AppEnv>, dependencies: StreamDependencies) {
  const now = dependencies.now ?? Date.now;
  const object = <S extends z.ZodRawShape>(shape: S) =>
    z.object(shape).strict().openapi({ additionalProperties: true });
  api.openapi(
    createRoute({
      method: "put",
      path: "/stream/connections/{connectionId}/instruments",
      operationId: "setStreamInstruments",
      tags: ["platform"],
      security: [{ sessionCookie: [] }],
      request: {
        params: z.object({ connectionId: z.uuid() }).strict(),
        body: {
          required: true,
          content: {
            "application/json": {
              schema: object({
                instrumentIds: z.array(z.uuid()).max(50).openapi({ uniqueItems: true }),
              }).openapi("StreamInstrumentSet"),
            },
          },
        },
      },
      responses: {
        204: { description: "Zbiór zapisany." },
        401: marketError,
        404: marketError,
        422: marketError,
      },
    }),
    async (c) => {
      const owner = await dependencies.authorize(c.req.raw);
      if (c.req.header("origin") !== dependencies.origin) throw new ProblemError("FORBIDDEN");
      await (await dependencies.store()).replace(
        owner,
        c.req.valid("param").connectionId,
        c.req.valid("json").instrumentIds,
      );
      return c.body(null, 204);
    },
    (result) => {
      if (!result.success) throw new ProblemError("VALIDATION_FAILED");
    },
  );
  api.openapi(
    createRoute({
      method: "get",
      path: "/stream",
      operationId: "openEventStream",
      tags: ["platform"],
      security: [{ sessionCookie: [] }],
      parameters: [
        { name: "Last-Event-ID", in: "header", schema: { type: "string", maxLength: 64 } },
      ],
      responses: {
        200: {
          description: "Strumień zdarzeń.",
          headers: { "Cache-Control": { schema: { type: "string" } } },
          content: { "text/event-stream": { schema: z.string() } },
        },
        401: marketError,
        403: marketError,
        429: {
          ...marketError,
          headers: {
            ...marketError.headers,
            "Retry-After": { schema: { type: "integer", minimum: 1 } },
            RateLimit: { schema: { type: "string" } },
            "RateLimit-Policy": { schema: { type: "string" } },
          },
        },
      },
    }),
    async (c) => {
      const owner = await dependencies.authorize(c.req.raw);
      const headers = z
        .object({ last: z.string().max(64).optional() })
        .strict()
        .safeParse({ last: c.req.header("last-event-id") });
      if (!headers.success) throw new ProblemError("BAD_REQUEST");
      const store = await dependencies.store();
      const id = await store.claim(owner);
      let resume: Awaited<ReturnType<StreamStore["resume"]>>;
      try {
        resume = await store.resume(owner.userId, c.req.header("last-event-id"));
      } catch (error) {
        await store.release(owner, id);
        throw error;
      }
      c.header("Cache-Control", "no-store");
      c.header("X-Accel-Buffering", "no");
      const response = streamSSE(c, async (stream) => {
        const subscriber = store.redis.duplicate({ lazyConnect: true });
        let closed = false,
          recheck = false,
          flags: string[] | undefined;
        let allowed = new Set<string>();
        let extra = new Set<string>();
        const pending = new Map<
          string,
          z.infer<(typeof realtimeSchemas)["market.quotes.updated"]>["quotes"][number]
        >();
        const stop = () => {
          closed = true;
          subscriber.disconnect();
        };
        stream.onAbort(stop);
        const lifetime = setTimeout(() => {
          stop();
          stream.abort();
        }, 3600000);
        subscriber.on("error", () => {
          stop();
          stream.abort();
        });
        subscriber.on("message", (channel, text) => {
          if (text.length > 250000) return;
          try {
            if (channel === "sse:auth") {
              recheck = true;
              return;
            }
            if (channel === "flags.changed") {
              const parsed = realtimeSchemas["flags.changed"].safeParse({
                v: 1,
                ...JSON.parse(text),
              });
              if (parsed.success) flags = parsed.data.keys;
            }
            if (channel === "sse:quotes") {
              const parsed = realtimeSchemas["market.quotes.updated"].safeParse(JSON.parse(text));
              if (parsed.success)
                for (const quote of parsed.data.quotes) {
                  if (
                    (allowed.has(quote.instrumentId) || extra.has(quote.instrumentId)) &&
                    (pending.size < 200 || pending.has(quote.instrumentId))
                  )
                    pending.set(quote.instrumentId, quote);
                }
            }
          } catch {
            /* Invalid pub/sub is discarded; REST remains the source of truth. */
          }
        });
        const send = async (
          event: keyof typeof realtimeSchemas,
          data: unknown,
          eventId?: string,
        ) => {
          const parsed = realtimeSchemas[event].parse(data);
          const deadline = setTimeout(() => stream.abort(), 5000);
          try {
            await stream.writeSSE({
              event,
              data: JSON.stringify(parsed),
              ...(eventId ? { id: eventId } : {}),
            });
          } finally {
            clearTimeout(deadline);
          }
        };
        try {
          allowed = new Set(await dependencies.ownedInstruments(owner));
          extra = new Set(await store.instruments(owner, id));
          await subscriber.subscribe("sse:quotes", "flags.changed", "sse:auth");
          await stream.write("retry: 5000\n\n");
          await send("ready", {
            v: 1,
            connectionId: id,
            heartbeatSeconds: 25,
            resumed: resume.resumed,
          });
          if (c.req.header("last-event-id") && !resume.resumed)
            await send("resync", { v: 1, reason: "gap" });
          let cursor = resume.cursor,
            heartbeat = now(),
            lastQuote = 0;
          const durable: Awaited<ReturnType<StreamStore["read"]>> = [];
          let nextValuation = 0;
          while (!closed) {
            if (recheck || now() - heartbeat >= 25000) {
              recheck = false;
              try {
                const current = await dependencies.authorize(c.req.raw);
                if (current.sessionId !== owner.sessionId || current.userId !== owner.userId)
                  throw new Error("REVOKED");
              } catch {
                await send("auth.session.revoked", { v: 1, reason: "revoked" });
                break;
              }
              allowed = new Set(await dependencies.ownedInstruments(owner));
              heartbeat = now();
              await send("ping", { ts: new Date().toISOString() });
            }
            if (await store.hasGap(owner.userId, cursor)) {
              await send("resync", { v: 1, reason: "gap" });
              durable.length = 0;
              cursor = (await store.resume(owner.userId, undefined)).cursor;
            }
            if (durable.length < 500) {
              const events = await store.read(owner.userId, cursor);
              durable.push(...events);
              cursor = events.at(-1)?.id ?? cursor;
            }
            while (durable.length) {
              let event = durable[0];
              if (!event) break;
              if (event.event === "portfolio.valuation.updated") {
                if (now() < nextValuation) break;
                const accounts = new Set<string>();
                const firstTime = Number(event.id.split("-")[0]);
                do {
                  const value = realtimeSchemas["portfolio.valuation.updated"].parse(event.data);
                  for (const account of value.accountIds) accounts.add(account);
                  durable.shift();
                  const next = durable[0];
                  if (
                    !next ||
                    next.event !== event.event ||
                    Number(next.id.split("-")[0]) - firstTime >= 2000
                  )
                    break;
                  event = next;
                } while (durable.length);
                const value = realtimeSchemas["portfolio.valuation.updated"].parse(event.data);
                await send(event.event, { ...value, accountIds: [...accounts] }, event.id);
                nextValuation = now() + 2000;
              } else {
                durable.shift();
                await send(event.event, event.data, event.id);
              }
            }
            if (flags) {
              await send("flags.changed", { v: 1, keys: flags });
              flags = undefined;
            }
            extra = new Set(await store.instruments(owner, id));
            if (pending.size && now() - lastQuote >= 5000) {
              const quotes = [...pending.values()].filter(
                (q) => allowed.has(q.instrumentId) || extra.has(q.instrumentId),
              );
              pending.clear();
              if (quotes.length) {
                await send("market.quotes.updated", { v: 1, quotes });
                if (dependencies.valuation) {
                  const valuation = realtimeSchemas["portfolio.valuation.updated"].parse(
                    await dependencies.valuation(owner),
                  );
                  await send("portfolio.valuation.updated", valuation);
                }
                lastQuote = now();
              }
            }
            await stream.sleep(250);
          }
        } catch {
          /* Closing causes EventSource to reconnect and REST polling to take over. */
        } finally {
          clearTimeout(lifetime);
          stop();
          await store.release(owner, id).catch(() => {});
        }
      });
      response.headers.set("Cache-Control", "no-store");
      return response;
    },
  );
}
