import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Synthetic sessions exist only on the local fixture server, also during image runs.
test.use({ baseURL: "https://127.0.0.1:3197" });

const instrument = "/rynek/01900000-0000-7000-8000-000000000101";
for (const theme of ["dark", "light"])
  for (const palette of ["default", "colorblind"])
    test(`BL-413 panels, semantics and axe ${theme} ${palette}`, async ({
      page,
      context,
    }, info) => {
      await context.addCookies([
        {
          name: "__Host-oliginvest.session_token",
          value: `fixture-redesign-fresh-${theme}-${palette}-${crypto.randomUUID()}`,
          url: "https://127.0.0.1:3197",
          secure: true,
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);
      for (const width of [360, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        for (const [name, path] of [
          ["start", "/"],
          ["positions", "/portfel"],
          ["instrument", instrument],
        ]) {
          await page.goto(path);
          await expect(page.locator(".oi-connection")).toHaveText("Aktualizacje na żywo");
          await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
          await expect(page.locator("html")).toHaveAttribute(
            "data-palette",
            palette === "default" ? "standard" : "colorblind",
          );
          await expect(page.locator("h1")).toHaveCSS("font-family", /system-ui/);
          await expect(page.locator(".oi-live-status button")).toHaveCount(1);
          await expect(
            page.locator('nav a[href="/admin"], nav a[href="/alerty"], nav a[href="/analizy"]'),
          ).toHaveCount(0);
          // Sign-out lives in Settings; the shell header keeps only the status and its action.
          await expect(page.getByRole("button", { name: "Wyloguj się" })).toHaveCount(0);
          const desktop = width >= 1024;
          const shellNav = page.locator(desktop ? ".oi-sidebar" : ".oi-bottom-nav");
          await expect(shellNav).toBeVisible();
          await expect(shellNav.locator('svg[aria-hidden="true"]').first()).toBeVisible();
          for (const link of await shellNav.getByRole("link").all())
            if (await link.isVisible())
              expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(44);
          if (name === "positions") {
            await expect(page.locator("#account-switch")).toBeVisible();
            const table = page.getByRole("table", { name: "Pozycje", exact: true });
            if (desktop) {
              await expect(
                page.locator('.oi-sidebar .oi-subnav a[aria-current="page"]'),
              ).toHaveText("Pozycje");
              await expect(page.locator(".oi-section-nav")).toBeHidden();
              await expect(table.locator("tfoot")).toContainText("Razem");
            } else {
              await expect(page.locator('.oi-section-nav a[aria-current="page"]')).toHaveText(
                "Pozycje",
              );
              await expect(table).toBeHidden();
              await expect(page.locator(".oi-position-cards")).toBeVisible();
            }
          }
          if (name === "start" && desktop) {
            // The accounts table must fit its card at 1280 px instead of being cut off.
            const accounts = page.locator(".oi-span-all .oi-table-scroll");
            await expect(accounts).toBeVisible();
            expect(await accounts.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
          }
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true);
          const infoButton = page.locator(".oi-info").first();
          await expect(infoButton).toBeVisible();
          const bounds = await infoButton.boundingBox();
          expect(bounds?.width).toBeGreaterThanOrEqual(44);
          expect(bounds?.height).toBeGreaterThanOrEqual(44);
          if (name === "start") {
            await expect(page.locator('[data-onboarding="unrealizedPl"]')).toContainText(
              "▼ -12,34",
            );
            await expect(page.locator('[data-onboarding="dayChange"]')).toContainText("▲ +1,25");
          }
          expect(
            (
              await new AxeBuilder({ page })
                .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
                .analyze()
            ).violations,
          ).toEqual([]);
          if (name === "instrument") {
            const track = await page.locator(".oi-range-track").boundingBox();
            const marker = await page.locator(".oi-range-marker").boundingBox();
            expect(track).not.toBeNull();
            expect(marker).not.toBeNull();
            if (track && marker) expect((marker.x - track.x) / track.width).toBeCloseTo(2 / 3, 2);
            // The canvas is lazy: scroll it into view before capturing the whole page.
            await page.locator(".oi-candlestick").scrollIntoViewIfNeeded();
            await expect(page.locator(".oi-candlestick canvas").first()).toBeVisible();
            await page.getByRole("heading", { level: 1 }).scrollIntoViewIfNeeded();
          }
          // New review captures: panel surfaces, ordinary-case labels, badges and responsive layout.
          const capture = info.outputPath(`bl413-${name}-${theme}-${palette}-${width}.png`);
          await page.screenshot({ path: capture, fullPage: true });
          await info.attach(`${name}-${width}`, { path: capture, contentType: "image/png" });
        }
      }
    });

test("BL-413 large positions remain virtualized and reach the final row", async ({
  page,
  context,
}) => {
  await context.addCookies([
    {
      name: "__Host-oliginvest.session_token",
      value: `fixture-redesign-fresh-large-${crypto.randomUUID()}`,
      url: "https://127.0.0.1:3197",
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/portfel");
    const region = page.locator('.oi-virtual-table[aria-label="Pozycje"]');
    await expect(region).toBeVisible();
    await expect(region.getByRole("table")).toHaveAttribute("aria-rowcount", "202");
    await expect(
      region.getByRole("link", { name: "Instrument syntetyczny 1", exact: true }),
    ).toBeVisible();
    expect(await region.locator("tbody tr[data-index]").count()).toBeLessThan(100);
    await region.focus();
    await page.keyboard.press("Control+End");
    await expect(region.getByRole("cell", { name: "Razem", exact: true })).toBeVisible();
    await expect(
      region.getByRole("link", { name: "Instrument syntetyczny 200", exact: true }),
    ).toBeVisible();
    expect(await region.locator("tbody tr[data-index]").count()).toBeLessThan(100);
    await page.keyboard.press("Control+Home");
    await expect(
      region.getByRole("link", { name: "Instrument syntetyczny 1", exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
  }
});

test("BL-413 bars retain geometry under CSP without hydration", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, ignoreHTTPSErrors: true });
  try {
    const page = await context.newPage();
    const response = await page.goto("https://127.0.0.1:3197/ui-preview");
    const policy = response?.headers()["content-security-policy"];
    expect(policy).toContain("style-src 'self' 'nonce-");
    expect(policy).not.toContain("unsafe-inline");
    const bar = page.locator(".oi-allocation-bar");
    await expect(bar).toBeVisible();
    const bounds = await bar.boundingBox();
    expect(bounds).not.toBeNull();
    for (const [index, share] of [0.75, 0.25].entries()) {
      const slice = await bar.locator("rect").nth(index).boundingBox();
      expect(slice).not.toBeNull();
      if (bounds && slice) expect(slice.width / bounds.width).toBeCloseTo(share, 2);
    }
    const track = await page.locator(".oi-range-track").boundingBox();
    const marker = await page.locator(".oi-range-marker").boundingBox();
    expect(track).not.toBeNull();
    expect(marker).not.toBeNull();
    if (track && marker) expect((marker.x - track.x) / track.width).toBeCloseTo(2 / 3, 2);
    await expect(page.locator(".oi-allocation-labels")).toContainText("PLN 75,00%");
    await expect(page.locator(".oi-range")).toContainText("66,67%");
  } finally {
    await context.close();
  }
});

for (const state of ["stale", "empty", "error"])
  test(`BL-413 Start ${state} retains an explicit accessible state`, async ({
    page,
    context,
  }, info) => {
    await context.addCookies([
      {
        name: "__Host-oliginvest.session_token",
        value: `fixture-redesign-${state}-${crypto.randomUUID()}`,
        url: "https://127.0.0.1:3197",
        secure: true,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.setViewportSize({ width: 360, height: 900 });
    await page.goto("/");
    if (state === "error") {
      await expect(page.locator(".oi-error-state")).toBeVisible();
      await expect(page.locator(".oi-error-state").getByRole("button")).toBeVisible();
    } else {
      await expect(page.locator(".oi-connection")).toHaveText("Aktualizacje na żywo");
      await expect(page.locator('[data-onboarding="totalValue"] dd')).toHaveText("—");
      await expect(page.locator(".oi-kpis")).not.toContainText("0,00");
      if (state === "empty")
        await expect(
          page
            .locator(".oi-empty-state")
            .getByRole("link", { name: "Import operacji", exact: true }),
        ).toBeVisible();
      else await expect(page.locator(".oi-stale-banner")).toBeVisible();
    }
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.screenshot({ path: info.outputPath(`bl413-start-${state}.png`), fullPage: true });
  });

test("BL-413 sheet confines focus and restores the trigger after Escape", async ({
  page,
  context,
}) => {
  await context.addCookies([
    {
      name: "__Host-oliginvest.session_token",
      value: `fixture-redesign-fresh-sheet-${crypto.randomUUID()}`,
      url: "https://127.0.0.1:3197",
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto(instrument);
  const trigger = page.getByRole("button", { name: "Pokaż wskaźniki" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Wskaźniki", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Parametry wskaźników" })).toBeVisible();
  await dialog.getByRole("button", { name: "Zamknij", exact: true }).focus();
  await page.keyboard.press("Tab");
  // Native dialogs may focus the dialog itself or body at the wrap boundary.
  expect(
    await page.evaluate(
      () =>
        document.activeElement === document.body ||
        Boolean(document.activeElement?.closest("dialog")),
    ),
  ).toBe(true);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test("BL-413 offline Start hides the current valuation and preserves provenance", async ({
  page,
  context,
}, info) => {
  await context.addCookies([
    {
      name: "__Host-oliginvest.session_token",
      value: `fixture-redesign-fresh-offline-${crypto.randomUUID()}`,
      url: "https://127.0.0.1:3197",
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto("/");
  await expect(page.locator('[data-onboarding="totalValue"] dd')).toContainText("1000,00");
  await expect(page.locator(".oi-connection")).toHaveText("Aktualizacje na żywo");
  await context.setOffline(true);
  await expect(page.locator(".oi-connection")).toHaveText("Brak połączenia z siecią.");
  await expect(page.locator('[data-onboarding="totalValue"] dd')).toHaveText("—");
  await expect(page.locator(".oi-freshness").first()).toContainText("gpw");
  await page.screenshot({ path: info.outputPath("bl413-start-offline.png"), fullPage: true });
  await context.setOffline(false);
});
