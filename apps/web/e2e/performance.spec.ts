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
  const exposure = page.getByRole("region", { name: "Currency exposure", exact: true });
  await exposure.locator("summary").filter({ hasText: "Price and currency effect" }).click();
  await expect(
    exposure.getByRole("table", { name: "Price and currency effect" }).getByRole("row", {
      name: /^USD/,
    }),
  ).toContainText("145.69");
  const dividends = page.getByRole("region", { name: "Dividends", exact: true });
  await dividends.locator("summary").filter({ hasText: "Dividend payments" }).click();
  const paid = dividends.getByRole("table", { name: "Dividend payments" }).getByRole("row", {
    name: /^KO/,
  });
  for (const value of ["3.6900", "155/A/NBP/2025", "92.25", "3.69", "Estimate"])
    await expect(paid).toContainText(value);
  await expect(
    dividends.getByText(/It is an informational estimate under this rule/),
  ).toBeVisible();
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

test("currency exposure shows NBP rate and table, effects adding up to P/L and gaps without zero", async ({
  page,
}) => {
  await page.goto("/portfel/wyniki");
  const section = page.getByRole("region", { name: "Ekspozycja walutowa", exact: true });
  await expect(section.getByText(/Pozycje grupujemy według waluty notowania/)).toBeVisible();
  // BL-306b: the PLN cost on a non-PLN account uses NBP of the business day before the cost day.
  await expect(
    section.getByText(/kursem średnim NBP z ostatniego dnia roboczego przed dniem rozliczenia/),
  ).toBeVisible();
  await expect(section.locator('[data-freshness-source="computed"]')).toContainText("Kursy: NBP");
  // Collapsed by default: server-rendered tables, no client JavaScript.
  const exposure = section.getByRole("table", { name: "Aktywa według walut", exact: true });
  await expect(exposure).toBeHidden();
  await section.locator("summary").filter({ hasText: "Aktywa według walut" }).click();
  const usd = exposure.getByRole("row", { name: /^USD/ });
  await expect(usd).toContainText("30,50");
  await expect(usd).toContainText("4,0000");
  await expect(usd).toContainText("190/A/NBP/2025");
  await expect(exposure.getByRole("row", { name: /^PLN/ })).toContainText("waluta bazowa");
  await section.locator("summary").filter({ hasText: "Efekt ceny i efekt kursu" }).click();
  const effects = section.getByRole("table", { name: "Efekt ceny i efekt kursu", exact: true });
  const row = effects.getByRole("row", { name: /^USD/ });
  for (const value of ["258,75", "113,06", "145,69"]) await expect(row).toContainText(value);
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations,
  ).toEqual([]);
  await page.goto("/portfel/wyniki?to=2025-06-30");
  const gap = page.getByRole("region", { name: "Ekspozycja walutowa", exact: true });
  await expect(gap.getByText(/Brak ceny lub kursu uniemożliwia obliczenie sumy/)).toBeVisible();
  await gap.locator("summary").filter({ hasText: "Aktywa według walut" }).click();
  const missing = gap.getByRole("row", { name: /^USD/ });
  await expect(missing).toContainText("Brak kursu NBP");
  await expect(missing).toContainText("Brak wyniku");
  await gap.locator("summary").filter({ hasText: "Efekt ceny i efekt kursu" }).click();
  await expect(gap.getByText(/brak kursu NBP: 1/)).toBeVisible();
  // Z-29/BL-306b: without the NBP rate before the cost day the position is annotated, never 0.
  await page.goto("/portfel/wyniki?to=2025-09-30");
  const unsplit = page.getByRole("region", { name: "Ekspozycja walutowa", exact: true });
  await expect(unsplit.getByRole("note")).toHaveText(
    /^USD: 1 poz\. w ekspozycji, poza rozbiciem .* brak kosztu w PLN .* to nie jest 0\.$/,
  );
  await unsplit.locator("summary").filter({ hasText: "Efekt ceny i efekt kursu" }).click();
  await expect(unsplit.getByText("Żadna pozycja nie jest objęta rozbiciem.")).toBeVisible();
  await expect(
    unsplit.getByText("brak kosztu w PLN (brak kursu NBP z dnia roboczego przed dniem kosztu): 1"),
  ).toBeVisible();
  await expect(unsplit.getByRole("table", { name: "Efekt ceny i efekt kursu" })).toHaveCount(0);
  await page.goto("/portfel/wyniki?to=2025-01-02");
  await expect(page.getByText(/Brak pozycji i gotówki w dniu wyceny/)).toBeVisible();
});

