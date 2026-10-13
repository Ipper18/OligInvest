import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

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
test("portfolio gaps remain visible with quantity and an accessible tax view", async ({ page }) => {
  await page.goto("/portfel");
  await expect(page.getByRole("heading", { name: "Pozycje", exact: true })).toBeVisible();
  await expect(page.getByText("Wycena częściowa", { exact: false })).toBeVisible();
  await expect(page.getByText("Brak danych").first()).toBeVisible();
  await page.getByLabel("Widok wyniku").selectOption("tax");
  await page.getByRole("button", { name: "Zastosuj", exact: true }).click();
  await expect(page.locator('[data-disclaimer-key="tax_view"]')).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations,
  ).toEqual([]);
});
test("MVP portfolio routes render at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  for (const route of [
    "/",
    "/portfel",
    "/portfel/rachunki",
    "/portfel/operacje",
    "/portfel/partie",
    "/portfel/wyniki",
  ]) {
    await page.goto(route);
    await expect(page.locator("h1")).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
        .violations,
    ).toEqual([]);
  }
});
