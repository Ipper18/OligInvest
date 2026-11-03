import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";

const code = buildSync({
  entryPoints: [fileURLToPath(new URL("../src/pwa/worker.js", import.meta.url))],
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
}).outputFiles[0].text;
function harness() {
  const handlers = {},
    stores = new Map(),
    origin = "https://example.test";
  const url = (input) => (typeof input === "string" ? new URL(input, origin).href : input.url);
  const caches = {
    keys: async () => [...stores.keys()],
    delete: async (key) => stores.delete(key),
    open: async (key) => {
      if (!stores.has(key)) stores.set(key, new Map());
      const store = stores.get(key);
      return {
        put: async (request, response) => store.set(url(request), response),
        match: async (request) => store.get(url(request))?.clone(),
      };
    },
  };
  const window = {
    url: origin + "/",
    navigate: vi.fn(async () => window),
    focus: vi.fn(async () => window),
    postMessage: vi.fn(),
  };
  const self = {
    location: { origin },
    addEventListener: (type, handler) => {
      handlers[type] = handler;
    },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(), matchAll: async () => [window], openWindow: vi.fn() },
    registration: {
      showNotification: vi.fn(),
      getNotifications: async () => [],
      pushManager: { getSubscription: vi.fn(async () => ({ unsubscribe: vi.fn() })) },
    },
  };
  const fetch = vi.fn(async () => new Response("public", { status: 200 }));
  class LocalRequest extends Request {
    constructor(input, init) {
      super(typeof input === "string" ? new URL(input, origin) : input, init);
    }
  }
  runInNewContext(code, {
    self,
    caches,
    fetch,
    URL,
    Request: LocalRequest,
    Response,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    console,
  });
  const event = async (type, extra = {}) => {
    const waits = [];
    let response;
    handlers[type]({
      ...extra,
      waitUntil: (p) => waits.push(p),
      respondWith: (p) => {
        response = p;
      },
    });
    await Promise.all(waits);
    return response ? await response : undefined;
  };
  return { self, window, stores, caches, fetch, event, origin };
}
describe("PWA cache and notifications", () => {
  it("caches only static resources, falls back to public offline HTML, keeps API failures visible", async () => {
    const h = harness();
    await h.event("install");
    await h.event("activate");
    const fetch = (path, mode = "cors", method = "GET") =>
      h.event("fetch", { request: { url: h.origin + path, method, mode } });
    await fetch("/_next/static/hash.js");
    await fetch("/portfel", "navigate");
    await fetch("/api/v1/me");
    await fetch("/portfel?_rsc=private");
    const keys = [...h.stores.values()].flatMap((store) => [...store.keys()]);
    expect(keys).toContain(h.origin + "/_next/static/hash.js");
    expect(keys.some((key) => key.includes("portfel") || key.includes("/api/"))).toBe(false);
    h.fetch.mockRejectedValue(new Error("OFFLINE"));
    expect(await (await fetch("/portfel", "navigate")).text()).toBe("public");
    expect(await fetch("/api/v1/me")).toBeUndefined();
  });
  it.each([
    "/api/v1/me",
    "/api/v1/stream",
    "/api/v1/stream/connections/synthetic/instruments",
    "/auth/action",
  ])("does not intercept API/auth, including mutations: %s", async (path) => {
    const h = harness();
    for (const method of ["GET", "POST", "PUT", "DELETE"])
      expect(
        await h.event("fetch", { request: { url: h.origin + path, method, mode: "navigate" } }),
      ).toBeUndefined();
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it("clears private state on message and unsubscribes only on explicit logout", async () => {
    const h = harness();
    await h.event("install");
    await h.caches.open("private-test");
    await h.event("message", { source: h.window, data: { type: "CLEAR_PRIVATE" } });
    expect(await h.caches.keys()).not.toContain("private-test");
    expect(h.self.registration.pushManager.getSubscription).not.toHaveBeenCalled();
    await h.event("message", {
      source: h.window,
      data: { type: "CLEAR_PRIVATE", unsubscribePush: true },
    });
    expect(h.self.registration.pushManager.getSubscription).toHaveBeenCalledOnce();
    const subscription =
      await h.self.registration.pushManager.getSubscription.mock.results[0].value;
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
  });
  it("waits for an explicit update message", async () => {
    const h = harness();
    await h.event("install");
    expect(h.self.skipWaiting).not.toHaveBeenCalled();
    await h.event("message", { source: h.window, data: { type: "ACTIVATE_UPDATE" } });
    expect(h.self.skipWaiting).toHaveBeenCalledOnce();
  });
  it("shows a visible fallback for malformed pushes and validates click targets", async () => {
    const h = harness();
    await h.event("push", {
      data: {
        json: () => {
          throw Error("bad");
        },
      },
    });
    expect(h.self.registration.showNotification).toHaveBeenCalledOnce();
    await h.event("notificationclick", {
      notification: { close: vi.fn(), data: { url: "//evil.test" } },
    });
    expect(h.window.focus).toHaveBeenCalledOnce();
    expect(h.self.clients.openWindow).not.toHaveBeenCalled();
    await h.event("notificationclick", {
      notification: { close: vi.fn(), data: { url: "/rynek/123" } },
    });
    expect(h.window.navigate).toHaveBeenCalledWith(h.origin + "/rynek/123");
  });
});
