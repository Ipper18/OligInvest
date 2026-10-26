# M2-UI — stan bieżący

**Cel:** przekazać stan BL-202/203/204/205/207/214/216 i ekranów rynku.
**2026-10-26**, `feat/m2-ui`, [roboczy PR #17](https://github.com/Ipper18/OligInvest/pull/17).
Statusy `w toku` do zielonego CI i wspólnego DoD; nakład/odchylenie niezmierzone. M2 nie jest zamknięte.

## Synchronizacja z main

- Scalono `origin/main` do `f6adccd`: PR #25 (Zod/łatka Caddy), dokumentację #26–#31 i #32 (pgBackRest 2.59.3, Caddy bez curl, R-43). Poprawki WebKit z wcześniejszego merge #18 pozostają zachowane. PR #17 nie jest scalany do main.
- Jedyny konflikt: backlog. Zachowano statusy odbioru właściciela z main, w tym BL-208; względem main dodano wyłącznie statusy siedmiu zadań M2-UI. BL-207 nadal obejmuje UI, backend/integracja w osobnej sesji.
- Education wyrównano do Zod **4.6.7**, również rozstrzygnięcie peer dependency `@hono/zod-openapi`. Pierwszy test wykrył pozostały po automatycznym merge wpis peer 4.6.5; przeliczenie lockfile usunęło konflikt typów. Brak nowych wersji innych pakietów względem scalonego lockfile.
- Frozen install PASS. `lint typecheck test --filter=...[origin/main] --concurrency=3`: **66/66 PASS**. OpenAPI **68 implemented / 117 pending**, test kontraktu **25/25 PASS**, typy klienta aktualne. Granice modułów PASS; initial budgets PASS, powłoka **28,96/30 KiB**. Limity i asercje bez zmian.
- W tej sesji nie powtarzano E2E, DB ani skanowania obrazów; pełną macierz wykonuje CI. Wcześniej po #18 WebKit powłoka/auth/onboarding **15/15 PASS**, onboarding razem **185,18/190 KiB**, driver **7,12/8**. Końcowy odczyt `gh pr checks` raz po pushu — wynik w odpowiedzi sesji.

## Zakres paczki

- BL-202: SMA/EMA/BB/RSI/MACD/ATR z core na pełnej serii przed decymacją; leniwe nakładki/panele, parametry i tabela. BL-203/204: 57 treści MDX, pierwsze 30 haseł, synonimy, objaśnienia metryk i test pokrycia kluczy.
- BL-205: watchlisty REST/UI, kolejność, notatki, idempotencja i RLS. BL-214: historia NBP USD/EUR, numery tabel i oznaczenie danych ECB. `/rynek`: benchmarki, źródła/opóźnienia, WARN/BLOCK; rozszerzenie DataMeta zatwierdzone przez właściciela.
- BL-216: leniwy, pomijalny i powtarzalny driver.js, stan per użytkownik; wyłączony moduł daje 404. BL-207: wyłącznie UI zgodne z OpenAPI, nieaktywne pola z komunikatem; backend/integracja osobna sesja zgodnie z decyzją właściciela. Bez nowych zmian w portfolio/analytics.
- Wcześniejsze dowody: OpenAPI 68 implemented / 117 pending, typy aktualne; `db:test` PASS (watchlisty 3 × 50, onboarding, RLS, ZERO DIFFERENCES); nowe E2E trzech przeglądarek PASS; build API/web bez education i frozen lockfile PASS. Szczegóły w opisie PR.

## Pozostałe warunki

Backend/integracja BL-207, renderowanie 50 pozycji <100 ms i odbiór czytnikiem ekranu pozostają otwarte. Cały M2 wymaga pięciu lat benchmarków, realnego eksportu mBank, 20 sesji kompletności GPW i pomiaru p95 SSE. Bez nowych ADR, usług, kosztów i kategorii ryzyka; nadal R-10 (budżety JS) i R-37 (symbole benchmarków).
