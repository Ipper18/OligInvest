import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.use({ baseURL: "https://127.0.0.1:3197" });

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
