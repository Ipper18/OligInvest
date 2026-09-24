import {
  addDays,
  compareIsoDates,
  daysBetween,
  isCoreError,
  isoDate,
  isWeekday,
  settlementCycleDays,
  settlementDate,
  settlementRegionForMic,
} from "@oliginvest/core";
import { describe, expect, test } from "vitest";

function codeOf(fn) {
  try {
    fn();
  } catch (error) {
    return isCoreError(error) ? error.code : "not-core-error";
  }
  return "no-error";
}

describe("IsoDate", () => {
  test("accepts real calendar dates only", () => {
    expect(isoDate("2024-02-29")).toBe("2024-02-29");
    for (const bad of ["2025-02-29", "2025-13-01", "2025-1-01", "2025-01-01T00:00:00Z", 20250101]) {
      expect(codeOf(() => isoDate(bad))).toBe("invalid_date");
    }
  });

  test("date arithmetic is calendar based and independent of the system clock", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2025-01-01", -1)).toBe("2024-12-31");
    expect(daysBetween("2025-01-01", "2025-12-31")).toBe(364);
    expect(daysBetween("2025-12-31", "2025-01-01")).toBe(-364);
    expect(compareIsoDates("2025-01-01", "2025-01-02")).toBe(-1);
    expect(compareIsoDates("2025-01-02", "2025-01-02")).toBe(0);
    expect(compareIsoDates("2025-01-03", "2025-01-02")).toBe(1);
    expect(isWeekday("2025-09-05")).toBe(true);
    expect(isWeekday("2025-09-06")).toBe(false);
    expect(isWeekday("2025-09-07")).toBe(false);
  });
});

describe("settlement date (obliczenia-finansowe.md § 2.2, 11-zgodnosc-prawna.md § 5.1)", () => {
  test("USA: T+2 before 2024-05-28, T+1 from that trade date", () => {
    expect(settlementCycleDays("US", "2024-05-24")).toBe(2);
    expect(settlementCycleDays("US", "2024-05-28")).toBe(1);
  });

  test("GPW and other EU markets: T+2 until 2027-10-10, T+1 from 2027-10-11", () => {
    expect(settlementCycleDays("EU", "2027-10-08")).toBe(2);
    expect(settlementCycleDays("EU", "2027-10-11")).toBe(1);
  });

  test("maps only the MICs named in the documentation", () => {
    expect(settlementRegionForMic("XNYS")).toBe("US");
    expect(settlementRegionForMic("XNAS")).toBe("US");
    expect(settlementRegionForMic("XWAR")).toBe("EU");
    expect(settlementRegionForMic("XETR")).toBe("EU");
    expect(settlementRegionForMic("XLON")).toBeUndefined();
  });

  test("counts settlement days with the caller's calendar", () => {
    // Vector A: USA trade on Monday 2025-03-03 settles on 2025-03-04.
    expect(settlementDate("2025-03-03", 1, isWeekday)).toBe("2025-03-04");
    // Friday + 2 business days skips the weekend.
    expect(settlementDate("2025-09-05", 2, isWeekday)).toBe("2025-09-09");
    // A market holiday supplied by the calendar is skipped as well.
    const calendar = (date) => isWeekday(date) && date !== "2025-11-11";
    expect(settlementDate("2025-11-10", 2, calendar)).toBe("2025-11-13");
    expect(codeOf(() => settlementDate("2025-11-10", 0, isWeekday))).toBe("invalid_settlement");
    expect(codeOf(() => settlementDate("2025-11-10", 1, () => false))).toBe("invalid_settlement");
  });
});
