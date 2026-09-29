import "server-only";
import { loadConfig } from "@oliginvest/config";
import { headers } from "next/headers";
import createClient from "openapi-fetch";
import { cache } from "react";
import { z } from "zod";
import type { paths } from "./schema";

export const getApiClient = cache(async () => {
  const mode = z.enum(["development", "test", "production"]).parse(process.env.NODE_ENV);
  const config = loadConfig("web", process.env, { mode });
  const origin = new URL(config.API_INTERNAL_URL).origin;
  const incoming = await headers();
  const forwarded = new Headers();
  for (const name of ["cookie", "x-request-id", "accept-language"]) {
    const value = incoming.get(name);
    if (value) forwarded.set(name, value);
  }
  return createClient<paths>({
    baseUrl: `${origin}/api/v1`,
    fetch: async (request) => {
      const url = new URL(request.url);
      if (
        url.origin !== origin ||
        !url.pathname.startsWith("/api/v1/") ||
        url.username ||
        url.password
      )
        throw new Error("API boundary violation");
      const outgoing = new Headers(request.headers);
      for (const name of ["cookie", "x-request-id", "accept-language"]) {
        outgoing.delete(name);
        const value = forwarded.get(name);
        if (value) outgoing.set(name, value);
      }
      return fetch(
        new Request(request, {
          headers: outgoing,
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(5000)]),
        }),
      );
    },
  });
});

const healthSchema = z
  .object({
    status: z.enum(["ok", "fail"]),
    checks: z.record(z.string(), z.enum(["ok", "fail"])).optional(),
  })
  .strict();

export const getHealthStatus = cache(async () => {
  try {
    const client = await getApiClient();
    const { data, response } = await client.GET("/health/live");
    if (!response.ok) return "unavailable";
    return healthSchema.parse(data).status;
  } catch {
    return "unavailable";
  }
});
