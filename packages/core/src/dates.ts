import { CoreError } from "./errors.js";

declare const isoDateBrand: unique symbol;
/** Calendar date `YYYY-MM-DD` without time zone (session date or valuation day, ADR-014 § 6). */
export type IsoDate = string & { readonly [isoDateBrand]: true };

const DAY_MS = 86_400_000;

function toUtcMs(date: string): number {
  return Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
  );
}

function fromUtcMs(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10) as IsoDate;
}

export function isoDate(text: string): IsoDate {
  if (
    typeof text !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(text) ||
    fromUtcMs(toUtcMs(text)) !== text
  ) {
    throw new CoreError("invalid_date", "Expected a calendar date YYYY-MM-DD", {
      value: typeof text === "string" ? text : typeof text,
    });
  }
  return text as IsoDate;
}

export function addDays(date: string, days: number): IsoDate {
  return fromUtcMs(toUtcMs(isoDate(date)) + days * DAY_MS);
}

/** Calendar days from `from` to `to` (ACT convention). */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtcMs(isoDate(to)) - toUtcMs(isoDate(from))) / DAY_MS);
}

export function compareIsoDates(a: string, b: string): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Monday–Friday; market holidays come from the caller's calendar. */
export function isWeekday(date: string): boolean {
  const day = new Date(toUtcMs(isoDate(date))).getUTCDay();
  return day !== 0 && day !== 6;
}

export type SettlementRegion = "US" | "EU";

const REGION_BY_MIC: Readonly<Record<string, SettlementRegion>> = {
  XNYS: "US",
  XNAS: "US",
  XWAR: "EU",
  XETR: "EU",
};

/** Only the markets named in obliczenia-finansowe.md § 2.2; other MICs need an explicit settle date. */
export function settlementRegionForMic(mic: string): SettlementRegion | undefined {
  return Object.hasOwn(REGION_BY_MIC, mic) ? REGION_BY_MIC[mic] : undefined;
}

/** USA T+1 from trade date 2024-05-28 (before: T+2); EU T+2, T+1 from 2027-10-11 (EU 2025/2075). */
export function settlementCycleDays(region: SettlementRegion, tradeDate: string): 1 | 2 {
  const switchDate = region === "US" ? "2024-05-28" : "2027-10-11";
  return isoDate(tradeDate) >= switchDate ? 1 : 2;
}

/** Adds `cycleDays` settlement days using the caller's calendar predicate (no I/O, no clock). */
export function settlementDate(
  tradeDate: string,
  cycleDays: number,
  isSettlementDay: (date: IsoDate) => boolean,
): IsoDate {
  if (!Number.isInteger(cycleDays) || cycleDays < 1) {
    throw new CoreError("invalid_settlement", "Settlement cycle must be a positive integer");
  }
  let date = isoDate(tradeDate);
  let remaining = cycleDays;
  for (let step = 0; step < 31; step += 1) {
    date = addDays(date, 1);
    if (isSettlementDay(date)) remaining -= 1;
    if (remaining === 0) return date;
  }
  throw new CoreError("invalid_settlement", "No settlement day within 31 days of the trade", {
    tradeDate,
  });
}
