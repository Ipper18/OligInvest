import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import { z } from "zod";
import { ProviderError } from "./contracts.js";

// Fixed Lua programs only; no untrusted code or interpolated script text.
const QUOTA = `
for i=1,2 do
 local limit=tonumber(ARGV[i]); local used=tonumber(redis.call('GET',KEYS[i]) or '0')
 if limit>0 and used+tonumber(ARGV[3])>limit then return redis.call('PTTL',KEYS[i]) end
end
for i=1,2 do
 if tonumber(ARGV[i])>0 then
  local used=redis.call('INCRBY',KEYS[i],ARGV[3]); if used==tonumber(ARGV[3]) then redis.call('PEXPIRE',KEYS[i],ARGV[i+3]) end
 end
end
return 0`;
const RELEASE = `if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0`;
const FAILURE = `
local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],120000) end
if n>=5 or ARGV[1]=='429' or ARGV[2]=='1' then redis.call('SET',KEYS[2],'open','PX',300000); return 1 end
return 0`;
export class ProviderLimits {
  constructor(
    private readonly redis: Redis,
    private readonly cache: Redis,
    private readonly now = Date.now,
  ) {}
  async run<T>(
    provider: string,
    quota: { perMinute?: number; perDay?: number },
    operation: () => Promise<T>,
    cost = 1,
  ): Promise<T> {
    z.string()
      .regex(/^[a-z]+$/u)
      .parse(provider);
    z.number().int().positive().parse(cost);
    const breaker = `breaker:${provider}`;
    if (await this.redis.get(breaker)) throw new ProviderError("provider_quota");
    const failed = await this.redis.get(`${breaker}:failed`);
    const lease = randomUUID();
    // Marker lasts beyond OPEN so exactly one worker tests recovery.
    const halfOpen = failed !== null;
    if (halfOpen && !(await this.redis.set(`${breaker}:probe`, lease, "PX", 30_000, "NX")))
      throw new ProviderError("provider_quota", 30_000);
    try {
      const now = this.now();
      const delay = Number(
        await this.redis.eval(
          QUOTA,
          2,
          `quota:${provider}:minute:${Math.floor(now / 60_000)}`,
          `quota:${provider}:day:${Math.floor(now / 86_400_000)}`,
          quota.perMinute ?? 0,
          quota.perDay ?? 0,
          cost,
          60_000 - (now % 60_000),
          86_400_000 - (now % 86_400_000),
        ),
      );
      if (delay !== 0) throw new ProviderError("provider_quota", Math.max(delay, 1000));
      try {
        const result = await operation();
        if (halfOpen) await this.redis.del(`${breaker}:errors`, `${breaker}:failed`);
        return result;
      } catch (error) {
        const opened = await this.redis.eval(
          FAILURE,
          2,
          `${breaker}:errors`,
          breaker,
          error instanceof ProviderError ? String(error.status ?? 0) : "0",
          halfOpen ? "1" : "0",
        );
        if (opened === 1) await this.redis.set(`${breaker}:failed`, "1", "PX", 600_000);
        throw error;
      }
    } finally {
      if (halfOpen) await this.redis.eval(RELEASE, 1, `${breaker}:probe`, lease);
    }
  }
  async singleFlight<T>(key: string, work: () => Promise<T>): Promise<T> {
    z.string()
      .regex(/^[a-zA-Z0-9:_-]{1,200}$/u)
      .parse(key);
    const lock = `inflight:${key}`;
    const lease = randomUUID();
    if (!(await this.cache.set(lock, lease, "PX", 30_000, "NX")))
      throw new ProviderError("provider_quota", 1000);
    try {
      return await work();
    } finally {
      await this.cache.eval(RELEASE, 1, lock, lease);
    }
  }
}
