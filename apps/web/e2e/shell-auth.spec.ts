import AxeBuilder from "@axe-core/playwright";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";

async function session(context: BrowserContext, value: string) {
  await context.addCookies([
    {
      name: "__Host-oliginvest.session_token",
      value: `fixture-${value}-${crypto.randomUUID()}`,
      url: "https://127.0.0.1:3197",
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}
// R-41: on CI runners, leaving a shell document while its SSE request still awaits response headers
// fails every pending WebKit load ("WebKit encountered an internal error"), including the next
// page.goto. toHaveURL passes when a client redirect commits, so wait for the live stream first.
async function liveShell(page: Page) {
  await expect(page.getByText("Aktualizacje na żywo", { exact: true })).toBeVisible();
}
// A live shell answers a revoked session (SSE 401) by navigating to /logowanie, which would race the
// next page.goto; leave the application before swapping the session cookie.
async function switchSession(page: Page, context: BrowserContext, value: string) {
  await liveShell(page);
  await page.goto("about:blank");
  await context.clearCookies();
  await session(context, value);
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
  // WebKit recomputes performance.timeOrigin from the wall clock, so a window marker detects reloads.
  await page.evaluate(() => {
    (window as { documentMarker?: boolean }).documentMarker = true;
  });
  await page.getByLabel("Motyw", { exact: true }).selectOption("light");
  await page.getByLabel("Paleta zysku i straty").selectOption("colorblind");
  await page.getByRole("button", { name: "Zapisz", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveAttribute("data-palette", "colorblind");
  expect(await page.evaluate(() => (window as { documentMarker?: boolean }).documentMarker)).toBe(
    true,
  );
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  // Firefox renders SW responses correctly, but Playwright's body decoder double-decodes gzip.
  // Check server-rendered HTML directly, sharing the browser's session cookies.
  const response = await page.request.get(page.url());
  expect(response.ok()).toBe(true);
  expect(await response.text()).toContain('data-theme="light"');
  await page.getByLabel("Motyw", { exact: true }).selectOption("system");
  await page.getByRole("button", { name: "Zapisz", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "system");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(11, 13, 15)");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(241, 240, 235)");
});

test("BL-211 persists analysis preferences, translates navigation and synchronizes devices", async ({
  page,
  context,
  browser,
}) => {
  await session(context, "preferences-211");
  await page.goto("/ustawienia");
  await page.getByLabel("Metoda kosztu", { exact: true }).selectOption("average");
  await page.getByLabel("Dzień przychodu i kosztu", { exact: true }).selectOption("trade");
  await page.getByLabel("Wliczaj marżę przewalutowania do kosztu podatkowego").uncheck();
  await page.getByLabel("Strefa czasowa", { exact: true }).fill("America/New_York");
  await page.getByLabel("Język", { exact: true }).selectOption("en-US");
  await page.getByRole("button", { name: "Zapisz", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByLabel("Cost method", { exact: true })).toHaveValue("average");
  await expect(page.getByLabel("Income and cost date", { exact: true })).toHaveValue("trade");
  await expect(
    page.getByLabel("Include the currency conversion margin in the tax cost"),
  ).not.toBeChecked();
  await expect(page.getByLabel("Time zone", { exact: true })).toHaveValue("America/New_York");
  await expect(page.getByText("Live updates", { exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const second = await browser.newContext({
    storageState: await context.storageState(),
    ignoreHTTPSErrors: true,
    baseURL: "https://127.0.0.1:3197",
  });
  try {
    const other = await second.newPage();
    await other.goto("/ustawienia");
    await expect(other.getByLabel("Cost method", { exact: true })).toHaveValue("average");
    await page.getByLabel("Theme", { exact: true }).selectOption("light");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Preferences saved." })).toBeVisible();
    await other.bringToFront();
    await other.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(other.getByLabel("Theme", { exact: true })).toHaveValue("light");
    await other.getByLabel("Time zone", { exact: true }).fill("Europe/London");
    await other.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(other.getByLabel("Time zone", { exact: true })).toHaveValue("Europe/London");
    await page.goto("/portfel");
    await expect(
      page.getByText("Analytical view — weighted average. This is not the tax view.", {
        exact: true,
      }),
    ).toBeVisible();
    await page.goto("/portfel?view=tax");
    await expect(page.locator('[data-disclaimer-key="tax_view"]')).toBeVisible();
    await expect(
      page.getByText("Analytical view — weighted average. This is not the tax view.", {
        exact: true,
      }),
    ).toHaveCount(0);
    await page.getByRole("link", { name: "Learn", exact: true }).click();
    await page.getByRole("link", { name: "Glossary", exact: true }).click();
    await page.getByRole("link", { name: "Share", exact: true }).click();
    await expect(
      page.getByText("An ownership interest in an exchange-listed company.", { exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Terms of use", exact: true }).click();
    await expect(page.getByText("§ 2. Scope of services", { exact: true })).toBeVisible();
  } finally {
    await second.close();
  }
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
  await switchSession(page, context, "legal");
  await page.goto("/");
  await expect(page).toHaveURL(/\/akceptacja-regulaminu(?:\?|$)/);
  await page.getByLabel("Akceptuję regulamin.").check();
  await page.getByLabel("Potwierdzam zapoznanie się").check();
  await page.getByRole("button", { name: "Potwierdź akceptację" }).click();
  await expect(page).toHaveURL("/");
  await switchSession(page, context, "no-alerts");
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

test("logout waits for cookie removal before navigation and notifies other tabs afterwards", async ({
  page,
  context,
  request,
}) => {
  await session(context, "logout-race");
  await page.goto("/ustawienia");
  await expect(page.getByText("Aktualizacje na żywo", { exact: true })).toBeVisible();
  const other = await context.newPage();
  // BL-413: sign-out lives in Settings, not in the shell header.
  await other.goto("/ustawienia");
  await expect(other.getByText("Aktualizacje na żywo", { exact: true })).toBeVisible();
  const sessionCookie = (await context.cookies()).find(
    (cookie) => cookie.name === "__Host-oliginvest.session_token",
  )!;
  const gate = `http://127.0.0.1:3198/logout-gates/${sessionCookie.value}`;
  // Gate the fixture API rather than browser routing, keeping service workers enabled.
  expect((await request.post(gate)).ok()).toBe(true);
  try {
    await page.getByRole("button", { name: "Wyloguj się" }).click();
    await expect.poll(async () => (await (await request.get(gate)).json()).arrived).toBe(true);
    await expect(page.locator(".oi-shell")).toHaveCount(0);
    await expect(page).toHaveURL("/ustawienia");
    expect(await context.cookies()).toContainEqual(sessionCookie);
    await expect(other.getByRole("button", { name: "Wyloguj się" })).toBeVisible();
  } finally {
    await request.delete(gate);
  }
  await expect(page).toHaveURL("/logowanie");
  await expect(other).toHaveURL("/logowanie");
  for (const tab of [page, other]) {
    await expect(tab.getByRole("heading", { name: "Zaloguj się" })).toBeVisible();
    await expect(tab.locator(".oi-shell")).toHaveCount(0);
  }
  expect((await context.cookies()).filter((c) => c.name.startsWith("__Host-oliginvest."))).toEqual(
    [],
  );
  await page.goto("/ustawienia");
  await expect(page).toHaveURL("/logowanie?returnTo=%2Fustawienia");
  await expect(page.locator(".oi-shell")).toHaveCount(0);
});

test("fresh legal and MFA gates never render the private shell", async ({ page, context }) => {
  for (const [value, destination] of [
    ["legal", "/akceptacja-regulaminu"],
    ["unverified", "/logowanie/2fa"],
  ] as const) {
    await context.clearCookies();
    await session(context, value);
    const response = await page.goto("/ustawienia");
    await expect(page).toHaveURL(`${destination}?returnTo=%2Fustawienia`);
    expect(await response?.text()).not.toContain('class="oi-shell"');
    await expect(page.locator(".oi-shell")).toHaveCount(0);
  }
});

test("auth pages retain only a validated returnTo when the session is already verified", async ({
  page,
  context,
}) => {
  await session(context, "return-to");
  for (const path of [
    "/logowanie",
    "/logowanie/2fa",
    "/konfiguracja-2fa",
    "/akceptacja-regulaminu",
  ]) {
    for (const [returnTo, destination] of [
      ["/ustawienia?tab=security", "/ustawienia?tab=security"],
      ["//outside.example.test/", "/"],
    ] as const) {
      await page.goto(`${path}?${new URLSearchParams({ returnTo })}`);
      await expect(page).toHaveURL(destination);
      await liveShell(page);
    }
  }
});

test("proxy redirects are minimal plain-text 307s, also for a signed-in /logowanie", async ({
  context,
}) => {
  // BL-613: ZAP 10019 (redirect without Content-Type) and 10044 (big redirect from the page).
  const anonymous = await context.request.get("/", { maxRedirects: 0 });
  expect(anonymous.status()).toBe(307);
  expect(anonymous.headers()["content-type"]).toBe("text/plain; charset=utf-8");
  expect(await anonymous.text()).toBe("/logowanie?returnTo=%2F");
  await session(context, "return-to");
  for (const [returnTo, destination] of [
    ["/ustawienia?tab=security", "/ustawienia?tab=security"],
    ["//outside.example.test/", "/"],
  ] as const) {
    const response = await context.request.get(`/logowanie?${new URLSearchParams({ returnTo })}`, {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(307);
    expect(response.headers().location).toBe(destination);
    expect(response.headers()["content-type"]).toBe("text/plain; charset=utf-8");
    expect(response.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(await response.text()).toBe(destination);
  }
});

test("a pending legal gate preserves the destination from the MFA page", async ({
  page,
  context,
}) => {
  await session(context, "legal");
  await page.goto("/logowanie/2fa?returnTo=%2Fustawienia");
  await expect(page).toHaveURL("/akceptacja-regulaminu?returnTo=%2Fustawienia");
  await page.getByLabel("Akceptuję regulamin.").check();
  await page.getByLabel("Potwierdzam zapoznanie się").check();
  await page.getByRole("button", { name: "Potwierdź akceptację" }).click();
  await expect(page).toHaveURL("/ustawienia");
});
