import { z } from "zod";
import {
  type Capability,
  type DataProvider,
  ProviderError,
  type Quote,
  quoteSchema,
} from "./contracts.js";

export class ProviderRegistry {
  readonly providers: DataProvider[] = [];
  register(provider: DataProvider): void {
    if (this.providers.some((item) => item.meta.id === provider.meta.id))
      throw new Error("Duplicate provider");
    const methods = {
      eodBars: "getEodBars",
      intradayQuote: "getIntradayQuotes",
      fxRate: "getFxRate",
      symbolSearch: "searchSymbols",
    } as const;
    for (const capability of provider.meta.capabilities)
      if (typeof provider[methods[capability]] !== "function")
        throw new Error("Missing provider capability");
    this.providers.push(provider);
  }
  select(capability: Capability, market: string): DataProvider[] {
    return this.providers.filter(
      ({ meta }) =>
        meta.capabilities.includes(capability) &&
        (meta.markets.includes(market) || meta.markets.includes("*")),
    );
  }
  // Only workers call this method. REST reads the persisted result, never providers.
  async quotes(market: string, ids: string[], lastKnown: () => Promise<Quote[]>): Promise<Quote[]> {
    z.array(z.uuid()).max(100).parse(ids);
    const results = new Map<string, Quote>();
    let reason: "provider_disabled" | "provider_error" | "provider_quota" = "provider_disabled";
    for (const provider of this.select("intradayQuote", market)) {
      try {
        const missing = ids.filter((id) => !results.has(id));
        if (!missing.length) break;
        for (const value of z
          .array(quoteSchema)
          .parse(await provider.getIntradayQuotes?.(missing))) {
          if (missing.includes(value.instrumentId)) results.set(value.instrumentId, value);
        }
      } catch (error) {
        reason =
          error instanceof ProviderError && error.reason === "provider_quota"
            ? "provider_quota"
            : "provider_error";
      }
    }
    for (const value of z.array(quoteSchema).parse(await lastKnown())) {
      if (!ids.includes(value.instrumentId) || results.has(value.instrumentId)) continue;
      results.set(value.instrumentId, {
        ...value,
        meta: {
          ...value.meta,
          stale: true,
          staleReason:
            value.meta.source === "gpw" || value.meta.source === "stooq_manual"
              ? "eod_only"
              : reason,
        },
      });
    }
    return ids.flatMap((id) => {
      const value = results.get(id);
      return value ? [value] : [];
    });
  }
}
