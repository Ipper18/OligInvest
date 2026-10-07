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
  origin: string;
}
export function mountStream(api: OpenAPIHono<AppEnv>, dependencies: StreamDependencies) {
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
      request: {
        headers: z
          .object({
            "Last-Event-ID": z
              .string()
              .max(64)
              .optional()
              .openapi({ param: { name: "Last-Event-ID", in: "header" } }),
          })
          .strict(),
      },
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
          },
        },
      },
    }),
    async (c) => {
      const owner = await dependencies.authorize(c.req.raw);
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
      return streamSSE(c, async (stream) => {
        const subscriber = store.redis.duplicate({ lazyConnect: true });
        let closed = false,
          recheck = false,
          flags: string[] | undefined;
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
                  if (pending.size < 200 || pending.has(quote.instrumentId))
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
          await stream.writeSSE({
            event,
            data: JSON.stringify(parsed),
            ...(eventId ? { id: eventId } : {}),
          });
        };
        try {
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
            heartbeat = Date.now(),
            lastQuote = 0;
          let allowed = new Set(await dependencies.ownedInstruments(owner));
          while (!closed) {
            if (recheck || Date.now() - heartbeat >= 25000) {
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
              heartbeat = Date.now();
              await send("ping", { ts: new Date().toISOString() });
            }
            for (const event of await store.read(owner.userId, cursor)) {
              await send(event.event, event.data, event.id);
              cursor = event.id;
            }
            if (flags) {
              await send("flags.changed", { v: 1, keys: flags });
              flags = undefined;
            }
            if (pending.size && Date.now() - lastQuote >= 5000) {
              const extra = new Set(await store.instruments(owner, id));
              const quotes = [...pending.values()].filter(
                (q) => allowed.has(q.instrumentId) || extra.has(q.instrumentId),
              );
              pending.clear();
              if (quotes.length) {
                await send("market.quotes.updated", { v: 1, quotes });
                lastQuote = Date.now();
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
    },
  );
}
