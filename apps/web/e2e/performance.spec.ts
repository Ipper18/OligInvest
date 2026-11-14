import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Synthetic sessions and portfolio data belong to the fixture server, including image CI.
test.use({ baseURL: "https://127.0.0.1:3197" });

test("English performance labels and decimal formatting follow preferences", async ({
  page,
  context,
  request,
}) => {
  const token = (await context.cookies()).find(
    (c) => c.name === "__Host-oliginvest.session_token",
  )?.value;
  const response = await request.patch("http://127.0.0.1:3198/api/v1/me/preferences", {
    headers: { cookie: `__Host-oliginvest.session_token=${token}` },
    data: { locale: "en-US" },
  });
  expect(response.ok()).toBe(true);
  await page.goto("/portfel/wyniki");
  await expect(
    page.getByRole("heading", { name: "Portfolio performance", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("row", { name: /Selected period/ })).toContainText("10.98");
  await expect(page.getByRole("heading", { name: /Portfolio drawdowns/ })).toBeVisible();
  await page.goto("/portfel/wyniki?from=2025-12-15");
  await expect(page.getByRole("row", { name: /Selected period/ })).toContainText(
    "Period shorter than 30 days",
  );
});
test.beforeEach(async ({ context }) => {
  await context.addCookies([
    {
      name: "__Host-oliginvest.session_token",
      value: `fixture-portfolio-performance-${crypto.randomUUID()}`,
      url: "https://127.0.0.1:3197",
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
});
test("performance shows returns, periods, assumptions, source and realized P/L with axe", async ({
  page,
}) => {
  await page.goto("/portfel/wyniki");
  await expect(page.getByRole("heading", { name: "Wyniki portfela", exact: true })).toBeVisible();
  const table = page.getByRole("table", { name: "Stopy zwrotu", exact: true });
  await expect(table.getByRole("row")).toHaveCount(10);
  await expect(table.getByRole("row", { name: /Wybrany okres/ })).toContainText("10,98");
  await expect(table.getByRole("row", { name: /Wybrany okres/ })).toContainText("8,66");
  await expect(page.locator('[data-freshness-source="computed"]').first()).toBeVisible();
  await expect(page.getByText(/TWR mierzy zmianę wartości/)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Wynik zrealizowany", exact: true }),
  ).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations,
  ).toEqual([]);
});
test("date filters explain short XIRR and missing values without zero returns", async ({
  page,
}) => {
  await page.goto("/portfel/wyniki");
  await page.getByText("Opcje widoku", { exact: true }).click();
  await page.locator('input[name="from"]').fill("2025-12-15");
  await page.getByRole("button", { name: "Zastosuj", exact: true }).click();
  await expect(page.getByRole("row", { name: /Wybrany okres/ })).toContainText(
    "Okres krótszy niż 30 dni",
  );
  await page.goto("/portfel/wyniki?from=2025-06-01");
  await expect(
    page.getByText(/Niepełne wyceny lub przepływy uniemożliwiają obliczenie wyniku/),
  ).toBeVisible();
  await expect(page.getByRole("row", { name: /Wybrany okres/ })).not.toContainText("0,00");
});

test("drawdown uses vector C, lazy canvas, accessible data and missing-state explanations", async ({
  page,
}) => {
  await page.goto("/portfel/wyniki");
  const section = page.getByRole("region", { name: "Obsunięcia portfela", exact: true });
  await expect(section.locator("dd").filter({ hasText: /-25,00|−25,00/ })).toBeVisible();
  await expect(section.locator("canvas")).toHaveCount(0);
  await section.locator("summary").filter({ hasText: "Dane wykresu obsunięć" }).click();
  await expect(section.getByRole("table").getByRole("row")).toHaveCount(9);
  await section.getByText("Wykres underwater", { exact: true }).click();
  await expect(section.locator("canvas")).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations,
  ).toEqual([]);
  await page.goto("/portfel/wyniki?from=2025-12-15");
  await expect(page.getByText(/Brak wycen w wybranym okresie/)).toBeVisible();
  await expect(page.getByText("Wykres underwater", { exact: true })).toHaveCount(0);
  await page.goto("/portfel/wyniki?from=2025-06-01");
  await expect(
    page.getByText(/Niepełne wyceny lub przepływy uniemożliwiają obliczenie obsunięcia/),
  ).toBeVisible();
});
