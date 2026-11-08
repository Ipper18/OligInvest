import { expect, test } from "vitest";
import { quotaRenewal } from "../src/analytics/renewal";

test.each([
  ["2026-03-28T23:00:00Z", 82800, "2026-03-29T22:00:00.000Z"],
  ["2026-10-24T22:00:00Z", 90000, "2026-10-25T23:00:00.000Z"],
])("quota renewal uses server time across DST: %s", (date, seconds, expected) => {
  expect(
    quotaRenewal(
      new Headers({ Date: new Date(date).toUTCString(), "Retry-After": String(seconds) }),
      0,
    ),
  ).toBe(expected);
  expect(
    new Intl.DateTimeFormat("pl-PL", {
      timeZone: "Europe/Warsaw",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(expected)),
  ).toBe("00:00");
});
test("missing or malformed renewal is not invented", () => {
  for (const value of ["", "NaN", "-1", "0", "1.5", "90001"])
    expect(quotaRenewal(new Headers({ "Retry-After": value }))).toBeUndefined();
});
