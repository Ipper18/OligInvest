import AxeBuilder from "@axe-core/playwright";
import { type BrowserContext, expect, test } from "@playwright/test";

async function session(context: BrowserContext, value: string) {
  await context.addCookies([
    {
      name: "__Host-oliginvest.session_token",
      value: `fixture-${value}`,
      url: "https://127.0.0.1:3197",
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}
for (const theme of ["dark", "light"])
  for (const width of [360, 1280])
    test(`shell and settings axe ${theme} ${width}`, async ({ page, context }) => {
      await session(context, `${theme}-${width}`);
      await page.setViewportSize({ width, height: 900 });
      for (const path of ["/", "/ustawienia"]) {
        await page.goto(path);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expect(page.getByText("Aktualizacje na żywo", { exact: true })).toBeVisible();
        expect(
          (
            await new AxeBuilder({ page })
              .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
              .analyze()
          ).violations,
        ).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
      }
    });
test("preferences persist without document reload and system follows OS", async ({
  page,
  context,
}) => {
  await session(context, "preferences");
  await page.goto("/ustawienia");
  const time = await page.evaluate(() => performance.timeOrigin);
  await page.getByLabel("Motyw", { exact: true }).selectOption("light");
  await page.getByLabel("Paleta zysku i straty").selectOption("colorblind");
  await page.getByRole("button", { name: "Zapisz", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveAttribute("data-palette", "colorblind");
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(time);
  const response = await page.reload();
  expect(await response?.text()).toContain('data-theme="light"');
  await page.getByLabel("Motyw", { exact: true }).selectOption("system");
  await page.getByRole("button", { name: "Zapisz", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "system");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(11, 13, 15)");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(250, 250, 247)");
});
test("password challenge gates data, bad TOTP focuses documented error, logout clears cookies", async ({
  page,
  context,
}) => {
  await page.goto("/ustawienia");
  await expect(page).toHaveURL(/\/logowanie(?:\?|$)/);
  await page.getByLabel("E-mail", { exact: true }).fill("ui@example.test");
  await page.getByLabel("Hasło", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Zaloguj się", exact: true }).click();
  await expect(page).toHaveURL(/\/logowanie\/2fa/);
  await page.getByLabel("Kod z aplikacji", { exact: true }).fill("000000");
  await page.getByRole("button", { name: "Potwierdź kod", exact: true }).click();
  await expect(page.locator(".oi-error-summary")).toBeFocused();
  await page.getByLabel("Kod z aplikacji", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "Potwierdź kod", exact: true }).click();
  await expect(page).toHaveURL("/ustawienia");
  await expect(page.getByLabel("Motyw", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Wyloguj się" }).click();
  await expect(page).toHaveURL(/\/logowanie$/);
  expect((await context.cookies()).filter((c) => c.name.startsWith("__Host-oliginvest."))).toEqual(
    [],
  );
});
test("enrollment then legal gate; optional modules absent from navigation", async ({
  page,
  context,
}) => {
  await session(context, "enroll");
  await page.goto("/");
  await expect(page).toHaveURL(/\/konfiguracja-2fa(?:\?|$)/);
  await page.getByLabel("Hasło", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Włącz drugi składnik" }).click();
  await expect(page.getByAltText("Kod QR do aplikacji uwierzytelniającej")).toHaveAttribute(
    "src",
    /^data:image\/png/,
  );
  await page.getByLabel("Kod z aplikacji", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "Potwierdź kod" }).click();
  await expect(page.getByRole("heading", { name: "Kody zapasowe" })).toBeVisible();
  await expect(page.locator(".oi-backup-codes li")).toHaveCount(10);
  await page.getByRole("button", { name: "Kody zapisane" }).click();
  await expect(page).toHaveURL("/");
  await context.clearCookies();
  await session(context, "legal");
  await page.goto("/");
  await expect(page).toHaveURL(/\/akceptacja-regulaminu(?:\?|$)/);
  await page.getByLabel("Akceptuję regulamin.").check();
  await page.getByLabel("Potwierdzam zapoznanie się").check();
  await page.getByRole("button", { name: "Potwierdź akceptację" }).click();
  await expect(page).toHaveURL("/");
  await context.clearCookies();
  await session(context, "no-alerts");
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Alerty", exact: true })).toHaveCount(0);
});
test("public legal and auth pages have no axe violations; fragments are removed", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 900 });
  for (const path of [
    "/logowanie",
    "/reset-hasla",
    "/rejestracja#t=abcdefghijklmnopqrstuvwxyz0123456789",
    "/reset-hasla/nowe#t=abcdefghijklmnopqrstuvwxyz0123456789",
    "/regulamin",
    "/prywatnosc",
    "/zrodla-danych",
  ]) {
    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    if (path.includes("#")) await expect(page).not.toHaveURL(/#/);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await expect(page.getByRole("link", { name: "TradingView", exact: true })).toHaveAttribute(
    "href",
    "https://www.tradingview.com/",
  );
  const download = await page.request.get("/dokumenty/terms");
  expect(download.headers()["content-disposition"]).toContain("attachment");
  expect(await download.text()).toContain("§ 10. Postanowienia końcowe");
});
