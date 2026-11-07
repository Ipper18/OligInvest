import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  afterFirstPaint,
  FIRST_PAINT_FALLBACK_MS,
  LOADING_FALLBACK_SELECTOR,
} from "../src/shell/after-first-paint.ts";

let observers, mutationObservers, fallback;
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
class FakeMutationObserver {
  constructor(callback) {
    this.callback = callback;
    this.disconnected = false;
    mutationObservers.push(this);
  }
  observe(target, options) {
    this.target = target;
    this.options = options;
  }
  disconnect() {
    this.disconnected = true;
  }
  mutate() {
    if (!this.disconnected) this.callback([]);
  }
}
const body = {};
beforeEach(() => {
  vi.useFakeTimers();
  observers = [];
  mutationObservers = [];
  fallback = false;
  vi.stubGlobal("PerformanceObserver", FakeObserver);
  vi.stubGlobal("MutationObserver", FakeMutationObserver);
  vi.stubGlobal("document", {
    body,
    querySelector: (selector) =>
      selector === LOADING_FALLBACK_SELECTOR && fallback ? { selector } : null,
  });
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
  expect(mutationObservers).toHaveLength(0);
});

test("a first paint of the loading fallback waits until the streamed content replaces it", () => {
  const run = vi.fn();
  fallback = true;
  afterFirstPaint(run);
  observers[0].emit("first-contentful-paint");
  expect(observers[0].disconnected).toBe(true);
  expect(mutationObservers[0].target).toBe(body);
  expect(mutationObservers[0].options).toEqual({ childList: true, subtree: true });
  mutationObservers[0].mutate();
  expect(run).not.toHaveBeenCalled();
  fallback = false;
  mutationObservers[0].mutate();
  mutationObservers[0].mutate();
  vi.advanceTimersByTime(FIRST_PAINT_FALLBACK_MS);
  expect(run).toHaveBeenCalledTimes(1);
  expect(mutationObservers[0].disconnected).toBe(true);
});

test.each([
  ["a document that never paints (hidden tab)", false],
  ["a route that keeps its loading fallback", true],
])("%s starts after the fallback timer, once", (_, keepFallback) => {
  const run = vi.fn();
  afterFirstPaint(run, 500);
  if (keepFallback) {
    fallback = true;
    observers[0].emit("first-contentful-paint");
  }
  vi.advanceTimersByTime(499);
  expect(run).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  observers[0].emit("first-contentful-paint");
  mutationObservers[0]?.mutate();
  expect(run).toHaveBeenCalledTimes(1);
  expect(observers[0].disconnected).toBe(true);
  if (keepFallback) expect(mutationObservers[0].disconnected).toBe(true);
});

test("cancel (unmount, logout) never starts the work, before or after the paint", () => {
  const run = vi.fn();
  afterFirstPaint(run)();
  observers[0].emit("first-contentful-paint");
  fallback = true;
  const cancel = afterFirstPaint(run);
  observers[1].emit("first-contentful-paint");
  cancel();
  fallback = false;
  mutationObservers[0].mutate();
  vi.advanceTimersByTime(FIRST_PAINT_FALLBACK_MS);
  expect(run).not.toHaveBeenCalled();
  expect(observers.every((observer) => observer.disconnected)).toBe(true);
  expect(mutationObservers[0].disconnected).toBe(true);
});

test.each([
  ["without PerformanceObserver", undefined],
  [
    "without Paint Timing",
    class extends FakeObserver {
      static supportedEntryTypes = ["navigation"];
    },
  ],
])("%s only the loading fallback is awaited", (_, observer) => {
  vi.stubGlobal("PerformanceObserver", observer);
  const run = vi.fn();
  afterFirstPaint(run);
  expect(run).toHaveBeenCalledTimes(1);
  fallback = true;
  afterFirstPaint(run);
  expect(run).toHaveBeenCalledTimes(1);
  fallback = false;
  mutationObservers[0].mutate();
  expect(run).toHaveBeenCalledTimes(2);
  expect(observers).toHaveLength(0);
});

test("outside a document it starts at once", () => {
  vi.stubGlobal("document", undefined);
  vi.stubGlobal("PerformanceObserver", undefined);
  const run = vi.fn();
  afterFirstPaint(run);
  expect(run).toHaveBeenCalledTimes(1);
});
