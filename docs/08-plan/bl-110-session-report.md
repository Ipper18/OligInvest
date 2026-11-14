# BL-110 — zdarzenia bezpieczeństwa i reguły anomalii: stan sesji

**Cel:** przekazać stan BL-110 (NFR-03.10) — co wdrożono, jak to sprawdzono i jakie decyzje czekają na właściciela.

**2026-11-13**, gałąź `feat/bl-110-security-events` z `origin/main` 233b129, wykonawca Claude Code, draft [PR #74](https://github.com/Ipper18/OligInvest/pull/74). Status **w toku** do zielonego CI, wspólnego DoD i odpowiedzi na § 4.

## 1. Stan zastany (backlog był aktualny co do BL-110)

- Kolejka `events` dostawała `two_factor_recovery_*`, ale nikt jej nie konsumował; logowania nie trafiały do audytu.
- Gotowe klocki: `platform.audit_log` z RLS (BL-109), lista sesji (BL-105), moduł `notifications` z `kind = security` (zawsze e-mail, bez cichych godzin, deduplikacja po `sourceRef`, limit 300/dobę — BL-403), limity IP i blokada TOTP.
- BL-114 (eksport RODO) nie istnieje — masowy eksport zrobiony jako punkt rozszerzenia.

## 2. Zakres

- `modules/identity/src/domain/security-rules.ts`: progi `SECURITY_RULES` i czyste funkcje (rodzina przeglądarki/systemu, klucz urządzenia, seria nieudanych prób, masowy eksport).
- `apps/api/src/auth/security-monitor.ts`: zapis `auth.sign_in`, `auth.sign_in_failed`, `auth.2fa_failed`, `session.new_device`, `security.failed_sign_in_series`, `identity.export_requested`, `security.mass_export` w audycie (kontekst RLS konta, blokada doradcza per konto) i kolejkowanie e-maili `security`.
- `AuthService`: przekazuje do monitora nieudane hasło, nieudany drugi czynnik przy logowaniu, zakończone logowanie i odzyskanie 2FA; ocena w tle (bez sygnału czasowego enumeracji).
- Teksty PL/EN w `packages/i18n` (`auth-mail.json`); bez kwot, bez linków logowania, pełny adres IP nigdy w e-mailu.
- Bez nowych zależności, tabel, migracji i zmian OpenAPI. Dokumenty: SEC § 5.3 (stan wdrożenia), AUTH § 3 i § 12, THR § 8, plan reagowania P1, R-57.

## 3. Weryfikacja (lokalnie, Windows)

| Sprawdzenie | Wynik |
|---|---|
| `modules/identity` vitest | 9/9 (w tym 4 testy reguł) |
| `packages/i18n` vitest (zgodność kluczy PL/EN, język) | 41/41; `check-ui-text` OK |
| `apps/api` tsc + vitest | 0 błędów; 93/93 |
| `pnpm db:test` (PostgreSQL 18, RLS, wszystkie integracje + `security-events.mjs`) | PASS — wszystkie integracje, w tym „BL-110 security events…: PASS”; porównanie schematu: zero różnic |
| `pnpm check:deps`, Biome na zmienionych plikach | OK; czysto (2 ostrzeżenia sprzed zmian w `identity-routes.ts`, `pat-service.ts`) |

Test integracyjny: 12 równoległych porażek → jeden e-mail; cooldown; porażki poza oknem; izolacja RLS (cudze zdarzenia niewidoczne i nieliczone); linia bazowa, nowa sieć, nowa przeglądarka, aktualizacja wersji; eksport (wolumen, kombinacja, e-mail tylko do administratorów raz na dobę); deduplikacja e-maili odzyskania; pełny przepływ przez fasadę (hasło, TOTP, nieznane konto bez śladu).

## 4. Pytania do właściciela i decyzje (2026-11-14)

1. **Definicja „nowego urządzenia”:** para (rodzina przeglądarki + systemu, prefiks /24 lub /48) nieobecna w 90 dniach. Nowa sieć przy tej samej przeglądarce też wysyła e-mail (ochrona przed pośrednikiem phishingu) — kosztem fałszywych alarmów w sieciach komórkowych (R-57). Akceptujesz, czy wolisz „nowa przeglądarka **i** nowa sieć”?
2. **Odbiorcy alertu masowego eksportu:** wszyscy aktywni administratorzy, identyfikacja konta przez UUID (bez e-maila w treści). Wystarczy?
3. **Reguły poza zakresem** (wiele kont z jednego IP, seria nieudanych step-upów, zmiany administracyjne, naruszenie RLS) — osobne zadania czy dopisać do BL-110?
4. **Link w e-mailach** prowadzi do `/ustawienia`; sekcja sesji powstanie w BL-123. Zmienić adres, gdy BL-123 doda kotwicę?

**Decyzje właściciela (2026-11-14):** 1 — definicja zostaje, przegląd po 2 tygodniach w R-57 (ewentualnie „nowa przeglądarka oraz nowa sieć”); 2 — wszyscy aktywni administratorzy, konto po UUID; 3 — osobne zadanie BL-110b w backlogu; 4 — link do kotwicy sesji dopisany do BL-123. Zapisane w SEC § 5.3, R-57 i backlogu.

## 5. CI

`dast` na PR #74 czerwony z powodu spoza BL-110: ZAP 10010 na ciasteczku `oi-locale` (`apps/web/src/proxy.ts`, obszar BL-613); ten sam błąd na PR #73. Naprawę przyniósł PR #67 (scalony 2026-11-14); gałąź zaktualizowana scaleniem `origin/main` (konflikt tylko w `ryzyka.md`: R-56 z `main` + R-57 z tej gałęzi). PR #73 (zależności) był wtedy jeszcze otwarty.
