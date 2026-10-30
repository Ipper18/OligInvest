import { safeReturnTo } from "@oliginvest/contracts/navigation";
import { pwaMessages } from "@oliginvest/i18n";
import { z } from "zod";

const cacheName = "oliginvest-static-__PWA_VERSION__";
const payloadSchema = z
  .object({
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(4000),
    url: z.string().max(2048),
    tag: z.string().max(200),
  })
  .strict();
const messageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ACTIVATE_UPDATE") }).strict(),
  z.object({ type: z.literal("CLEAR_PRIVATE"), unsubscribePush: z.boolean().optional() }).strict(),
  z
    .object({ type: z.literal("CACHE_STATIC"), urls: z.array(z.string().max(2048)).max(100) })
    .strict(),
]);
const staticUrl = (value) => {
  const url = new URL(value, self.location.origin);
  return (
    url.origin === self.location.origin &&
    !url.search &&
    (url.pathname === "/offline.css" ||
      /^\/_next\/static\/.+\.(js|css|woff2?)$/.test(url.pathname) ||
      /^\/icons\/icon-(180|192|512|maskable)\.png$/.test(url.pathname))
  );
};
const cacheResponse = async (request) => {
  const response = await fetch(request);
  if (response.ok && !response.redirected && response.type !== "opaque")
    await (await caches.open(cacheName)).put(request, response.clone());
  return response;
};
self.addEventListener("install", (event) => {
  event.waitUntil(
    Promise.all(
      [
        "/offline",
        "/offline.css",
        "/icons/icon-192.png",
        "/icons/icon-512.png",
        "/icons/icon-maskable.png",
      ].map((path) => cacheResponse(new Request(path, { credentials: "omit", redirect: "error" }))),
    ),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await Promise.all(
        (await caches.keys()).filter((key) => key !== cacheName).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});
self.addEventListener("message", (event) => {
  if (!event.source || new URL(event.source.url).origin !== self.location.origin) return;
  const parsed = messageSchema.safeParse(event.data);
  if (!parsed.success) return;
  const data = parsed.data;
  if (data.type === "ACTIVATE_UPDATE") event.waitUntil(self.skipWaiting());
  if (data.type === "CACHE_STATIC" && Array.isArray(data.urls))
    event.waitUntil(
      Promise.all(
        data.urls
          .slice(0, 100)
          .filter((value) => typeof value === "string" && staticUrl(value))
          .map((url) =>
            cacheResponse(new Request(url, { credentials: "omit", redirect: "error" })).catch(
              () => {},
            ),
          ),
      ),
    );
  if (data.type === "CLEAR_PRIVATE")
    event.waitUntil(
      (async () => {
        await Promise.all(
          (await caches.keys())
            .filter((key) => !key.startsWith("oliginvest-static-"))
            .map((key) => caches.delete(key)),
        );
        for (const notification of await self.registration.getNotifications()) notification.close();
        if (data.unsubscribePush)
          await self.registration.pushManager
            .getSubscription()
            .then((subscription) => subscription?.unsubscribe())
            .catch(() => {});
      })(),
    );
});
self.addEventListener("fetch", (event) => {
  const request = event.request,
    url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Leave API/auth to the browser; even a fetch pass-through can stall WebKit requests.
  if (/^\/(api|auth)(\/|$)/.test(url.pathname)) return;
  if (request.method !== "GET") return;
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(
        async () => (await (await caches.open(cacheName)).match("/offline")) ?? Response.error(),
      ),
    );
  } else if (staticUrl(url.href)) {
    event.respondWith(
      (async () =>
        (await (await caches.open(cacheName)).match(request)) ?? cacheResponse(request))(),
    );
  }
});
self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let parsed;
      try {
        parsed = payloadSchema.safeParse(event.data?.json());
      } catch {
        /* Always visible, including malformed messages. */
      }
      const data = parsed?.success
        ? parsed.data
        : {
            title: pwaMessages.fallbackTitle,
            body: pwaMessages.fallbackBody,
            url: "/",
            tag: "oliginvest",
          };
      await self.registration.showNotification(data.title, {
        body: data.body,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        tag: data.tag,
        data: { url: safeReturnTo(data.url) },
      });
    })(),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const path = safeReturnTo(event.notification.data?.url),
        target = new URL(path, self.location.origin).href;
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const client =
        windows.find((window) => window.url === target) ??
        windows.find((window) => new URL(window.url).origin === self.location.origin);
      if (client) {
        try {
          const moved = client.url === target ? client : await client.navigate(target);
          if (moved) {
            await moved.focus().catch(() => {});
            return;
          }
        } catch {
          /* Closed window: open a new one. */
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
