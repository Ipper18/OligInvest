import { expect, test } from "@playwright/test";

test("dark is the default regardless of OS, theme changes persist and system follows the OS", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  const response = await page.goto("/");
  expect(await response?.text()).toContain('data-theme="dark"');
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(11, 13, 15)");
  await expect(page.getByText("+ wzrost — próbka koloru", { exact: true })).toHaveCSS(
    "color",
    "rgb(63, 185, 80)",
  );
  await page.getByLabel("Motyw", { exact: true }).selectOption("light");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(250, 250, 247)");
  await expect(page.getByText("+ wzrost — próbka koloru", { exact: true })).toHaveCSS(
    "color",
    "rgb(26, 127, 55)",
  );
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByLabel("Motyw", { exact: true }).selectOption("system");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(11, 13, 15)");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(250, 250, 247)");
  await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute(
    "content",
    "#fafaf7",
  );
});

test("palette updates without navigation and remains server-rendered after reload", async ({
  page,
}) => {
  await page.goto("/");
  let navigations = 0;
  page.on("framenavigated", () => navigations++);
  await page.getByLabel("Paleta", { exact: true }).selectOption("colorblind");
  await expect(page.getByText("+ wzrost — próbka koloru", { exact: true })).toHaveCSS(
    "color",
    "rgb(90, 169, 255)",
  );
  expect(navigations).toBe(0);
  const response = await page.reload();
  expect(await response?.text()).toContain('data-palette="colorblind"');
});

test("invalid preferences fall back to the default in the initial HTML", async ({
  context,
  page,
}) => {
  await context.addCookies([
    { name: "oi-test-theme", value: "invalid", url: "http://127.0.0.1:3197" },
    { name: "oi-test-palette", value: "invalid", url: "http://127.0.0.1:3197" },
  ]);
  const response = await page.goto("/");
  const html = await response?.text();
  expect(html).toContain('data-theme="dark"');
  expect(html).toContain('data-palette="standard"');
});

test("system fonts, readable controls and keyboard focus work at mobile and desktop widths", async ({
  page,
}) => {
  for (const width of [360, 768, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(page.locator("body")).toHaveCSS("font-family", /system-ui/);
    await expect(page.locator("h1")).toHaveCSS("font-family", /Iowan Old Style/);
    await expect(page.locator("select").first()).toHaveCSS("font-size", "16px");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Motyw", { exact: true })).toBeFocused();
    await expect(page.getByLabel("Motyw", { exact: true })).toHaveCSS(
      "outline-color",
      "rgb(90, 169, 255)",
    );
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("select").first()).toHaveCSS("transition-duration", "0s");
  await page.screenshot({ path: "../../.git/bl011-dark.png", fullPage: true });
  await page.getByLabel("Motyw", { exact: true }).selectOption("light");
  await page.screenshot({ path: "../../.git/bl011-light.png", fullPage: true });
});
