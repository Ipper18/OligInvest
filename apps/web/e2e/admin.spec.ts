import AxeBuilder from "@axe-core/playwright";
import { adminMessages as m } from "@oliginvest/i18n/admin";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";

// Synthetic admin boundary (test/admin-fixture.mjs). Real role checks, step-up, audit and RLS
// are proven against PostgreSQL by apps/api/integration/admin-users.mjs.
test.use({ baseURL: "https://127.0.0.1:3197" });
const origin = "https://127.0.0.1:3197";
const alice = "01900000-0000-7000-8000-000000000201";

async function signIn(context: BrowserContext, token: string) {
  await context.addCookies([
    {
      name: "__Host-oliginvest.session_token",
      value: token,
      url: origin,
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}
async function axe(page: Page) {
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
}
/** Domain endpoints an /admin page must never call (no financial data in the admin views). */
function watchDomainCalls(page: Page) {
  const calls: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (/^\/api\/v1\/(portfolio|market|analytics|alerts|watchlists)\b/u.test(path))
      calls.push(path);
  });
  return calls;
}
const financialMarkers = ["Rachunek syntetyczny", "Instrument syntetyczny", "PLN"];

// The API's 403 for a real non-administrator session is asserted in mvp-real.spec.ts.
test("non-administrator gets 404 for every /admin page and no admin link", async ({
  page,
  context,
}) => {
  await signIn(context, `fixture-verified-${crypto.randomUUID()}`);
  for (const path of [
    "/admin",
    "/admin/uzytkownicy",
    `/admin/uzytkownicy/${alice}`,
    "/admin/sesje",
  ]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
    await expect(page.getByText("alicja@example.test")).toHaveCount(0);
  }
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Administracja", exact: true })).toHaveCount(0);
});

test("admin shell is accessible at 360 px and shows no financial data", async ({
  page,
  context,
}) => {
  await signIn(context, `fixture-admin-${crypto.randomUUID()}`);
  const domainCalls = watchDomainCalls(page);
  for (const [path, heading] of [
    ["/admin", m.title],
    ["/admin/uzytkownicy", m.sections.users],
    [`/admin/uzytkownicy/${alice}`, "alicja@example.test"],
    ["/admin/zaproszenia", m.sections.invitations],
    ["/admin/sesje", m.sections.sessions],
  ] as const) {
    await page.setViewportSize({ width: 1280, height: 900 });
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.getByText(m.noFinancialData)).toBeVisible();
    const text = await page.locator("main").innerText();
    for (const marker of financialMarkers) expect(text).not.toContain(marker);
    await axe(page);
    await page.setViewportSize({ width: 360, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await axe(page);
  }
  expect(domainCalls).toEqual([]);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/admin");
  await expect(
    page.getByRole("link", { name: "Administracja", exact: true }).first(),
  ).toBeVisible();
});

test("block needs confirmation and a fresh TOTP, all from the keyboard", async ({
  page,
  context,
}) => {
  await signIn(context, `fixture-admin-${crypto.randomUUID()}`);
  await page.goto(`/admin/uzytkownicy/${alice}`);
  await page.getByLabel(m.fields.blockReason).fill("Syntetyczny powód");
  await page.getByLabel(m.fields.blockReason).press("Enter");
  const dialog = page.getByRole("dialog", { name: m.confirm.title });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("alicja@example.test");
  // Dismiss is focused first: Enter cancels, the action needs an explicit choice.
  await expect(dialog.getByRole("button", { name: m.confirm.dismiss })).toBeFocused();
  await axe(page);
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: m.confirm.accept })).toBeFocused();
  await page.keyboard.press("Enter");
  const code = dialog.getByLabel(m.stepUp.label);
  await expect(code).toBeFocused();
  await axe(page);
  await page.keyboard.type("000000");
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("status")).toHaveText(m.stepUp.invalid);
  await code.fill("123456");
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: m.result.done })).toBeVisible();
  await expect(page.getByRole("button", { name: m.actions.unblock })).toBeVisible();
  await expect(page.getByRole("button", { name: m.actions.block })).toHaveCount(0);
});

test("Escape cancels a destructive action without calling the API", async ({ page, context }) => {
  await signIn(context, `fixture-admin-${crypto.randomUUID()}`);
  // Every admin change is a Server Action POST (admin/actions.ts) or a direct admin API call.
  const mutations: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() !== "GET" &&
      (request.headers()["next-action"] !== undefined || request.url().includes("/api/v1/admin/"))
    )
      mutations.push(request.url());
  });
  await page.goto(`/admin/uzytkownicy/${alice}`);
  await page.getByRole("button", { name: m.actions.delete }).click();
  const dialog = page.getByRole("dialog", { name: m.confirm.title });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: m.actions.delete })).toBeFocused();
  expect(mutations).toEqual([]);
});

test("admin deletion, invitation and session revoke run through step-up", async ({
  page,
  context,
}) => {
  await signIn(context, `fixture-admin-${crypto.randomUUID()}`);
  const confirmWithCode = async () => {
    const dialog = page.getByRole("dialog", { name: m.confirm.title });
    await dialog.getByRole("button", { name: m.confirm.accept }).click();
    const code = dialog.getByLabel(m.stepUp.label);
    if (await code.isVisible().catch(() => false)) {
      await code.fill("123456");
      await dialog.getByRole("button", { name: m.stepUp.submit }).click();
    }
    await expect(dialog).toBeHidden();
  };
  await page.goto(`/admin/uzytkownicy/${alice}`);
  await page.getByRole("button", { name: m.actions.delete }).click();
  const dialog = page.getByRole("dialog", { name: m.confirm.title });
  await dialog.getByRole("button", { name: m.confirm.accept }).click();
  await dialog.getByLabel(m.stepUp.label).fill("123456");
  await dialog.getByRole("button", { name: m.stepUp.submit }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: m.actions.cancelDeletion })).toBeVisible();
  await expect(page.getByText(m.state.byAdmin).first()).toBeVisible();
  await page.getByRole("button", { name: m.actions.cancelDeletion }).click();
  await confirmWithCode();
  await expect(page.getByRole("button", { name: m.actions.delete })).toBeVisible();

  await page.goto("/admin/zaproszenia");
  await page.getByLabel(m.fields.inviteEmail).fill("zaproszony@example.test");
  await page.getByRole("button", { name: m.actions.createInvitation }).click();
  await confirmWithCode();
  await expect(page.getByText(m.result.inviteCreated)).toBeVisible();
  await expect(page.locator("code")).toContainText("/rejestracja#t=");
  await expect(page.getByRole("cell", { name: "zaproszony@example.test" })).toBeVisible();

  await page.goto("/admin/sesje");
  const rows = page.getByRole("row").filter({ hasText: "alicja@example.test" });
  await expect(rows).toHaveCount(2);
  await rows.first().getByRole("button", { name: m.actions.revokeSession }).click();
  await confirmWithCode();
  await expect(rows).toHaveCount(1);
});

test("admin shell follows the English locale", async ({ page, context, request }) => {
  const token = `fixture-admin-${crypto.randomUUID()}`;
  await signIn(context, token);
  const response = await request.patch("http://127.0.0.1:3198/api/v1/me/preferences", {
    headers: { cookie: `__Host-oliginvest.session_token=${token}` },
    data: { locale: "en-US" },
  });
  expect(response.ok()).toBe(true);
  await page.goto("/admin/uzytkownicy");
  await expect(page.getByRole("heading", { level: 1, name: "Users" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Administration sections" })).toBeVisible();
  await axe(page);
});
