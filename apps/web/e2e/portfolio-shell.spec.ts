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

test("manual cash operation can be created, edited and deleted", async ({ page }) => {
  await page.goto("/portfel/operacje/nowa");
  await page.getByLabel("Typ operacji", { exact: true }).selectOption("DEPOSIT");
  await page.getByLabel("Data operacji", { exact: true }).fill("2026-10-12");
  await page.getByLabel("Kwota ze znakiem", { exact: true }).fill("123,45");
  await page.getByRole("button", { name: "Zapisz", exact: true }).click();
  await expect(page).toHaveURL(/\/portfel\/operacje$/);
  await expect(page.getByRole("cell", { name: /123,45/ })).toBeVisible();
  await page.getByRole("link", { name: "Edytuj", exact: true }).click();
  await page.getByLabel("Kwota ze znakiem", { exact: true }).fill("125,00");
  await page.getByRole("button", { name: "Zapisz", exact: true }).click();
  await expect(page.getByRole("cell", { name: /125,00/ })).toBeVisible();
  await page.getByRole("link", { name: "Edytuj", exact: true }).click();
  await page.getByRole("button", { name: "Usuń", exact: true }).click();
  await page.getByRole("button", { name: "Potwierdź usunięcie", exact: true }).click();
  await expect(page).toHaveURL(/\/portfel\/operacje$/);
  await expect(page.getByRole("cell", { name: /125,00/ })).toHaveCount(0);
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

test("Start exposes daily contributions and residual without substituting zero for gaps", async ({
  page,
}) => {
  await page.goto("/");
  const table = page.getByRole("table", { name: "Wynik dnia", exact: true });
  await expect(table.getByRole("columnheader", { name: "Wkład w stopę portfela" })).toBeVisible();
  await expect(table.getByRole("row", { name: /Gotówka i pozostałe.*Brak danych/ })).toBeVisible();
  await expect(table.getByRole("row", { name: /TEST.*Brak danych/ })).toBeVisible();
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

for (const broker of ["xtb", "mbank"])
  test(`${broker}: upload, resolve, acknowledge reconciliation and commit`, async ({ page }) => {
    await page.goto("/portfel/import");
    await page.getByLabel("Broker", { exact: true }).selectOption(broker);
    await page.getByLabel("Plik eksportu", { exact: false }).setInputFiles({
      name: "synthetic.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("synthetic fixture"),
    });
    const started = Date.now();
    await page.getByRole("button", { name: "Wczytaj plik" }).click();
    await expect(page.getByRole("button", { name: "Zatwierdź import" })).toBeDisabled();
    await page.getByRole("button", { name: "Edytuj", exact: true }).click();
    await page.getByLabel("Nazwa, ticker lub ISIN", { exact: true }).fill("TEST");
    await page.getByRole("button", { name: "Wyszukaj instrument", exact: true }).click();
    await page.getByRole("radio", { name: /TEST.*Instrument syntetyczny/ }).check();
    await page.getByRole("button", { name: "Zapisz", exact: true }).click();
    await expect(page.getByRole("button", { name: "Zatwierdź import" })).toBeDisabled();
    await page.getByLabel("Potwierdzam zapoznanie się z różnicami uzgodnienia.").check();
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
        .violations,
    ).toEqual([]);
    await page.getByRole("button", { name: "Zatwierdź import" }).click();
    await expect(page).toHaveURL(/\/portfel$/);
    expect(Date.now() - started).toBeLessThan(120000);
  });

