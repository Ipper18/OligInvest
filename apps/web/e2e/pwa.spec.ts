import { expect, test } from "@playwright/test";

const live = async (page: import("@playwright/test").Page) =>
  expect(page.getByText("Aktualizacje na żywo", { exact: true })).toBeVisible();
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
  // Playwright exposes workers and offline control in Chromium. Other engines still check the public assets.
  if (browserName !== "chromium") return;
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
