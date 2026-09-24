import { readFileSync } from "node:fs";

export const VECTOR_KEYS = [
  "A_fifo_fx",
  "B_twr_xirr",
  "C_drawdown",
  "D_risk",
  "E_indicators_talib",
  "F_day_change",
  "G_dividend",
  "H_rebalance",
] as const;

export type VectorKey = (typeof VECTOR_KEYS)[number];
export type VectorValue = string | number | null | VectorValue[] | VectorObject;
export type VectorObject = { [key: string]: VectorValue };
export type TestVectors = Record<VectorKey | "_meta", VectorObject>;

/** obliczenia-finansowe.md § 0.5; no rounding or calculations in the loader. */
export const TOLERANCES = Object.freeze({
  settlementAmount: "0",
  returnsRelative: 1e-9,
  xirrAbsolute: 1e-6,
  riskMetrics: 1e-6,
  indicators: 1e-8,
});

export function readDecimalText(value: unknown): string {
  if (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value)) {
    throw new TypeError("Expected decimal text; floating-point amounts are forbidden");
  }
  return value;
}

export function readStatistic(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError("Expected a numeric statistic; decimal text must not become a float");
  }
  return value;
}

function validateValue(value: unknown, path: string): asserts value is VectorValue {
  if (typeof value === "number") {
    if (!/^(C_drawdown|D_risk|E_indicators_talib)\./.test(path) && path !== "B_twr_xirr.days") {
      throw new TypeError(`Expected text at ${path}; floating-point amounts are forbidden`);
    }
    readStatistic(value);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => {
      validateValue(item, `${path}.${index}`);
    });
  } else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) validateValue(item, `${path}.${key}`);
  } else if (value !== null && typeof value !== "string") {
    throw new TypeError(`Invalid reference value at ${path}`);
  }
}

export function loadTestVectors(): TestVectors {
  const data: unknown = JSON.parse(
    readFileSync(new URL("../../../docs/03-dane/wektory-testowe.json", import.meta.url), "utf8"),
  );
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new TypeError("Expected reference vector object");
  }
  const expected = ["_meta", ...VECTOR_KEYS];
  if (Object.keys(data).length !== expected.length || expected.some((key) => !(key in data))) {
    throw new TypeError("Expected metadata and exactly vectors A–H");
  }
  for (const [key, value] of Object.entries(data)) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError(`Expected object at ${key}`);
    }
    validateValue(value, key);
  }
  return data as TestVectors;
}
