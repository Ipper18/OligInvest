import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.use({ baseURL: "https://127.0.0.1:3197" });
const run = (suffix: number) =>
  `/analizy/01900000-0000-7000-8000-${String(suffix).padStart(12, "0")}`;
test.beforeEach(async ({ context }) => {
  await context.addCookies([
    {
      name: "__Host-oliginvest.session_token",
      value: `fixture-analytics-pro-${crypto.randomUUID()}`,
      url: "https://127.0.0.1:3197",
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
});
for (const [id, title] of [
  [1, "Monte Carlo"],
  [2, "Testy warunków skrajnych"],
  [3, "Kalkulator celu"],
] as const) {
  test(`${title}: distributions, compliance, reproducibility and accessibility`, async ({
    page,
  }) => {
    await page.goto(run(id));
    await expect(page.getByRole("heading", { name: title, exact: true, level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Jak czytać ten wynik" })).toBeVisible();
    await expect(page.locator("[data-disclaimer-key=analysis]").first()).toBeVisible();
    await expect(page.getByText("Założenia tej analizy", { exact: true })).toBeVisible();
    await expect(page.locator("[data-freshness-source=gpw]")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Dane do odtworzenia" })).toBeVisible();
    await page.getByText("Parametry uruchomienia", { exact: true }).click();
    await expect(page.getByText("42", { exact: true }).first()).toBeVisible();
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
        .violations,
    ).toEqual([]);
    if (id === 1) {
      await expect(page.locator("[data-warning-code=CRISIS_TESTS_SEPARATE]")).toBeVisible();
      await expect(page.getByRole("table", { name: "Tabela wrażliwości" })).toContainText(
        "Długość bloku",
      );
      await expect(
        page.getByRole("table", { name: "Wachlarz percentyli" }).getByRole("row"),
      ).toHaveCount(61);
      await page.getByRole("link", { name: "Następna strona", exact: true }).click();
      await expect(page.locator("[data-freshness-source=gpw]")).toBeVisible();
      await page.getByRole("link", { name: "Wartości realne", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Wartości realne" })).toBeVisible();
    }
    if (id === 2) {
      await expect(page.getByText(/Scenariusz nieobliczony/)).toBeVisible();
      await expect(page.getByText("Waluta szoku", { exact: true })).toBeVisible();
      await expect(page.getByText("USD", { exact: true })).toBeVisible();
      await expect(page.getByText(/Przedział bez szoku/)).toBeVisible();
    }
    await expect(page.getByText("Źródło: GPW", { exact: true })).toBeVisible();
    if (id === 3)
      await expect(
        page.getByRole("table", { name: "Pierwsza wpłata miesięczna (PLN)" }),
      ).toContainText("Poza zakresem modelu");
    await page.setViewportSize({ width: 360, height: 800 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
}
test("429 uses Retry-After and displays Warsaw midnight", async ({ page, context }) => {
  await context.addCookies([
    {
      name: "__Host-oliginvest.session_token",
      value: "fixture-analytics-pro-quota",
      url: "https://127.0.0.1:3197",
      secure: true,
    },
  ]);
  await page.goto("/analizy/nowa/monte-carlo");
  await page.getByRole("button", { name: "Uruchom analizę" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Dzienny limit analiz został wykorzystany",
  );
  await expect(page.getByRole("main").getByRole("alert")).toContainText("00:00");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Europe/Warsaw");
});
test("basic role cannot submit; disabled module is hidden and returns 404", async ({
  page,
  context,
}) => {
  await context.addCookies([
    {
      name: "__Host-oliginvest.session_token",
      value: "fixture-basic-analytics",
      url: "https://127.0.0.1:3197",
      secure: true,
    },
  ]);
  await page.goto("/analizy/nowa/cel");
  await expect(page.getByText(/Rolę pro nadaje administrator/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Uruchom analizę" })).toHaveCount(0);
  await context.addCookies([
    {
      name: "__Host-oliginvest.session_token",
      value: "fixture-no-analytics",
      url: "https://127.0.0.1:3197",
      secure: true,
    },
  ]);
  const response = await page.goto("/analizy");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("link", { name: "Analizy", exact: true })).toHaveCount(0);
});
test("legacy and stale results never invent freshness", async ({ page, context }) => {
  for (const state of ["legacy", "stale"]) {
    await context.addCookies([
      {
        name: "__Host-oliginvest.session_token",
        value: `fixture-analytics-pro-${state}`,
        url: "https://127.0.0.1:3197",
        secure: true,
      },
    ]);
    await page.goto(run(1));
    if (state === "legacy")
      await expect(
        page.getByText("brak informacji o źródle i opóźnieniu danych", { exact: true }),
      ).toBeVisible();
    else await expect(page.locator("[data-stale=true]")).toBeVisible();
  }
});
test("running analysis can be cancelled; failed analysis explains data quality", async ({
  page,
  context,
}) => {
  await context.addCookies([
    {
      name: "__Host-oliginvest.session_token",
      value: `fixture-analytics-pro-running-${crypto.randomUUID()}`,
      url: "https://127.0.0.1:3197",
      secure: true,
    },
  ]);
  await page.goto(run(1));
  await expect(page.getByRole("progressbar")).toHaveAttribute("value", "40");
  await page.getByRole("button", { name: "Anuluj analizę" }).click();
  await expect(page.getByText("Analiza anulowana", { exact: true })).toBeVisible();
  await context.addCookies([
    {
      name: "__Host-oliginvest.session_token",
      value: "fixture-analytics-pro-failed",
      url: "https://127.0.0.1:3197",
      secure: true,
    },
  ]);
  await page.goto(run(1));
  await expect(page.getByRole("main").getByRole("alert")).toContainText("weryfikację jakości");
});

test("uPlot is lazy, fits analysis budgets, and stays off Start and portfolio", async ({
  page,
}, info) => {
  const scripts = new Set<string>();
  page.on("request", (request) => {
    if (request.resourceType() === "script" && request.url().includes("/_next/static/"))
      scripts.add(request.url());
  });
  const read = async () =>
    Promise.all(
      [...scripts].map(async (url) => Buffer.from(await (await page.request.get(url)).body())),
    );
  const isUplot = (body: Buffer) => /u-over|u-under/.test(body.toString());
  for (const route of ["/", "/portfel"]) {
    await page.goto(route);
    await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toBeVisible();
    expect((await read()).some(isUplot)).toBe(false);
  }
  scripts.clear();
  const html = await (await page.request.get(run(1))).text();
  for (const match of html.matchAll(/<script[^>]+src="([^"]+)"/g)) {
    const chunk = Buffer.from(await (await page.request.get(match[1])).body());
    expect(isUplot(chunk)).toBe(false);
  }
  await page.goto(run(1));
  await page.locator("[data-analysis-chart]").scrollIntoViewIfNeeded();
  await expect(page.locator("[data-analysis-chart] canvas")).toBeVisible();
  const chunks = await read();
  const budget = JSON.parse(readFileSync(new URL("../budgets.json", import.meta.url), "utf8"))
    .routes["/analizy/*"];
  const size = (values: Buffer[]) =>
    values.reduce((sum, body) => sum + gzipSync(body, { level: 9 }).length, 0) / 1024;
  const lazy = size(chunks.filter(isUplot)),
    total = size(chunks);
  console.log(
    `Analysis JS: uPlot ${lazy.toFixed(2)}/${budget.lazyKb.uplot} KiB; total ${total.toFixed(2)}/${budget.totalKb} KiB`,
  );
  expect(lazy).toBeGreaterThan(0);
  expect(lazy).toBeLessThanOrEqual(budget.lazyKb.uplot);
  expect(total).toBeLessThanOrEqual(budget.totalKb);
  await page.screenshot({ path: info.outputPath("analysis-desktop.png") });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("[data-analysis-chart] canvas")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("analysis-mobile.png") });
});
