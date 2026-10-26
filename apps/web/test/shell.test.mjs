import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { gatePath, safeReturnTo } from "../src/auth/navigation.ts";
import { connectionStatus } from "../src/shell/connection-status.ts";
import { parseStream, retryDelay } from "../src/sse/transport.ts";
import uiModules from "../src/ui-modules.json" with { type: "json" };

test("return locations cannot escape this origin or enter auth redirect loops", () => {
  for (const value of [
    "https://bad.test",
    "//bad.test",
    "/\\bad.test",
    "/logowanie",
    "/api/auth/sign-out",
    undefined,
  ])
    expect(safeReturnTo(value)).toBe("/");
  expect(safeReturnTo("/portfel?accountId=demo")).toBe("/portfel?accountId=demo");
});
test("MFA and legal gates are ordered before private content", () => {
  expect(gatePath(null)).toBe("/logowanie");
  expect(gatePath({ mfa: { enrolled: false }, legal: { termsAcceptanceRequired: true } })).toBe(
    "/konfiguracja-2fa",
  );
  expect(gatePath({ mfa: { enrolled: true }, legal: { termsAcceptanceRequired: true } })).toBe(
    "/logowanie/2fa",
  );
  expect(
    gatePath({
      mfa: { enrolled: true, sessionVerifiedAt: "2026-10-11T12:00:00Z" },
      legal: { termsAcceptanceRequired: true },
    }),
  ).toBe("/akceptacja-regulaminu");
});
test("navigation lists only sections that have screens", () => {
  const hrefs = uiModules.flatMap((module) => (module.nav ?? []).map((item) => item.href));
  expect(hrefs).not.toContain("/alerty");
  expect(hrefs).not.toContain("/analizy");
  for (const href of hrefs)
    expect(existsSync(new URL(`../src/app/(app)${href}/page.tsx`, import.meta.url)), href).toBe(
      true,
    );
});
test("connection status never contradicts the pause/resume button", () => {
  // Regression (demo 2026-10-26): "Aktualizacje wstrzymane" next to "Wstrzymaj aktualizacje".
  for (const state of ["live", "polling", "paused", "offline"]) {
    expect(connectionStatus(state, true)).toBe("paused");
    expect(connectionStatus(state, false)).not.toBe("paused");
  }
  expect(connectionStatus("paused", false)).toBe("connecting");
  expect(connectionStatus("live", false)).toBe("live");
});
describe("SSE parser", () => {
  test("arbitrary byte boundaries preserve UTF-8, CRLF and multiline data; partial frames are discarded", async () => {
    const bytes = new TextEncoder().encode(
      ": heartbeat\r\nid: 123-0\revent: sample\rdata: zażółć\ndata: test\n\nretry: 5000\n\nid: 999-0\ndata: unfinished",
    );
    const stream = new ReadableStream({
      start(c) {
        for (const b of bytes) c.enqueue(Uint8Array.of(b));
        c.close();
      },
    });
    const events = [];
    const retries = [];
    await parseStream(
      stream,
      (e) => events.push(e),
      (r) => retries.push(r),
      () => {},
    );
    expect(events).toEqual([{ event: "sample", data: "zażółć\ntest", id: "123-0" }]);
    expect(retries).toEqual([5000]);
  });
  test("backoff grows and remains capped including jitter", () => {
    expect(retryDelay(0, 5000, () => 1)).toBe(5000);
    expect(retryDelay(1, 5000, () => 1)).toBe(10000);
    expect(retryDelay(20, 5000, () => 1)).toBe(60000);
    expect(retryDelay(20, 5000, () => 0)).toBe(30000);
  });
});
