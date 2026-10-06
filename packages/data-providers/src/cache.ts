import { z } from "zod";

export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "PX", ttl: number): Promise<unknown>;
}
export class MarketCache<T> {
  private readonly entries = new Map<string, { value: T; until: number }>();
  private readonly flights = new Map<string, Promise<T>>();
  constructor(
    private readonly store: CacheStore,
    private readonly schema: z.ZodType<T>,
    private readonly now = Date.now,
  ) {}
  async read(
    userId: string,
    key: string,
    database: () => Promise<T>,
    l1Ms: number,
    l2Ms: number,
  ): Promise<T> {
    z.uuid().parse(userId);
    z.string()
      .regex(/^[a-zA-Z0-9:_-]{1,200}$/u)
      .parse(key);
    const scoped = `u:${userId}:${key}`;
    const cached = this.entries.get(scoped);
    if (cached && cached.until > this.now()) return structuredClone(cached.value);
    const flight = this.flights.get(scoped);
    if (flight) return structuredClone(await flight);
    const pending = (async () => {
      let value: T | undefined;
      try {
        const text = await this.store.get(scoped);
        if (text) value = this.schema.parse(JSON.parse(text));
      } catch {
        /* Disposable L2: malformed values and outages fall back to SQL. */
      }
      if (value === undefined) {
        value = this.schema.parse(await database());
        try {
          await this.store.set(scoped, JSON.stringify(value), "PX", l2Ms);
        } catch {
          /* SQL remains available. */
        }
      }
      if (this.entries.size >= 512) {
        const first = this.entries.keys().next().value;
        if (first) this.entries.delete(first);
      }
      this.entries.set(scoped, { value: structuredClone(value), until: this.now() + l1Ms });
      return value;
    })();
    this.flights.set(scoped, pending);
    try {
      return structuredClone(await pending);
    } finally {
      this.flights.delete(scoped);
    }
  }
  clear(): void {
    this.entries.clear();
  }
}
