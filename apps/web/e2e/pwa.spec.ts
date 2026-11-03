import { expect, test } from "@playwright/test";

const live = async (page: import("@playwright/test").Page) =>
  expect(page.getByText("Aktualizacje na żywo", { exact: true })).toBeVisible();

for (const scenario of ["first-install", "same-version", "new-version"] as const)
  test(`update banner: ${scenario}`, async ({ page, context }) => {
    // Exercise the registration UI with deterministic lifecycle events; real SW/cache coverage below.
    await page.addInitScript((scenario) => {
      const worker = (version: string) =>
        Object.assign(new EventTarget(), {
          // update() downloads new contents under the same script URL.
          scriptURL: `${location.origin}/sw.js`,
          state: "installing",
          postMessage(message: { type: string }, ports: MessagePort[] = []) {
            if (message.type === "GET_VERSION") {
              ports[0]?.postMessage({ version });
              document.documentElement.dataset.pwaReplies = String(
                Number(document.documentElement.dataset.pwaReplies ?? 0) + 1,
              );
            }
            if (message.type === "ACTIVATE_UPDATE")
              document.documentElement.dataset.pwaActivated = "true";
          },
        });
      const active = worker("01900000-0000-7000-8000-000000000001"),
        candidate = worker(
          scenario === "new-version"
            ? "01900000-0000-7000-8000-000000000002"
            : "01900000-0000-7000-8000-000000000001",
        );
      const registration = Object.assign(new EventTarget(), {
        addEventListener(type: string, listener: EventListener) {
          EventTarget.prototype.addEventListener.call(this, type, listener);
          if (type === "updatefound") document.documentElement.dataset.pwaWatching = "true";
        },
        installing: null as typeof candidate | null,
        waiting: null as typeof candidate | null,
        update: async () => {
          registration.installing = candidate;
          registration.dispatchEvent(new Event("updatefound"));
          registration.waiting = candidate;
          registration.installing = null;
          candidate.state = "installed";
          // First install may claim the page before the statechange callback runs.
          container.controller = active;
          candidate.dispatchEvent(new Event("statechange"));
        },
      });
      const container = Object.assign(new EventTarget(), {
        controller: scenario === "first-install" ? null : active,
        register: async () => registration,
        getRegistration: async () => registration,
      });
      Object.defineProperty(navigator, "serviceWorker", { value: container });
    }, scenario);
    await context.addCookies([
      {
        name: "__Host-oliginvest.session_token",
        value: `fixture-pwa-update-${crypto.randomUUID()}`,
        url: "https://127.0.0.1:3197",
        secure: true,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto("/");
    await live(page);
    // Wait for lazy registration to attach its updatefound listener.
    await expect(page.locator("html")).toHaveAttribute("data-pwa-watching", "true");
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.getRegistration())?.update();
    });
    if (scenario !== "first-install")
      await expect(page.locator("html")).toHaveAttribute("data-pwa-replies", "2");
    await page.evaluate(async () => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    });
    const banner = page.getByText("Dostępna nowa wersja aplikacji", { exact: true });
    if (scenario === "new-version") {
      await expect(
        page.getByRole("banner").getByRole("status").filter({ has: banner }),
      ).toBeVisible();
      await expect(page.getByRole("main").getByText("Dostępna nowa wersja aplikacji")).toHaveCount(
        0,
      );
      await expect(page.locator("html")).not.toHaveAttribute("data-pwa-activated", "true");
      await page.getByRole("banner").getByRole("button", { name: "Odśwież", exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("data-pwa-activated", "true");
    } else await expect(banner).toHaveCount(0);
  });

test("manifest, registered worker and public offline fallback", async ({
  page,
  context,
  browserName,
}) => {
  const manifest = await (await page.request.get("/manifest.webmanifest")).json();
  expect(manifest.display).toBe("standalone");
  expect(manifest.start_url).toBe("/");
  expect(manifest.icons).toHaveLength(3);
  for (const icon of manifest.icons) expect((await page.request.get(icon.src)).ok()).toBe(true);
  await page.goto("/offline");
  await expect(page.getByRole("heading", { name: "Brak połączenia" })).toBeVisible();
  expect(await page.locator("script").count()).toBe(0);
  const encodingErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /encoding|decod/i.test(message.text()))
      encodingErrors.push(message.text());
  });
  page.on("pageerror", (error) => encodingErrors.push(error.message));
  await context.addCookies([
    {
      name: "__Host-oliginvest.session_token",
      value: `fixture-pwa-${crypto.randomUUID()}`,
      url: "https://127.0.0.1:3197",
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto("/");
  await live(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  await page.reload();
  await live(page);
  const version = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = (event) => {
          channel.port1.close();
          resolve(event.data.version);
        };
        navigator.serviceWorker.controller?.postMessage({ type: "GET_VERSION" }, [channel.port2]);
      }),
  );
  expect(await page.evaluate(() => caches.keys())).toContain(`oliginvest-static-${version}`);
  expect(
    await page.evaluate(async () => (await (await fetch(location.href)).text()).includes("<html")),
  ).toBe(true);
  const cachedScript = () =>
    page.evaluate(async () => {
      for (const name of await caches.keys())
        for (const request of await (await caches.open(name)).keys())
          if (new URL(request.url).pathname.endsWith(".js")) return request.url;
      return null;
    });
  await expect.poll(cachedScript).toBeTruthy();
  const url = (await cachedScript()) as string;
  const serverScript = await page.request.get(url);
  expect(serverScript.ok()).toBe(true);
  // Native Fetch decoding exercises the browser's SW path, not Network.getResponseBody.
  expect(await page.evaluate(async (url) => (await fetch(url)).text(), url)).toBe(
    await serverScript.text(),
  );
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.update());
  await expect(page.getByText("Dostępna nowa wersja aplikacji", { exact: true })).toHaveCount(0);
  expect(encodingErrors).toEqual([]);
  const keys = await page.evaluate(async () => {
    const cachesForOrigin = await caches.keys();
    return (
      await Promise.all(
        cachesForOrigin.map(async (key) =>
          (await (await caches.open(key)).keys()).map((request) => new URL(request.url).pathname),
        ),
      )
    ).flat();
  });
  expect(keys).toContain("/offline");
  expect(keys.some((key) => key.startsWith("/api/") || key === "/")).toBe(false);
  // Playwright's offline/worker evaluation checks below are specific to Chromium.
  if (browserName !== "chromium") return;
  await live(page);
  await context.setOffline(true);
  await page.goto("/portfel");
  await expect(page.getByRole("heading", { name: "Brak połączenia" })).toBeVisible();
  await context.setOffline(false);
});
test("notification click keeps the relative destination through the login gate", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Playwright exposes service worker evaluation and notification permission in Chromium.",
  );
  await context.addCookies([
    {
      name: "__Host-oliginvest.session_token",
      value: `fixture-pwa-click-${crypto.randomUUID()}`,
      url: "https://127.0.0.1:3197",
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto("/");
  await live(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await live(page);
  await page.goto("/offline");
  await context.clearCookies();
  const worker = context.serviceWorkers()[0]!;
  // Native notification permission is unavailable in the self-signed headless fixture.
  // Dispatch a synthetic click into the real installed worker; production navigation is exercised.
  await worker.evaluate(async () => {
    let work: Promise<unknown> | undefined;
    const event = new Event("notificationclick");
    Object.defineProperties(event, {
      notification: { value: { close() {}, data: { url: "/portfel/operacje?test=pwa" } } },
      waitUntil: {
        value: (promise: Promise<unknown>) => {
          work = promise;
        },
      },
    });
    globalThis.dispatchEvent(event);
    await work;
  });
  await expect(page).toHaveURL(/\/logowanie\?returnTo=%2Fportfel%2Foperacje%3Ftest%3Dpwa$/);
});
