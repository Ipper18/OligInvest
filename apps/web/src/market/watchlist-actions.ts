"use server";
import { z } from "zod";
import { requireMe } from "../auth/session";
import { watchlistInput, watchlistItemInput, watchlistItemPatch, watchlistPatch } from "../modules";
import { DomainError, domainRequest } from "../portfolio/resources";

const actions = {
  create: { method: "POST", input: watchlistInput },
  update: { method: "PATCH", input: watchlistPatch },
  remove: { method: "DELETE", input: z.object({}).strict() },
  addItem: { method: "POST", input: watchlistItemInput },
  updateItem: { method: "PATCH", input: watchlistItemPatch },
  removeItem: { method: "DELETE", input: z.object({}).strict() },
} as const;
export async function mutateWatchlist(
  action: keyof typeof actions,
  raw: { id?: string; instrumentId?: string; input: unknown; key?: string },
) {
  await requireMe();
  try {
    const args = z
      .object({
        id: z.uuid().optional(),
        instrumentId: z.uuid().optional(),
        input: z.unknown(),
        key: z.uuid().optional(),
      })
      .strict()
      .parse(raw);
    if (!Object.hasOwn(actions, action)) throw new Error("INVALID_ACTION");
    const spec = actions[action];
    const path =
      action === "create"
        ? "/market/watchlists"
        : `/market/watchlists/${z.uuid().parse(args.id)}${action === "addItem" ? "/items" : action === "updateItem" || action === "removeItem" ? `/items/${z.uuid().parse(args.instrumentId)}` : ""}`;
    const input = spec.input.parse(args.input);
    await domainRequest(path, {
      method: spec.method,
      headers: {
        "content-type": "application/json",
        ...(args.key ? { "Idempotency-Key": args.key } : {}),
      },
      ...(spec.method === "DELETE" ? {} : { body: JSON.stringify(input) }),
    });
    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      code: error instanceof DomainError ? error.code : "VALIDATION_FAILED",
      requestId: error instanceof DomainError ? error.requestId : "",
    };
  }
}
