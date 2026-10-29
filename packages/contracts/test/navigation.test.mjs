import { describe, expect, it } from "vitest";
import { safeReturnTo } from "../src/navigation.ts";

describe("relative notification destinations", () => {
  it.each([
    "https://evil.test",
    "//evil.test",
    "/\\evil.test",
    "/%2f%2fevil.test",
    "/%255cevil.test",
    "/api/v1/me",
    "/auth/action",
    "/a/../api/auth/sign-out",
    "/logowanie?returnTo=/",
    "/%61pi/v1/me",
    "/\n/evil.test",
    null,
    {},
  ])("rejects %j", (path) => expect(safeReturnTo(path)).toBe("/"));
  it.each(["/rynek/123", "/portfel/rachunki/123", "/?sekcja=wynik-dnia", "/ustawienia"])(
    "preserves %s",
    (path) => expect(safeReturnTo(path)).toBe(path),
  );
});
