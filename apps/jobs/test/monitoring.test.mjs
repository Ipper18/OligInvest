import { expect, test } from "vitest";
import { errorGroup, reportDay, reportText } from "../dist/monitoring.js";

test("daily reports group symbolic errors and reject private payloads and injected text", () => {
  const event = {
    source: "api",
    operation: "/api/v1/portfolio/accounts/:id",
    code: "INTERNAL",
    occurredAt: "2026-10-15T00:00:00.000Z",
  };
  const { key } = errorGroup(event);
  expect(() => errorGroup({ ...event, amount: "12345" })).toThrow();
  expect(() => errorGroup({ ...event, code: "secret\nmessage" })).toThrow();
  expect(reportText("2026-10-15", { [key]: "2" }, {})).toContain(`${key.replaceAll("|", " ")}: 2`);
  expect(() => reportText("2026-10-15", { [key]: "not-a-count" }, {})).toThrow();
  expect(reportDay(Date.parse("2026-10-15T05:00:00Z"))).toBe("2026-10-14");
  expect(reportText("2026-10-15", {}, {})).toContain("Brak zarejestrowanych błędów");
});
