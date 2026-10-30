import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

function totp(base32: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...base32.replace(/=+$/, "")]
    .map((c) => alphabet.indexOf(c).toString(2).padStart(5, "0"))
    .join("");
  const key = Buffer.from(bits.match(/.{8}/g)?.map((b) => Number.parseInt(b, 2)) ?? []);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  return String((digest.readUInt32BE((digest[19] ?? 0) & 15) & 0x7fffffff) % 1000000).padStart(
    6,
    "0",
  );
}

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
  await page.getByRole("button", { name: "Wyloguj się", exact: true }).click();
  await expect(page).toHaveURL(/\/logowanie$/);
  expect((await page.request.get("/api/v1/portfolio/accounts")).status()).toBe(401);
});
