import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { adminMessages as m } from "@oliginvest/i18n/admin";
import { expect, test } from "@playwright/test";
import { freshAuthMinute, recordAuthCalls, totp } from "./real-helpers";

// BL-112, BL-501, BL-509 against the production API, PostgreSQL RLS and audit (pnpm ci:e2e).
// Chromium only (playwright.config.ts): the admin path is server-side and browser-independent,
// while the UI in all three browsers is covered by admin.spec.ts and the non-admin 403/404 by
// mvp-real.spec.ts. Three auth calls (sign-up, enable, verify); the enrolment counts as a fresh
// step-up for 15 minutes, so no further TOTP is spent. The real rate limits stay unchanged.
test("real administrator sees accounts but none of their financial data", async ({
  page,
  browserName,
}) => {
  test.setTimeout(150000);
  // mvp-real.spec.ts spent three of this minute's five calls for the same loopback peer.
  await freshAuthMinute();
  const path = process.env.E2E_BROWSER_FIXTURE;
  if (!path) throw new Error("Run through pnpm ci:e2e");
  const fixture = JSON.parse(readFileSync(path, "utf8"))[browserName];
  const admin = fixture.admin;
  await page.goto(`/rejestracja#t=${admin.token}`);
  await page.getByLabel("Imię lub nazwa", { exact: true }).fill("Admin E2E");
  await page.getByLabel("E-mail", { exact: true }).fill(admin.email);
  await page.getByLabel("Hasło", { exact: true }).fill(admin.password);
  await page.getByLabel("Akceptuję regulamin.", { exact: true }).check();
  await page.getByLabel("Potwierdzam zapoznanie się z informacją o przetwarzaniu danych.").check();
  await page.getByRole("button", { name: "Załóż konto", exact: true }).click();
  await expect(page).toHaveURL(/\/konfiguracja-2fa/);
  // MFA gate first: an administrator without TOTP cannot read the admin API.
  const gated = await page.request.get("/api/v1/admin/users");
  expect(gated.status()).toBe(403);
  expect((await gated.json()).code).toBe("MFA_ENROLLMENT_REQUIRED");
  await page.getByLabel("Hasło", { exact: true }).fill(admin.password);
  await page.getByRole("button", { name: "Włącz drugi składnik", exact: true }).click();
  await expect(page.locator(".oi-secret")).toBeVisible();
  const secret = await page.locator(".oi-secret").innerText();
  await page.getByLabel("Kod z aplikacji", { exact: true }).fill(totp(secret));
  await page.getByRole("button", { name: "Potwierdź kod", exact: true }).click();
  await expect(page.locator(".oi-backup-codes li")).toHaveCount(10);
  await page.getByRole("button", { name: "Kody zapisane", exact: true }).click();
  await expect(page).toHaveURL("/");
  recordAuthCalls();

  const domainCalls: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (/^\/api\/v1\/(portfolio|market|analytics|alerts|watchlists)\b/u.test(url.pathname))
      domainCalls.push(url.pathname);
  });
  await page.getByRole("link", { name: "Administracja", exact: true }).first().click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto(`/admin/uzytkownicy?q=${encodeURIComponent(fixture.email)}`);
  // Exact link name: `admin-<browser>@…` contains the ordinary account's address too.
  const link = page.getByRole("link", { name: fixture.email, exact: true });
  await expect(link).toHaveCount(1);
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations,
  ).toEqual([]);
  await link.click();
  await expect(page.getByRole("heading", { level: 1, name: fixture.email })).toBeVisible();
  // mvp-real.spec.ts gave this account a portfolio; none of it may reach the admin view.
  const html = await page.content();
  for (const marker of ["XTB E2E", "14518.27", "14 518,27", "AAPL", "PKO", "VWCE"])
    expect(html).not.toContain(marker);

  // A real mutation through the Server Action: audited, alerted, no extra TOTP needed yet.
  await page.getByRole("button", { name: m.actions.revokeSessions }).click();
  const dialog = page.getByRole("dialog", { name: m.confirm.title });
  await dialog.getByRole("button", { name: m.confirm.accept }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: m.result.done })).toBeVisible();
  expect(domainCalls).toEqual([]);
  // The API still refuses the administrator any portfolio row of another account.
  const own = await page.request.get("/api/v1/portfolio/accounts");
  expect(own.ok()).toBe(true);
  expect(JSON.stringify(await own.json())).not.toContain("XTB E2E");
});
