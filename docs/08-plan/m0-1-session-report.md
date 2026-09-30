# M0-1 — stan bieżący

**Cel:** przekazać stan i następny krok; wcześniejsze dowody w [historii](m0-1-session-history.md).

**2026-09-30**, gałąź `feat/m0-1-skeleton`, [roboczy PR #2](https://github.com/Ipper18/OligInvest/pull/2), bez scalania. Node 24.21.0, pnpm 12.4.2, Python 3.13.13; uv `.git/tools/uv-0.12.16/uv.exe` musi być w PATH. `packages/core` bez zmian — osobny PR #3.

## BL-016 — wykonane lokalnie

Lighthouse 13.5.0, size-limit/file/esbuild 14.0.0, esbuild 0.28.2 i chrome-launcher 1.2.1 w manifeście oraz lockfile; frozen PASS bez wyjątków karencji. Launcher 1.2.2 jeszcze niedojrzały. Budżety wszystkich wzorców PERF §3, pokrycie manifestu, gzip -9 bez noModule, markery sześciu rodzin bibliotek, podsumowanie CI. Brak trasy = OCZEKUJE; nowa trasa bez budżetu, brak fixture, redirect i błąd HTTP = błąd pomiaru. Testy negatywne i rzeczywisty zminifikowany Zod: 9 PASS. Leniwe/razem wymagają interakcji M1, wartości zapisane w konfiguracji.

size-limit sprawdza UI (15 KiB) i współdzielone UI+i18n (30 KiB, część przyszłej powłoki BL-121). Pomiar wykrył runtime import decimal.js do rozpoznawania Decimal: poprawiono i18n na import typu i zgodny znacznik biblioteki, bez zmiany pieniędzy/core. UI 4,35 kB i UI+i18n 5,75 kB (wyjście size-limit, jednostki dziesiętne). Initial JS: `/` 131,34 KiB, `/ui-preview` 130,52 KiB. Lighthouse: mediana 3 przebiegów mobilnych `/`: LCP 1897 ms, TBT 40 ms, CLS 0; raport M0, twarde asercje i wymóg 4 tras przez `lighthouse:assert` od M1. Cookies/surowe raporty nie są publikowane. Kroki podłączone do CI web, wynik po push do sprawdzenia.

Dowody lokalne: monorepo 88/88 (31 cache), i18n 14, ui 9, web 9 testów, Chromium 11/11 i axe bez naruszeń PASS. Granice, dokumentacja, repo, diff check PASS. Logi `.git/bl016-*.log`. Status `w toku` do CI i wspólnego DoD; estymacja 2 d bez zmiany, odchylenie nakładu niezmierzone. Bez nowego ADR/ryzyka.

## Paczka i następny krok

Dalej BL-033: powtarzalny pomiar Next.js/Zod/natywnych prymitywów i aktualizacja PERF §2. Potem BL-018, pełne CI BL-017, ustawienia BL-019, pozostałe BL-035. M0 otwarty: kryteria 1–3 mają dowody, 4–7 wymagają dalszych prac/właściciela, 8 częściowo.

BL-001–015/034 wykonane lokalnie, BL-032 technicznie zamknięty. BL-012: słowniki, skaner tekstów i natywne UI, zatwierdzone uzupełnienia TXT; BL-011: CSP nonce, klient server-only, motywy. Prywatny generator `tools/openapi-client`: TS 5.9.3, aplikacje TS 7.0.2 (R-20). Baza: RLS/audyt, 12 testów pul, ZERO DIFFERENCES; queues:test/db:seed:test/dev:test PASS. Analytics: izolacja systemowa od M3, dziś pytest blokuje gniazda poza Valkey. Ruleset disabled. Serwery i ustawienia GitHub bez zmian.
