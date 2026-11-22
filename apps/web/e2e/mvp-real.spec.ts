import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { recordAuthCalls, totp } from "./real-helpers";

test("real invitation → TOTP → XTB worker → reconciled portfolio", async ({
  page,
  request,
  browserName,
}) => {
  test.setTimeout(150000);
  // All three browsers share the loopback peer. Respect the real 5/minute IP
  // quota instead of resetting limiter state or bypassing authentication.
  if (browserName !== "chromium") await delay(60250 - (Date.now() % 60000));
  const path = process.env.E2E_BROWSER_FIXTURE;
  if (!path) throw new Error("Run through pnpm ci:e2e");
  const fixture = JSON.parse(readFileSync(path, "utf8"))[browserName];
  await page.goto(`/rejestracja#t=${fixture.token}`);
  await page.getByLabel("Imię lub nazwa", { exact: true }).fill("Browser E2E");
  await page.getByLabel("E-mail", { exact: true }).fill(fixture.email);
  await page.getByLabel("Hasło", { exact: true }).fill(fixture.password);
  await page.getByLabel("Akceptuję regulamin.", { exact: true }).check();
  await page.getByLabel("Potwierdzam zapoznanie się z informacją o przetwarzaniu danych.").check();
  await page.getByRole("button", { name: "Załóż konto", exact: true }).click();
  await expect(page).toHaveURL(/\/konfiguracja-2fa/);
  const blocked = await page.request.get("/api/v1/portfolio/accounts");
  expect(blocked.status()).toBe(403);
  expect((await blocked.json()).code).toBe("MFA_ENROLLMENT_REQUIRED");
  await page.getByLabel("Hasło", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: "Włącz drugi składnik", exact: true }).click();
  await expect(page.locator(".oi-secret")).toBeVisible();
  const secret = await page.locator(".oi-secret").innerText();
  await page.getByLabel("Kod z aplikacji", { exact: true }).fill(totp(secret));
  await page.getByRole("button", { name: "Potwierdź kod", exact: true }).click();
  await expect(page.locator(".oi-backup-codes li")).toHaveCount(10);
  await page.getByRole("button", { name: "Kody zapisane", exact: true }).click();
  await expect(page).toHaveURL("/");
  recordAuthCalls();
  expect((await request.get("/api/v1/portfolio/accounts")).status()).toBe(401);

  await expect(page.getByText("Aktualizacje na żywo", { exact: true })).toBeVisible();
  await page.goto("/portfel/rachunki/nowy");
  await page.getByLabel("Nazwa rachunku", { exact: true }).fill("XTB E2E");
  await page.getByLabel("Broker", { exact: true }).selectOption("xtb");
  await page.getByRole("button", { name: "Zapisz", exact: true }).click();
  await expect(page).toHaveURL(/\/portfel\/rachunki$/);
  const accounts = await (await page.request.get("/api/v1/portfolio/accounts")).json();
  const account = accounts.data.find((a: { name: string }) => a.name === "XTB E2E");
  expect(account).toBeTruthy();

  await expect(page.getByText("Aktualizacje na żywo", { exact: true })).toBeVisible();
  await page.goto("/portfel/import");
  const started = Date.now();
  await page
    .getByLabel("Plik eksportu", { exact: false })
    .setInputFiles(
      fileURLToPath(
        new URL(
          "../../../modules/portfolio/test/fixtures/anonymized/xtb/xtb-syntetyczny-nowy-szablon-PLN.xlsx",
          import.meta.url,
        ),
      ),
    );
  await page.getByRole("button", { name: "Wczytaj plik", exact: true }).click();
  await expect(page).toHaveURL(/\/portfel\/import\/[0-9a-f-]+$/);
  const importId = new URL(page.url()).pathname.split("/").at(-1);
  await expect(page.getByRole("button", { name: "Edytuj", exact: true })).toHaveCount(1, {
    timeout: 30000,
  });
  await expect(page.getByRole("button", { name: "Zatwierdź import", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Edytuj", exact: true }).click();
  await page.getByLabel("Rozstrzygnięcie", { exact: true }).selectOption("include");
  await page.getByLabel("Ilość", { exact: true }).fill("15");
  await page.getByRole("button", { name: "Zapisz", exact: true }).click();
  await expect(page.getByRole("button", { name: "Zatwierdź import", exact: true })).toBeEnabled();
  const preview = await (await page.request.get(`/api/v1/portfolio/imports/${importId}`)).json();
  expect(preview.reconciliation.ok).toBe(true);
  expect(preview.reconciliation.cash[0].computed.amount).toBe("14518.27");
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations,
  ).toEqual([]);
  await page.getByRole("button", { name: "Zatwierdź import", exact: true }).click();
  await expect(page).toHaveURL("/portfel");
  await expect(page.getByRole("table", { name: "Pozycje", exact: true })).toBeVisible();
  expect(Date.now() - started).toBeLessThan(120000);
  const positions = await (
    await page.request.get(`/api/v1/portfolio/positions?accountId=${account.id}`)
  ).json();
  expect(positions.data.length).toBeGreaterThan(0);
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations,
  ).toEqual([]);
  await expect(page.getByText("Aktualizacje na żywo", { exact: true })).toBeVisible();
  // BL-112: an ordinary account gets 403 from the admin API (role before step-up) and 404 pages.
  const admin = await page.request.get("/api/v1/admin/users");
  expect(admin.status()).toBe(403);
  expect((await admin.json()).code).toBe("FORBIDDEN");
  expect((await page.goto("/admin/uzytkownicy"))?.status()).toBe(404);
  await expect(page.getByRole("link", { name: "Administracja", exact: true })).toHaveCount(0);
  const origin = new URL(page.url()).origin;
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post("/api/v1/portfolio/" + path, {
      data,
      headers: { origin, "Idempotency-Key": crypto.randomUUID() },
    });
    expect(response.status()).toBe(201);
    return response.json();
  };
  const cashAccount = await post("accounts", {
    name: "Alert E2E",
    accountType: "regular",
    broker: "other",
    currency: "PLN",
  });
  await post("targets", {
    name: "Allocation E2E",
    accountId: cashAccount.id,
    targets: [{ assetClass: "equity", weight: "1" }],
  });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/alerty/nowy");
  await page
    .getByRole("combobox", { name: "Warunek", exact: true })
    .selectOption("allocation_drift");
  await page.getByRole("button", { name: "Dalej" }).press("Enter");
  await page.getByLabel("Próg", { exact: false }).fill("0.10");
  await page.getByRole("button", { name: "Podgląd powiadomienia" }).press("Enter");
  await expect(page.getByRole("heading", { name: "Podgląd powiadomienia" })).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations,
  ).toEqual([]);
  await page.getByRole("button", { name: "Zapisz regułę" }).press("Enter");
  await expect(page).toHaveURL("/alerty");
  await post("transactions", {
    accountId: cashAccount.id,
    type: "DEPOSIT",
    amount: { amount: "100", currency: "PLN" },
    tradeDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw" }).format(new Date()),
  });
  await expect
    .poll(async () => {
      const response = await page.request.get("/api/v1/alerts/events");
      return (await response.json()).data.some(
        (event: { deliveries: { channel: string; status: string }[] }) =>
          event.deliveries.some((d) => d.channel === "email" && d.status === "sent"),
      );
    })
    .toBe(true);
  await page.getByRole("link", { name: "Historia wyzwoleń i doręczeń" }).click();
  await expect(page.getByText(/E-mail · Wysłano/)).toBeVisible();
  // BL-413: sign-out moved from the shell header to Settings.
  await page.goto("/ustawienia");
  await page.getByRole("button", { name: "Wyloguj się", exact: true }).click();
  await expect(page).toHaveURL(/\/logowanie$/);
  expect((await page.request.get("/api/v1/portfolio/accounts")).status()).toBe(401);
});
