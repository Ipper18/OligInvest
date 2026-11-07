// Non-critical shell work (realtime validation chunk, SSE connection and the refetch it
// triggers) starts only after the route content has been painted, so it never competes with
// the first render for the network or the main thread (docs/04-frontend/wydajnosc.md § 5).
// "Painted" means: the first contentful paint has been presented and no route loading
// fallback is left in the document. React reveals streamed content no earlier than 300 ms
// after the first frame, so FCP alone may show only the skeleton. Without Paint Timing only
// the fallback is awaited; a document that never gets there (hidden tab, hanging route)
// starts after `fallbackMs`.
export const FIRST_PAINT_FALLBACK_MS = 3000;
export const LOADING_FALLBACK_SELECTOR = "[data-loading-fallback]";

export function afterFirstPaint(run: () => void, fallbackMs = FIRST_PAINT_FALLBACK_MS) {
  let pending = true;
  let paints: PerformanceObserver | undefined;
  let mutations: MutationObserver | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    pending = false;
    paints?.disconnect();
    mutations?.disconnect();
    if (timer !== undefined) clearTimeout(timer);
  };
  const start = () => {
    if (!pending) return;
    cancel();
    run();
  };
  const loading = () => document.querySelector(LOADING_FALLBACK_SELECTOR) !== null;
  const afterContent = () => {
    if (!pending) return;
    paints?.disconnect();
    if (typeof document === "undefined" || !loading()) return start();
    mutations = new MutationObserver(() => {
      if (!loading()) start();
    });
    mutations.observe(document.body, { childList: true, subtree: true });
  };
  timer = setTimeout(start, fallbackMs);
  if (
    typeof PerformanceObserver === "undefined" ||
    !PerformanceObserver.supportedEntryTypes?.includes("paint")
  ) {
    afterContent();
    return cancel;
  }
  paints = new PerformanceObserver((list) => {
    if (list.getEntriesByName("first-contentful-paint").length) afterContent();
  });
  // `buffered` replays an FCP that was presented before hydration.
  paints.observe({ type: "paint", buffered: true });
  return cancel;
}
