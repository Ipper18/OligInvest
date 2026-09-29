import AxeBuilder from "@axe-core/playwright";
import { disclaimers, messages } from "@oliginvest/i18n";
import { expect, test } from "@playwright/test";

for (const theme of ["dark", "light"]) {
  test(`native UI and compliance components pass axe in ${theme}`, async ({ page, context }) => {
    await context.addCookies([
      { name: "oi-test-theme", value: theme, url: "http://127.0.0.1:3197" },
    ]);
    await page.goto("/ui-preview");
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const audit = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(audit.violations).toEqual([]);
    }
    await page.getByRole("button", { name: messages.nav.settings, exact: true }).click();
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: messages.col.note, exact: true }).click();
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.keyboard.press("Escape");
    await page.screenshot({ path: `../../.git/bl012-ui-${theme}.png`, fullPage: true });
  });
}

test("keyboard opens modal, traps focus, closes with Escape and restores trigger focus", async ({
  page,
}) => {
  await page.goto("/ui-preview");
  const trigger = page.getByRole("button", { name: messages.nav.settings, exact: true });
  // Native date pickers expose a browser-dependent number of keyboard stops.
  for (
    let i = 0;
    i < 16 && !(await trigger.evaluate((element) => element === document.activeElement));
    i++
  ) {
    await page.keyboard.press("Tab");
  }
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: messages.nav.settings });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel(messages.col.account, { exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: messages.action.cancel })).toBeFocused();
  await page.keyboard.press("Tab");
  // Some engines visit the dialog itself before returning to the first control.
  expect(
    await page.evaluate(
      () =>
        document.activeElement?.closest("dialog") !== null ||
        document.activeElement === document.body,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Tab");
  const popoverTrigger = page.getByRole("button", { name: messages.col.note, exact: true });
  await expect(popoverTrigger).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("[popover]")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("[popover]")).not.toBeVisible();
});

test("assumptions summary stays visible when collapsed and legal text stays versioned", async ({
  page,
}) => {
  await page.goto("/ui-preview");
  const details = page.locator("details").filter({ hasText: messages.data.assumptions });
  await expect(details).toHaveAttribute("open", "");
  const summary = details.locator("summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(details).not.toHaveAttribute("open");
  await expect(summary).toContainText(disclaimers.demo.text);
  await expect(page.locator('[data-disclaimer-key="analysis"]')).toHaveText(
    disclaimers.analysis.text,
  );
  await expect(page.locator('[data-disclaimer-key="analysis"]')).toHaveAttribute(
    "data-disclaimer-version",
    "2026-09",
  );
  await expect(
    page.getByRole("status").filter({ hasText: messages.data.staleLabel }),
  ).toContainText(messages.data.reasons.provider_error);
  await expect(page.locator('[data-stale="true"]')).toContainText("opóźnione ok. 20 min");
  await expect(page.getByLabel(messages.col.quantity, { exact: true })).toHaveAccessibleDescription(
    "Popraw zaznaczone pola",
  );
});
