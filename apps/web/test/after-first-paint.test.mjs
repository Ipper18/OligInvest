import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { afterFirstPaint, FIRST_PAINT_FALLBACK_MS } from "../src/shell/after-first-paint.ts";

let observers;
class FakeObserver {
  static supportedEntryTypes = ["paint", "largest-contentful-paint"];
  constructor(callback) {
    this.callback = callback;
    this.disconnected = false;
    observers.push(this);
  }
  observe(options) {
    this.options = options;
  }
  disconnect() {
    this.disconnected = true;
  }
  emit(...names) {
    const entries = names.map((name) => ({ name, entryType: "paint" }));
    this.callback({ getEntriesByName: (name) => entries.filter((e) => e.name === name) });
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  observers = [];
  vi.stubGlobal("PerformanceObserver", FakeObserver);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("waits for the presented first contentful paint, replaying buffered entries", () => {
  const run = vi.fn();
  afterFirstPaint(run);
  expect(observers[0].options).toEqual({ type: "paint", buffered: true });
  observers[0].emit("first-paint");
  expect(run).not.toHaveBeenCalled();
  observers[0].emit("first-paint", "first-contentful-paint");
  observers[0].emit("first-contentful-paint");
  vi.advanceTimersByTime(FIRST_PAINT_FALLBACK_MS);
  expect(run).toHaveBeenCalledTimes(1);
  expect(observers[0].disconnected).toBe(true);
});

test("a document that never paints (hidden tab) starts after the fallback, once", () => {
  const run = vi.fn();
  afterFirstPaint(run, 500);
  vi.advanceTimersByTime(499);
  expect(run).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  observers[0].emit("first-contentful-paint");
  expect(run).toHaveBeenCalledTimes(1);
  expect(observers[0].disconnected).toBe(true);
});

test("cancel before the paint (unmount, logout) never starts the work", () => {
  const run = vi.fn();
  const cancel = afterFirstPaint(run);
  cancel();
  observers[0].emit("first-contentful-paint");
  vi.advanceTimersByTime(FIRST_PAINT_FALLBACK_MS);
  expect(run).not.toHaveBeenCalled();
  expect(observers[0].disconnected).toBe(true);
});

test.each([
  ["without PerformanceObserver", undefined],
  [
    "without Paint Timing",
    class extends FakeObserver {
      static supportedEntryTypes = ["navigation"];
    },
  ],
])("starts immediately %s (previous behaviour)", (_, observer) => {
  vi.stubGlobal("PerformanceObserver", observer);
  const run = vi.fn();
  afterFirstPaint(run);
  expect(run).toHaveBeenCalledTimes(1);
  expect(observers).toHaveLength(0);
});
