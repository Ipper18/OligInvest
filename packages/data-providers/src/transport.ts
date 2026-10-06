import { Decimal } from "@oliginvest/core";
import { ProviderError } from "./contracts.js";

/** Node 24 JSON reviver context retains the original decimal token, including exponent notation. */
export function parseDecimalJson(text: string): unknown {
  return JSON.parse(text, ((_key: string, value: unknown, context: { source?: string }) => {
    if (typeof value !== "number") return value;
    if (!context?.source) throw new Error("Lossless JSON parsing requires Node 24");
    return new Decimal(context.source).toFixed();
  }) as (key: string, value: unknown) => unknown);
}
const HOSTS = new Set([
  "api.nbp.pl",
  "api.frankfurter.dev",
  "www.gpw.pl",
  "query1.finance.yahoo.com",
  "query2.finance.yahoo.com",
  "fc.yahoo.com",
]);
export function createProviderFetch(
  userAgent: string,
  transport: typeof fetch = fetch,
): typeof fetch {
  if (!/^OligInvest\/[\w.-]+ \(\+https:\/\/[^\s)]+\)$/u.test(userAgent))
    throw new Error("Identifying User-Agent required");
  return async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    if (
      url.protocol !== "https:" ||
      !HOSTS.has(url.hostname) ||
      url.port ||
      url.username ||
      url.password
    )
      throw new ProviderError("provider_disabled");
    const response = await transport(input, {
      ...init,
      headers: { ...Object.fromEntries(new Headers(init?.headers)), "User-Agent": userAgent },
      redirect: "error",
      signal: init?.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(15_000)])
        : AbortSignal.timeout(15_000),
    });
    if (!response.ok)
      throw new ProviderError(
        response.status === 429 ? "provider_quota" : "provider_error",
        300_000,
        response.status,
      );
    return response;
  };
}
export async function limitedText(response: Response, maxBytes = 2_000_000): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new ProviderError("no_data");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new ProviderError("provider_error");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks).toString("utf8");
}
