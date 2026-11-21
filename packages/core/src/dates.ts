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

/** Calendar months; the day is clamped to the month's end (2026-03-31 − 1 month = 2026-02-28). */
export function addMonths(date: string, months: number): IsoDate {
  const d = isoDate(date);
  const total = Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1 + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(Number(d.slice(8, 10)), lastDay);
  return fromUtcMs(Date.UTC(year, month, day));
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

/** Easter Sunday (Gregorian, anonymous algorithm) as an ISO date. */
function easterSunday(year: number): IsoDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return isoDate(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
}

/**
 * Statutory public holiday in Poland (ustawa o dniach wolnych od pracy, obliczenia-finansowe.md
 * § 2.2): fixed days, 6 January since 2011, 24 December since 2025, Easter Monday and Corpus Christi
 * (Sundays — Easter, Pentecost — are not business days anyway).
 */
export function isPolishPublicHoliday(date: string): boolean {
  const d = isoDate(date);
  const year = Number(d.slice(0, 4));
  const monthDay = d.slice(5);
  if (["01-01", "05-01", "05-03", "08-15", "11-01", "11-11", "12-25", "12-26"].includes(monthDay))
    return true;
  if (monthDay === "01-06" && year >= 2011) return true;
  if (monthDay === "12-24" && year >= 2025) return true;
  const easter = easterSunday(year);
  return d === addDays(easter, 1) || d === addDays(easter, 60);
}

/** NBP publishes table A on Polish business days: Monday–Friday without public holidays. */
export function isNbpBusinessDay(date: string): boolean {
  return isWeekday(date) && !isPolishPublicHoliday(date);
}

export type SettlementRegion = "US" | "EU";

const US_MICS = ["XNYS", "XNAS", "ARCX", "BATS", "XASE"] as const;
/** Main EU venues (ISO 10383); XLON and SIX are outside the EU — cycle to be set in § 2.2. */
const EU_MICS = [
  "XWAR",
  "XETR",
  "XFRA",
  "XAMS",
  "XPAR",
  "XBRU",
  "XLIS",
  "XDUB",
  "XMIL",
  "XMAD",
  "XWBO",
  "XHEL",
  "XSTO",
  "XCSE",
] as const;

const REGION_BY_MIC: Readonly<Record<string, SettlementRegion>> = Object.fromEntries([
  ...US_MICS.map((mic) => [mic, "US"] as const),
  ...EU_MICS.map((mic) => [mic, "EU"] as const),
]);

/** US and EU venues of obliczenia-finansowe.md § 2.2 (C-21); other MICs need an explicit settle date. */
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
