import { createHash } from "node:crypto";
import { ProblemError } from "@oliginvest/platform";
import type { Redis } from "ioredis";

export interface AuthState {
  limit(subject: string, maximum: number, seconds: number): Promise<void>;
  failures(email: string): Promise<number>;
  failed(email: string): Promise<void>;
  succeeded(email: string): Promise<void>;
  consumeStep(userId: string, step: number): Promise<boolean>;
}
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export class RedisAuthState implements AuthState {
  constructor(private readonly redis: Redis) {}
  async limit(subject: string, maximum: number, seconds: number): Promise<void> {
    const window = Math.floor(Date.now() / (seconds * 1000));
    const key = `auth:limit:${digest(subject)}:${seconds}:${window}`;
    const result = await this.redis
      .multi()
      .incr(key)
      .expire(key, seconds * 2)
      .exec();
    if (!result || result.some(([error]) => error) || typeof result[0]?.[1] !== "number")
      throw new Error("AUTH_STATE_UNAVAILABLE");
    const count = result[0][1];
    if (count > maximum) throw new ProblemError("RATE_LIMITED", { retryAfterSeconds: seconds });
  }
  async failures(email: string): Promise<number> {
    return Number((await this.redis.get(`auth:failures:${digest(email)}`)) ?? 0);
  }
  async failed(email: string): Promise<void> {
    const key = `auth:failures:${digest(email)}`;
    const result = await this.redis.multi().incr(key).expire(key, 3600).exec();
    if (!result || result.some(([error]) => error)) throw new Error("AUTH_STATE_UNAVAILABLE");
  }
  async succeeded(email: string): Promise<void> {
    await this.redis.del(`auth:failures:${digest(email)}`);
  }
  async consumeStep(userId: string, step: number): Promise<boolean> {
    // The facade holds the PostgreSQL advisory transaction lock for every MFA
    // operation, across API replicas, until this durable queue-state update ends.
    const key = `auth:totp:${userId}`;
    const previous = await this.redis.get(key);
    if (previous !== null && Number(previous) >= step) return false;
    await this.redis.set(key, String(step), "EX", 120);
    return true;
  }
}
