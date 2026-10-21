import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.use({ baseURL: "https://127.0.0.1:3197" });

test("indicators are requested on demand and have a keyboard-accessible table", async ({
  page,
}) => {
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
