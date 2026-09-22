import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  loadTestVectors,
  readDecimalText,
  readStatistic,
  TOLERANCES,
  VECTOR_KEYS,
} from "../src/index.ts";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

describe("reference vectors", () => {
  it("loads all examples and preserves every source value and key", () => {
    const source = JSON.parse(
      readFileSync(new URL("../../../docs/03-dane/wektory-testowe.json", import.meta.url), "utf8"),
    );
    expect(loadTestVectors()).toStrictEqual(source);
    expect(Object.keys(source)).toEqual(["_meta", ...VECTOR_KEYS]);
    expect(VECTOR_KEYS).toHaveLength(8);
  });

  it("returns independent objects", () => {
    const vectors = loadTestVectors();
    vectors.G_dividend.gross_usd = "changed";
    expect(loadTestVectors().G_dividend.gross_usd).toBe("25.00");
  });

  it("rejects a source amount changed to a JSON number", () => {
    const corrupted = loadTestVectors();
    corrupted.G_dividend.gross_usd = 25;
    readFileSync.mockReturnValueOnce(JSON.stringify(corrupted));
    expect(() => loadTestVectors()).toThrow(/G_dividend.gross_usd/);
  });

  it("preserves decimal text including trailing zeros and rejects floating-point reads", () => {
    const vectors = loadTestVectors();
    expect(readDecimalText(vectors.G_dividend.wht_usd)).toBe("3.7500");
    expect(() => readStatistic(vectors.G_dividend.wht_usd)).toThrow(TypeError);
    expect(() => readDecimalText(3.75)).toThrow(TypeError);
    expect(readDecimalText("9007199254740993.00000001")).toBe("9007199254740993.00000001");
    for (const invalid of [null, true, "", "0.54%", "NaN"]) {
      expect(() => readDecimalText(invalid)).toThrow(TypeError);
    }
  });

  it("allows only finite numeric statistics", () => {
    expect(readStatistic(loadTestVectors().D_risk.sharpe_rf0)).toBe(1.885912);
    for (const invalid of [null, true, "1.5", Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => readStatistic(invalid)).toThrow(TypeError);
    }
  });

  it("exposes the tolerances from section 0.5 without applying rounding", () => {
    expect(TOLERANCES).toStrictEqual({
      settlementAmount: "0",
      returnsRelative: 1e-9,
      xirrAbsolute: 1e-6,
      riskMetrics: 1e-6,
      indicators: 1e-8,
    });
  });
});
