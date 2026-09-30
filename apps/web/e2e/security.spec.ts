import { expect, test } from "@playwright/test";

test("dynamic documents use unique nonces on every script, including a 404", async ({
  request,
}) => {
  const nonces = new Set<string>();
  for (const path of ["/", "/", "/missing-test-page"]) {
    const response = await request.get(path, {
      headers: { "x-nonce": "spoofed", "content-security-policy": "spoofed" },
    });
    expect(response.status()).toBe(path === "/" ? 200 : 404);
    const csp = response.headers()["content-security-policy"] ?? "";
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|https?:|spoofed/);
    const nonce = csp.match(/'nonce-([^']+)'/)?.[1] ?? "";
    expect(nonce).toBeTruthy();
    expect(nonces.has(nonce)).toBe(false);
    nonces.add(nonce);
    const html = await response.text();
    const scripts = [...html.matchAll(/<script\b[^>]*>/g)];
    expect(scripts.length).toBeGreaterThan(0);
    for (const [script] of scripts) expect(script).toContain(`nonce="${nonce}"`);
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(response.headers()["x-powered-by"]).toBeUndefined();
  }
});

test("browser resources stay on origin and RSC forwards the request context", async ({
  browser,
  request,
}) => {
  const id = crypto.randomUUID();
  const context = await browser.newContext({
    locale: "pl-PL",
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { "X-Request-Id": id, "Accept-Language": "pl-PL" },
  });
  try {
    await context.addCookies([
      { name: "session", value: "synthetic-e2e", url: "https://127.0.0.1:3197" },
    ]);
    const page = await context.newPage();
    const urls: string[] = [];
    const fonts: string[] = [];
    const errors: string[] = [];
    page.on("request", (req) => {
      urls.push(req.url());
      if (req.resourceType() === "font") fonts.push(req.url());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto("https://127.0.0.1:3197");
    await expect(page.getByText("API: proces działa.")).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(errors).toEqual([]);
    expect(fonts).toEqual([]);
    expect(urls.some((url) => url.includes("/_next/static/"))).toBe(true);
    expect(urls.every((url) => new URL(url).origin === "https://127.0.0.1:3197")).toBe(true);
    // Next creates its accessibility announcer with CSSOM styles after hydration.
    expect(
      await page
        .locator(
          "style:not([nonce]), [style]:not(next-route-announcer):not(#__next-route-announcer__)",
        )
        .count(),
    ).toBe(0);
    const forwarded = await (await request.get("http://127.0.0.1:3198/last-request")).json();
    expect(forwarded.cookie).toContain("session=synthetic-e2e");
    expect(forwarded["x-request-id"]).toBe(id);
    expect(forwarded["accept-language"]).toBe("pl-PL");
  } finally {
    await context.close();
  }
});

test("CSP refuses a script without the response nonce", async ({ page }) => {
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      document.documentElement.dataset.blockedDirective = event.effectiveDirective;
    });
  });
  await page.route("https://127.0.0.1:3197/", async (route) => {
    const response = await route.fetch();
    const html = await response.text();
    await route.fulfill({
      response,
      body: html.replace(
        "</head>",
        "<script>document.documentElement.dataset.unsafeScript = 'executed'</script></head>",
      ),
    });
  });
  await page.goto("/");
  expect(await page.locator("html").getAttribute("data-unsafe-script")).toBeNull();
  await expect(page.locator("html")).toHaveAttribute("data-blocked-directive", /script-src/);
});