test("dividends show vector G in USD and PLN, NBP table, estimated top-up and gaps without zero", async ({
  page,
}) => {
  await page.goto("/portfel/wyniki");
  const section = page.getByRole("region", { name: "Dywidendy", exact: true });
  await expect(section.getByText(/Szacowana dopłata = 19 % kwoty brutto w PLN/)).toBeVisible();
  await expect(section.getByText(/nie wyliczenie zobowiązania podatkowego/)).toBeVisible();
  await expect(section.locator('[data-freshness-source="computed"]')).toContainText("Kursy: NBP");
  await expect(section.locator('[data-disclaimer-key="tax_view"]')).toBeVisible();
  // Collapsed by default: server-rendered tables, no client JavaScript.
  const payments = section.getByRole("table", { name: "Wypłaty dywidend", exact: true });
  await expect(payments).toBeHidden();
  await section.locator("summary").filter({ hasText: "Wypłaty dywidend" }).click();
  const ko = payments.getByRole("row", { name: /^KO/ });
  for (const value of [
    "25,00",
    "3,75",
    "21,25",
    "77,81",
    "3,6900",
    "155/A/NBP/2025",
    "92,25",
    "3,69",
  ])
    await expect(ko).toContainText(value);
  await expect(payments.getByRole("row", { name: /^TEST/ })).toContainText("waluta bazowa");
  await section.locator("summary").filter({ hasText: "Dywidendy według pozycji" }).click();
  const positions = section.getByRole("table", { name: /Dywidendy według pozycji/ });
  await expect(positions.getByRole("row", { name: /^KO/ })).toContainText("0,38");
  await expect(positions.getByRole("row", { name: /^TEST/ })).toContainText(
    "Brak wyniku (brak otwartej pozycji)",
  );
  await section.locator("summary").filter({ hasText: "Dywidendy w PLN — razem" }).click();
  await expect(
    section.getByRole("table", { name: "Dywidendy w PLN — razem" }).getByRole("row", {
      name: /^Razem/,
    }),
  ).toContainText("592,25");
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations,
  ).toEqual([]);
  await page.goto("/portfel/wyniki?to=2025-03-31");
  const gap = page.getByRole("region", { name: "Dywidendy", exact: true });
  await expect(
    gap.getByText(/Część wypłat nie ma kursu NBP albo zapisanego podatku/),
  ).toBeVisible();
  await expect(gap.getByText("niezapisany podatek u źródła: 1")).toBeVisible();
  await gap.locator("summary").filter({ hasText: "Wypłaty dywidend" }).click();
  const missing = gap.getByRole("table", { name: "Wypłaty dywidend" }).getByRole("row", {
    name: /^KO/,
  });
  await expect(missing).toContainText("Brak danych o podatku u źródła");
  await expect(missing).toContainText("Brak wyniku");
  await gap.locator("summary").filter({ hasText: "Dywidendy w PLN — razem" }).click();
  const total = gap.getByRole("table", { name: "Dywidendy w PLN — razem" }).getByRole("row", {
    name: /^Razem/,
  });
  await expect(total).toContainText("Brak wyniku");
  await expect(total).not.toContainText("0,00");
  await page.goto("/portfel/wyniki?to=2025-01-02");
  await expect(page.getByText("Brak wypłat dywidend w wybranym zakresie.")).toBeVisible();
});
