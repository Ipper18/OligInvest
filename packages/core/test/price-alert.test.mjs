import { describe, expect, test } from "vitest";
import { evaluatePriceAlert } from "../src/price-alert.js";

const rule = { type: "price_above", threshold: "100", hysteresis: "0.005", cooldownMinutes: 5 };
const observation = (price, minute, extra = {}) => ({ price, asOf: `2026-10-22T10:${String(minute).padStart(2,"0")}:00Z`, sessionDate: "2026-10-22", stale: false, blocked: false, ...extra });
describe("price alerts", () => {
  test("strict crossing, rearming and cooldown are independent", () => {
    let result = evaluatePriceAlert(rule, observation("100",0));
    expect(result.triggered).toBe(false);
    result = evaluatePriceAlert(rule, observation("100.00000001",1),result.state);
    expect(result.triggered).toBe(true);
    result = evaluatePriceAlert(rule, observation("101",7),result.state);
    expect(result.triggered).toBe(false);
    result = evaluatePriceAlert(rule, observation("99.6",8),result.state);
    expect(result.state.armed).toBe(false);
    result = evaluatePriceAlert(rule, observation("99.5",9),result.state);
    expect(result.state.armed).toBe(true);
    expect(evaluatePriceAlert(rule, observation("101",10),result.state).triggered).toBe(true);
  });
  test("rearmed condition during cooldown fires once after cooldown", () => {
    let result = evaluatePriceAlert(rule,observation("101",0));
    result = evaluatePriceAlert(rule,observation("99",1),result.state);
    result = evaluatePriceAlert(rule,observation("101",2),result.state);
    expect(result.triggered).toBe(false);
    expect(evaluatePriceAlert(rule,observation("101",5),result.state).triggered).toBe(true);
  });
  test.each([{stale:true},{blocked:true}])("unusable data never change state: %o", (flags) => {
    const state = evaluatePriceAlert(rule,observation("101",0)).state;
    expect(evaluatePriceAlert(rule,observation("90",1,flags),state)).toEqual({triggered:false,state});
  });
  test("duplicate and out-of-order observations cannot rearm", () => {
    const state = evaluatePriceAlert(rule,observation("101",5)).state;
    expect(evaluatePriceAlert(rule,observation("90",5),state).state).toEqual(state);
    expect(evaluatePriceAlert(rule,observation("90",4),state).state).toEqual(state);
  });
  test("below threshold uses the upper hysteresis band", () => {
    const below = {...rule,type:"price_below"};
    let result = evaluatePriceAlert(below,observation("99",0));
    expect(result.triggered).toBe(true);
    result = evaluatePriceAlert(below,observation("100.5",5),result.state);
    expect(result.state.armed).toBe(true);
    expect(evaluatePriceAlert(below,observation("99",6),result.state).triggered).toBe(true);
  });
  test.each(["up","down","both"])("daily change %s uses percentage points", (direction) => {
    const r = {...rule,type:"change_pct",threshold:"0.05",direction};
    const price = direction === "down" ? "94" : "106";
    let result = evaluatePriceAlert(r,observation(price,0,{previousClose:"100"}));
    expect(result.triggered).toBe(true);
    result = evaluatePriceAlert(r,observation(direction === "down" ? "95.5":"104.5",5,{previousClose:"100"}),result.state);
    expect(result.state.armed).toBe(true);
    expect(evaluatePriceAlert(r,observation(price,6,{previousClose:"100"}),result.state).triggered).toBe(true);
  });
  test("missing baseline is unavailable and a new session preserves cooldown", () => {
    const r = {...rule,type:"change_pct",threshold:"0.05",direction:"both",cooldownMinutes:10080};
    expect(evaluatePriceAlert(r,observation("106",0)).triggered).toBe(false);
    const state = evaluatePriceAlert(r,observation("106",0,{previousClose:"100"})).state;
    expect(evaluatePriceAlert(r,{...observation("106",0,{previousClose:"100"}),asOf:"2026-10-23T10:00:00Z",sessionDate:"2026-10-23"},state).triggered).toBe(false);
    expect(evaluatePriceAlert(r,observation("106",1,{previousClose:"0"}),state).state).toEqual(state);
  });
});
