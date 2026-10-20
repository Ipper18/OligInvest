"use server";
import * as z from "zod";
import { requireMe } from "../auth/session";
import {
  accountInput,
  accountPatch,
  accountSchema,
  importBatchSchema,
  importCommitSchema,
  importRowSchema,
  importUploadSchema,
  resolutionSchema,
  transactionInput,
  transactionPatch,
  transactionSchema,
} from "../modules";
import { DomainError, domainRequest } from "./resources";

export async function mutateResource(raw: unknown) {
  await requireMe();
  try {
    const input = z
      .object({
        kind: z.enum(["account", "transaction", "import", "row", "commit"]),
        method: z.enum(["POST", "PATCH", "DELETE"]),
        id: z.uuid().optional(),
        rowId: z.uuid().optional(),
        key: z.uuid(),
        body: z.unknown().optional(),
      })
      .strict()
      .parse(raw);
    let path: string;
    let body: unknown;
    if (input.kind === "account" || input.kind === "transaction") {
      path = `/portfolio/${input.kind === "account" ? "accounts" : "transactions"}`;
      if (input.method !== "POST") path += `/${z.uuid().parse(input.id)}`;
      if (input.method !== "DELETE")
        body = (
          input.kind === "account"
            ? input.method === "POST"
              ? accountInput
              : accountPatch
            : input.method === "POST"
              ? transactionInput
              : transactionPatch
        ).parse(input.body);
    } else {
      path = `/portfolio/imports/${z.uuid().parse(input.id)}`;
      if (input.kind === "commit" && input.method === "POST") {
        path += "/commit";
        body = importCommitSchema.parse(input.body);
      } else if (input.kind === "row" && input.method === "PATCH") {
        path += `/rows/${z.uuid().parse(input.rowId)}`;
        body = resolutionSchema.parse(input.body);
      } else if (input.kind !== "import" || input.method !== "DELETE")
        throw new Error("INVALID_MUTATION");
    }
    const result = await domainRequest(path, {
      method: input.method,
      headers: { "Content-Type": "application/json", "Idempotency-Key": input.key },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (input.method !== "DELETE") {
      const schema =
        input.kind === "account"
          ? accountSchema
          : input.kind === "transaction"
            ? transactionSchema
            : input.kind === "row"
              ? importRowSchema
              : importBatchSchema;
      schema.parse(result);
    }
    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      code:
        error instanceof DomainError
          ? error.code
          : error instanceof z.ZodError
            ? "VALIDATION_FAILED"
            : "SERVICE_UNAVAILABLE",
      requestId: error instanceof DomainError ? error.requestId : "",
      fields:
        error instanceof DomainError
          ? error.fields.map((f) => f.path)
          : error instanceof z.ZodError
            ? error.issues.map((i) => i.path.join("."))
            : [],
    };
  }
}
export async function uploadFile(form: FormData) {
  await requireMe();
  try {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0 || file.size > 10 * 1024 * 1024)
      throw new DomainError("FILE_TOO_LARGE", "");
    const fields = importUploadSchema
      .omit({ file: true })
      .parse({ accountId: form.get("accountId"), source: form.get("source") });
    const key = z.uuid().parse(form.get("key"));
    const outgoing = new FormData();
    outgoing.set("file", file);
    outgoing.set("accountId", fields.accountId);
    outgoing.set("source", fields.source);
    const batch = importBatchSchema.parse(
      await domainRequest("/portfolio/imports", {
        method: "POST",
        body: outgoing,
        headers: { "Idempotency-Key": key },
      }),
    );
    return { ok: true as const, id: batch.id };
  } catch (error) {
    return {
      ok: false as const,
      code: error instanceof DomainError ? error.code : "VALIDATION_FAILED",
      requestId: error instanceof DomainError ? error.requestId : "",
    };
  }
}
