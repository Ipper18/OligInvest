import { gzipSync } from "node:zlib";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.use({ baseURL: "https://127.0.0.1:3197" });

test("onboarding supports keyboard skip, persists it, replays and completes with reduced motion", async ({
  page,
  context,
  request,
}) => {
  const token = `fixture-portfolio-onboarding-${crypto.randomUUID()}`;
  await context.addCookies([
    {
      name: "__Host-oliginvest.session_token",
      value: token,
      url: "https://127.0.0.1:3197",
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const state = async () =>
    (
      await request.get("http://127.0.0.1:3198/api/v1/education/onboarding", {
        headers: { cookie: `__Host-oliginvest.session_token=${token}` },
      })
    ).json();
  await page.goto("/");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pomiń", exact: true })).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations,
  ).toEqual([]);
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    await expect
      .poll(() =>
        page.getByRole("dialog").evaluate((dialog) => dialog.contains(document.activeElement)),
      )
      .toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(async () => (await state()).skippedAt).toBeTruthy();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Start", exact: true })).toBeVisible();
  await page.goto("/nauka");
  const start = page.getByRole("button", { name: "Uruchom przewodnik ponownie" });
  await start.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  for (let i = 0; i < 6; i++) {
    await page.getByRole("button", { name: "Dalej", exact: true }).focus();
    await page.keyboard.press("Enter");
  }
  await page.getByRole("button", { name: "Zakończ", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await state()).completedAt).toBeTruthy();
  await expect(start).toBeFocused();
});

test("onboarding has no routes when education is disabled", async ({ page, context }) => {
  await context.addCookies([
    {
      name: "__Host-oliginvest.session_token",
      value: "fixture-portfolio-no-education",
      url: "https://127.0.0.1:3197",
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const response = await page.goto("/nauka");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("button", { name: "Uruchom przewodnik ponownie" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Nauka", exact: true })).toHaveCount(0);
});

test("allocation presents the contract fields and the pending service accessibly", async ({
  page,
}) => {
  await page.goto("/portfel");
  await page.getByRole("link", { name: "Alokacja", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Alokacja", exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByRole("status")).toContainText(
    "po uruchomieniu usługi portfela",
  );
  const grouping = page.getByLabel("Podział według");
  await expect(grouping).toBeDisabled();
  await expect(grouping.locator("option")).toHaveCount(6);
  await expect(page.getByLabel("Klasa aktywów", { exact: true })).toBeDisabled();
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations,
  ).toEqual([]);
});

test("onboarding lazy and total JS stay within route budgets", async ({ page }) => {
  const scripts = new Map<string, Buffer>(),
    pending: Promise<void>[] = [];
  page.on("response", (response) => {
    if (response.request().resourceType() === "script" && response.url().includes("/_next/static/"))
      pending.push(
        response.body().then((body) => {
          scripts.set(response.url(), body);
        }),
      );
  });
  await page.goto("/nauka");
  await page.getByRole("button", { name: "Uruchom przewodnik ponownie" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await Promise.all(pending);
  const total =
    [...scripts.values()].reduce((sum, body) => sum + gzipSync(body, { level: 9 }).length, 0) /
    1024;
  const driver =
    [...scripts.values()]
      .filter((body) => body.includes("driver-popover"))
      .reduce((sum, body) => sum + gzipSync(body, { level: 9 }).length, 0) / 1024;
  console.log(
    `Onboarding JS: total ${total.toFixed(2)}/190 KiB; driver ${driver.toFixed(2)}/8 KiB`,
  );
  expect(driver).toBeLessThanOrEqual(8);
  expect(total).toBeLessThanOrEqual(190);
});

test("indicators are requested on demand and have a keyboard-accessible table", async ({
  page,
}) => {
  const scripts = new Map<string, Buffer>(),
    pending: Promise<void>[] = [];
  page.on("response", (response) => {
    if (response.request().resourceType() === "script" && response.url().includes("/_next/static/"))
      pending.push(
        response.body().then((body) => {
          scripts.set(response.url(), body);
        }),
      );
  });
  await page.goto("/rynek/01900000-0000-7000-8000-000000000101");
  await expect(page.getByRole("heading", { name: "Parametry wskaźników" })).toHaveCount(0);
  await page.getByRole("button", { name: "Pokaż wskaźniki" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("checkbox", { name: "SMA", exact: true }).check();
  await page.getByRole("button", { name: "Oblicz", exact: true }).click();
  await expect(
    page.getByText("Brak wartości: rozgrzewka lub niepełne dane", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pokaż jako tabelę", exact: true }).click();
  await expect(page.getByRole("table", { name: "Wskaźniki", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "sma:20 value", exact: true })).toBeVisible();
  await Promise.all(pending);
  const total =
    [...scripts.values()].reduce((sum, body) => sum + gzipSync(body, { level: 9 }).length, 0) /
    1024;
  const chart =
    [...scripts.values()]
      .filter((body) => /lightweight-charts|TradingView, Inc\./i.test(body.toString()))
      .reduce((sum, body) => sum + gzipSync(body, { level: 9 }).length, 0) / 1024;
  console.log(`Instrument JS: total ${total.toFixed(2)}/280 KiB; chart ${chart.toFixed(2)}/54 KiB`);
  expect(chart).toBeGreaterThan(0);
  expect(chart).toBeLessThanOrEqual(54);
  expect(total).toBeLessThanOrEqual(280);
});

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    {
      name: "__Host-oliginvest.session_token",
      value: `fixture-portfolio-${crypto.randomUUID()}`,
      url: "https://127.0.0.1:3197",
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
});

test("glossary searches synonyms and opens contextual definitions with the keyboard", async ({
  page,
}) => {
  await page.goto("/nauka/slownik?q=srednia%20prosta");
  await page.getByRole("link", { name: "SMA", exact: true }).click();
  await expect(page.getByText("Definicja", { exact: true })).toBeVisible();
  await page.goto("/rynek/01900000-0000-7000-8000-000000000101");
  const trigger = page.getByRole("button", { name: "Co oznacza Wolumen" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(":popover-open").getByText("Pułapki", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations,
  ).toEqual([]);
});

test("watchlists persist a list, instrument and note after reload", async ({ page }) => {
  await page.goto("/rynek/watchlisty");
  await page.getByLabel("Nazwa listy", { exact: true }).fill("Obserwowane testowe");
  await page.getByRole("button", { name: "Utwórz listę", exact: true }).click();
  await page.getByRole("link", { name: "Obserwowane testowe", exact: true }).click();
  await page.locator("#instrument-query").fill("TEST");
  await page.getByRole("button", { name: "Wyszukaj instrument", exact: true }).click();
  await page.getByRole("radio").first().check();
  await page.getByRole("button", { name: "Dodaj instrument", exact: true }).click();
  // Controls stay disabled until the save and its router refresh have finished; reloading during
  // the refresh made Firefox abort page.reload (NS_BINDING_ABORTED).
  await expect(page.getByRole("button", { name: "Dodaj instrument", exact: true })).toBeEnabled();
  await page.getByLabel("Notatka TEST", { exact: true }).fill("Notatka syntetyczna");
  await page.getByRole("button", { name: "Zapisz notatkę", exact: true }).click();
  await expect(page.getByRole("button", { name: "Zapisz notatkę", exact: true })).toBeEnabled();
  await page.reload();
  await expect(page.getByLabel("Notatka TEST", { exact: true })).toHaveValue("Notatka syntetyczna");
  await expect(page.getByRole("cell", { name: "12,00 zł", exact: true })).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations,
  ).toEqual([]);
});

test("market preserves a quote with WARN and separates provider degradation", async ({ page }) => {
  await page.goto("/rynek");
  await expect(page.getByRole("heading", { name: "Rynek", exact: true })).toBeVisible();
  await expect(page.locator('[data-quality-status="WARN"]')).toBeVisible();
  await expect(page.getByRole("cell", { name: "12,00 zł", exact: true })).toBeVisible();
  await expect(page.getByText("Dane ograniczone", { exact: true })).toBeVisible();
  await expect(page.locator('[data-disclaimer-key="data_delay"]')).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations,
  ).toEqual([]);
});

test("FX history identifies the NBP table and labels ECB fallback", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/rynek/waluty");
  await expect(page.getByRole("cell", { name: "TEST/A/NBP" })).toBeVisible();
  await page.getByLabel("Waluta", { exact: true }).selectOption("EUR");
  await page.getByRole("button", { name: "Pokaż", exact: true }).click();
  await expect(page.getByText("Kurs zapasowy EBC (Frankfurter)", { exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "TEST/A/NBP" })).toHaveCount(0);
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations,
  ).toEqual([]);
});
