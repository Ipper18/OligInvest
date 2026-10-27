# M4 — backend: stan bieżący

**Cel:** przekazać stan BL-403/404/405 i backendu BL-407/408 oraz poprawki CI [PR #38](https://github.com/Ipper18/OligInvest/pull/38).

**2026-10-27**, `feat/m4-backend`, osobny worktree. Scalony `origin/main` do `52ca91a` (#23), po wcześniejszych #37/#36/#39. #40 przy końcowym fetchu nadal poza main. Statusy `w toku` do zielonego CI i wspólnego DoD.

## Zakres i wcześniejsze poprawki

Powiadomienia e-mail/fallback, cisza i deduplikacja; rezerwa 50 z 300 prób SMTP/dobę. Alerty cenowe, histereza/cooldown, blokada stale/BLOCK, fakty bez kwot portfela i zaleceń. PAT z hash-only/CSPRNG, step-up, zakresami i przypomnieniami; replay bez sekretu. Pięć `/quick/*`, tekstowe pieniądze, niepełne dane jako 200/null/incomplete/powody.

TS2883 usunięto jawnymi typami, bez zmiany tsconfig. Test monitoringu konfiguruje limiter Valkey i sprawdza wyczerpanie puli. **Test ujawnił błąd produkcyjny:** adapter BullMQ/ioredis wymaga nazw metod `incr`/`expire`, a `INCR`/`EXPIRE` powodowały TypeError. Poprawiono wywołania, zachowując limity i odmowę przy braku konfiguracji. Zależności zaktualizowano wyłącznie przez merge #37.

## Przyczyna timeoutu importu quick-actions i naprawa

`quick-actions/server` importował wartości z całych eksportów `portfolio/server` i `market/server`: oprócz potrzebnego odczytu uruchamiał ładowanie tras HTTP, importów brokerskich, przeliczania portfela i schematów DB. W grafie był także cykl `market/routes → watchlist-routes → routes`; nie stwierdzono zakleszczenia, lecz nadmiarowe ładowanie i transformację przy równoległych testach.

API przekazuje teraz istniejące `readPortfolio` i instancję `MarketRepository` do `QuickRepository`. W quick-actions pozostały wyłącznie importy typów tych implementacji. RLS, wycena i walidacja są współdzielone; nie skopiowano logiki ani nie przeniesiono ciężkiego importu na pierwsze żądanie. Publiczne eksporty fundamentów i granice modułów pozostają zgodne z MOD.

Pojedynczy lokalny pomiar zimnego importu Node: **362 → 298 modułów, 428 → 277 ms** (diagnostyka, nie p95). Serwerowe pliki obu fundamentów i wskazany cykl nie są już osiągalne podczas importu quick-actions. Pozostają wymagane kontrakty, Zod/OpenAPI, Decimal, SQL i platforma. Test regresji blokuje dołączenie eksportów serwerowych i sprawdza wstrzyknięte odczyty portfela/notowań: przed poprawką FAIL, po poprawce PASS. **Nie podniesiono żadnego timeoutu**, także dla pojedynczego smoke.

## Dowody bieżącej poprawki

- Polecenia z kroku definicji joba db: lint/typecheck/test/build dla db, API i wszystkich modułów, dodatkowo `--force`, domyślna równoległość: **51/51 PASS, zero cache**. Smoke `public entry point: server`: **468 ms** przy limicie 5000 ms; quick-actions 9/9 testów.
- `pnpm db:test`: PASS, PostgreSQL 18.6, izolacja/RLS, rzeczywiste trasy PAT/quick i wycena, zero różnic schematu.
- Build API, OpenAPI (93 implemented / 92 pending), klient, granice modułów i dokumentacja: PASS. Wcześniejsze pełne buildy bez alerts/quick-actions po 21/21 PASS.
- Jedno końcowe sprawdzenie CI po pushu; bez pollingu. Anulowane matrix.check/matrix.name ignorowane zgodnie z decyzją właściciela. Zgłoszone błędy „WebKit encountered an internal error” to znane **R-41**; bez zmian WebKit/E2E w tej poprawce. `uv` dostępne, testów Pythona/obrazów/E2E nie powtarzano dla tej zmiany importów.

## Pozostało

PWA/Web Push, ekrany (także PAT), Skróty i testy urządzeń w kolejnej paczce; M4 niezamknięte. Estymata paczki 11,5 dnia obejmuje odłożony ekran PAT, rzeczywisty nakład niezmierzony. Bez nowego ADR i nowych ryzyk; pozostaje **R-45** (duplikat SMTP po awarii między wysłaniem a potwierdzeniem).
