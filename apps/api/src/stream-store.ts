import { randomUUID } from "node:crypto";
import { persistentEventSchema } from "@oliginvest/contracts";
import { ProblemError } from "@oliginvest/platform";
import type { Redis } from "ioredis";
import { z } from "zod";
export type StreamOwner = { userId: string; sessionId: string };
const connectionSchema = z
  .object({ userId: z.uuid(), sessionId: z.uuid(), instruments: z.array(z.uuid()).max(50) })
  .strict();
const CLAIM = `redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',ARGV[1]); if redis.call('ZCARD',KEYS[1])>=5 then return 0 end; redis.call('ZADD',KEYS[1],ARGV[2],ARGV[3]); redis.call('PEXPIRE',KEYS[1],3600000); redis.call('SET',KEYS[2],ARGV[4],'PX',3600000); return 1`;
const UPDATE = `local raw=redis.call('GET',KEYS[1]); if not raw then return 0 end; local old=cjson.decode(raw); if old.userId~=ARGV[1] or old.sessionId~=ARGV[2] then return 0 end; old.instruments=cjson.decode(ARGV[3]); redis.call('SET',KEYS[1],cjson.encode(old),'KEEPTTL'); return 1`;
export class StreamStore {
  constructor(
    readonly redis: Redis,
    readonly now = Date.now,
  ) {}
  async claim(owner: StreamOwner) {
    const id = randomUUID();
    const value = connectionSchema.parse({ ...owner, instruments: [] });
    const claimed = await this.redis.eval(
      CLAIM,
      2,
      `sse:connections:${owner.userId}`,
      `sse:connection:${id}`,
      this.now(),
      this.now() + 3600000,
      id,
      JSON.stringify(value),
    );
    if (claimed !== 1) throw new ProblemError("RATE_LIMITED", { retryAfterSeconds: 25 });
    return id;
  }
  async release(owner: StreamOwner, id: string) {
    await this.redis.zrem(`sse:connections:${owner.userId}`, id);
    await this.redis.del(`sse:connection:${id}`);
  }
  async instruments(owner: StreamOwner, id: string) {
    const raw = await this.redis.get(`sse:connection:${id}`);
    const value = connectionSchema.safeParse(raw ? JSON.parse(raw) : null);
    if (
      !value.success ||
      value.data.userId !== owner.userId ||
      value.data.sessionId !== owner.sessionId
    )
      throw new ProblemError("NOT_FOUND");
    return value.data.instruments;
  }
  async replace(owner: StreamOwner, id: string, input: string[]) {
    const ids = z.array(z.uuid()).max(50).parse(input);
    if (new Set(ids).size !== ids.length) throw new ProblemError("VALIDATION_FAILED");
    if (
      (await this.redis.eval(
        UPDATE,
        1,
        `sse:connection:${id}`,
        owner.userId,
        owner.sessionId,
        JSON.stringify(ids),
      )) !== 1
    )
      throw new ProblemError("NOT_FOUND");
  }
  async publish(userId: string, input: unknown) {
    z.uuid().parse(userId);
    const event = persistentEventSchema.parse(input);
    const key = `sse:${userId}`;
    const id = await this.redis.xadd(
      key,
      "MAXLEN",
      "~",
      500,
      "*",
      "event",
      event.event,
      "data",
      JSON.stringify(event.data),
    );
    await this.redis.xtrim(key, "MINID", `${this.now() - 600000}-0`);
    await this.redis.expire(key, 600);
    return id;
  }
  async resume(userId: string, last: string | undefined) {
    const key = `sse:${userId}`;
    const valid =
      !!last &&
      /^\d{1,16}-\d{1,16}$/.test(last) &&
      Number(last.split("-")[0]) >= this.now() - 600000 &&
      Number(last.split("-")[0]) <= this.now();
    if (valid && (await this.redis.xrange(key, last, last)).length)
      return { resumed: true, cursor: last };
    const latest = await this.redis.xrevrange(key, "+", "-", "COUNT", 1);
    return { resumed: false, cursor: latest[0]?.[0] ?? `${this.now()}-0` };
  }
  async read(userId: string, cursor: string) {
    const rows = await this.redis.xrange(`sse:${userId}`, `(${cursor}`, "+", "COUNT", 500);
    return rows.map(([id, fields]) => ({
      id,
      ...persistentEventSchema.parse({ event: fields[1], data: JSON.parse(fields[3] ?? "null") }),
    }));
  }
}
