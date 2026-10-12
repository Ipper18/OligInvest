import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("private pages reject an absent or invalid session before rendering shell HTML", async ({
  page,
  context,
  baseURL,
}) => {
  for (const invalid of [false, true]) {
    if (invalid)
      await context.addCookies([
        {
          name: "__Host-oliginvest.session_token",
          value: "invalid-session",
          url: baseURL ?? "https://127.0.0.1:3197",
          secure: true,
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);
    const response = await page.goto("/ustawienia");
    await expect(page).toHaveURL("/logowanie?returnTo=%2Fustawienia");
    expect(await response?.text()).not.toContain('class="oi-shell"');
    await expect(page.locator(".oi-shell")).toHaveCount(0);
  }
});

test("production page and API dependencies are ready with Compose", async ({ page, request }) => {
  test.skip(!process.env.E2E_API_URL, "Compose integration runs through pnpm ci:e2e");
  const ready = await request.get(`${process.env.E2E_API_URL}/api/v1/health/ready`);
  expect(ready.status()).toBe(200);
  expect(await ready.json()).toEqual({
    status: "ok",
    checks: { postgres: "ok", valkeyQueue: "ok", valkeyCache: "ok" },
  });
  const response = await page.goto("/ui-preview/bootstrap");
  expect(response?.status()).toBe(200);
  await expect(page.getByText("API: proces działa.")).toBeVisible();
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(result.violations).toEqual([]);
});
