import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { connectStream } from "../src/sse/transport.ts";

let streams, requests, doc, win, client;
const options = () => ({
  frame: vi.fn(async () => {}),
  state: vi.fn(),
  unauthorized: vi.fn(),
  resume: vi.fn(),
  fetcher: vi.fn(async (_, init) => {
    requests.push(init);
    const body = new ReadableStream({
      start(c) {
        streams.push(c);
        init.signal.addEventListener("abort", () =>
          c.error(new DOMException("aborted", "AbortError")),
        );
      },
    });
    return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
  }),
});
beforeEach(() => {
  vi.useFakeTimers();
  streams = [];
  requests = [];
  doc = Object.assign(new EventTarget(), { hidden: false });
  win = new EventTarget();
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", win);
  vi.stubGlobal("navigator", { onLine: true });
});
afterEach(() => {
  client?.stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const flush = () => vi.advanceTimersByTimeAsync(0);
const send = (text) => streams.at(-1).enqueue(new TextEncoder().encode(text));
test.each([401, 403])("HTTP %s ends without retry", async (status) => {
  const o = options();
  o.fetcher.mockResolvedValue(new Response(null, { status }));
  client = connectStream(o);
  await flush();
  await vi.advanceTimersByTimeAsync(600000);
  expect(o.fetcher).toHaveBeenCalledTimes(1);
  expect(o.unauthorized).toHaveBeenCalledTimes(1);
});
test("reconnect sends Last-Event-ID; pause/resume and replacement keep one live request", async () => {
  const o = options();
  client = connectStream(o);
  await flush();
  send("id: 123-0\nevent: ready\ndata: {}\n\n");
  await flush();
  streams.at(-1).close();
  await vi.advanceTimersByTimeAsync(5000);
  expect(requests).toHaveLength(2);
  expect(requests[1].headers["Last-Event-ID"]).toBe("123-0");
  client.pause(true);
  await flush();
  expect(requests[1].signal.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(600000);
  expect(requests).toHaveLength(2);
  client.pause(false);
  await flush();
  expect(requests).toHaveLength(3);
  client = connectStream(o);
  await flush();
  expect(requests[2].signal.aborted).toBe(true);
  expect(requests.filter((r) => !r.signal.aborted)).toHaveLength(1);
});
test("hidden tab pauses after five minutes and refreshes on return; logout stops timers", async () => {
  const o = options();
  client = connectStream(o);
  await flush();
  doc.hidden = true;
  doc.dispatchEvent(new Event("visibilitychange"));
  for (let i = 0; i < 5; i++) {
    send(": heartbeat\n\n");
    await vi.advanceTimersByTimeAsync(59000);
  }
  expect(requests[0].signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(5000);
  expect(requests[0].signal.aborted).toBe(true);
  doc.hidden = false;
  doc.dispatchEvent(new Event("visibilitychange"));
  await flush();
  expect(o.resume).toHaveBeenCalled();
  expect(requests).toHaveLength(2);
  client.stop();
  await vi.advanceTimersByTimeAsync(600000);
  expect(requests).toHaveLength(2);
  expect(requests[1].signal.aborted).toBe(true);
});
test("Retry-After is respected and stale aborted responses cannot redirect", async () => {
  const o = options();
  o.fetcher.mockResolvedValueOnce(
    new Response(null, { status: 429, headers: { "Retry-After": "120" } }),
  );
  client = connectStream(o);
  await flush();
  await vi.advanceTimersByTimeAsync(119999);
  expect(o.fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(o.fetcher).toHaveBeenCalledTimes(2);
  client.stop();
  let resolve;
  o.fetcher.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  client = connectStream(o);
  client.pause(true);
  resolve(new Response(null, { status: 401 }));
  await flush();
  expect(o.unauthorized).not.toHaveBeenCalled();
});
