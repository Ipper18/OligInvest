import { readFileSync } from "node:fs";
import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { parsePosition, positionSchema } from "../src/contracts.js";

const accountId = "0198a000-0000-7000-8000-000000000001";
const position = {
  instrument: {
    id: "0198a000-0000-7000-8000-000000000002",
    ticker: "TEST",
    name: "Instrument testowy",
    mic: "XWAR",
    currency: "PLN",
    type: "stock",
    isActive: true,
  },
  quantity: "2",
  costBasis: null,
  marketValue: { amount: "40", currency: "PLN" },
  marketValueBase: { amount: "40", currency: "PLN" },
  weight: 1,
  unrealizedPl: null,
  meta: { source: "gpw", asOf: "2026-10-12T15:00:00Z", delayMinutes: 0, stale: false },
};

describe("Position grouping contract (BL-147)", () => {
  test("account_instrument requires an account without replacing unknown cost", () => {
    expect(() => parsePosition(position, "account_instrument")).toThrow();
    expect(parsePosition({ ...position, accountId }, "account_instrument")).toEqual({
      ...position,
      accountId,
    });
  });
  test("instrument forbids an account rather than silently removing or inventing one", () => {
    const result = parsePosition(position, "instrument");
    expect(result).toEqual(position);
    expect(Object.hasOwn(result, "accountId")).toBe(false);
    for (const value of [accountId, null, undefined])
      expect(() => parsePosition({ ...position, accountId: value }, "instrument")).toThrow();
  });
  test("rejects unknown fields, invalid grouping and numeric money", () => {
    expect(() => parsePosition({ ...position, userId: accountId }, "instrument")).toThrow();
    expect(() => parsePosition(position, "other")).toThrow();
    expect(() =>
      parsePosition({ ...position, costBasis: { amount: 0, currency: "PLN" } }, "instrument"),
    ).toThrow();
  });
  test("source and generated Position agree on optional accountId and required fields", () => {
    const source = parse(
      readFileSync(new URL("../../../docs/02-api/openapi.yaml", import.meta.url), "utf8"),
    );
    const app = new OpenAPIHono();
    app.openAPIRegistry.register("Position", positionSchema);
    const generated = app.getOpenAPI31Document({
      openapi: "3.1.0",
      info: { title: "contract", version: "1" },
    }).components.schemas.Position;
    expect(generated.required.toSorted()).toEqual(
      source.components.schemas.Position.required.toSorted(),
    );
    expect(generated.required).not.toContain("accountId");
    expect(Object.keys(generated.properties).toSorted()).toEqual(
      Object.keys(source.components.schemas.Position.properties).toSorted(),
    );
    expect(source.components.schemas.Position.properties.accountId.description).toContain(
      "Wymagane przy groupBy=account_instrument",
    );
    expect(source.components.schemas.Position.properties.accountId.description).toContain(
      "nie występuje przy groupBy=instrument",
    );
  });
});
