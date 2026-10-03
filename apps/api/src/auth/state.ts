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
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, seconds * 2);
    if (count > maximum) throw new ProblemError("RATE_LIMITED", { retryAfterSeconds: seconds });
  }
  async failures(email: string): Promise<number> {
    return Number((await this.redis.get(`auth:failures:${digest(email)}`)) ?? 0);
  }
  async failed(email: string): Promise<void> {
    const key = `auth:failures:${digest(email)}`;
    await this.redis.multi().incr(key).expire(key, 3600).exec();
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
