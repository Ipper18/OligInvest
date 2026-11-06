// Non-critical shell work (realtime validation chunk, SSE connection and the refetch it
// triggers) starts only after the first contentful paint has been presented, so it never
// competes with the first render for the network or the main thread
// (docs/04-frontend/wydajnosc.md § 5). Without Paint Timing support it starts at once;
// a document that never paints (hidden tab) starts after `fallbackMs`.
export const FIRST_PAINT_FALLBACK_MS = 3000;

export function afterFirstPaint(run: () => void, fallbackMs = FIRST_PAINT_FALLBACK_MS) {
  let pending = true;
  let observer: PerformanceObserver | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    pending = false;
    observer?.disconnect();
    if (timer !== undefined) clearTimeout(timer);
  };
  const start = () => {
    if (!pending) return;
    cancel();
    run();
  };
  if (
    typeof PerformanceObserver === "undefined" ||
    !PerformanceObserver.supportedEntryTypes?.includes("paint")
  ) {
    start();
    return cancel;
  }
  timer = setTimeout(start, fallbackMs);
  observer = new PerformanceObserver((list) => {
    if (list.getEntriesByName("first-contentful-paint").length) start();
  });
  // `buffered` replays an FCP that was presented before hydration.
  observer.observe({ type: "paint", buffered: true });
  return cancel;
}
