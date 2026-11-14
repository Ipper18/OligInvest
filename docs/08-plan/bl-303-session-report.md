# BL-303 — stan sesji

**Cel:** przekazać implementację wyników portfela, dowody weryfikacji i otwarte punkty DoD.

**2026-11-14**, `feat/bl-303-performance`, worktree `OligInvest-bl-303`, baza `233b129` z `origin/main`. Status `w toku` do CI i przeglądu właściciela; M3 nie jest zamykany.

## Zrobione

- `GET /portfolio/performance`: portfel zbiorczy lub rachunek, PLN lub waluta pojedynczego rachunku, dowolny zakres i osiem okresów. Wyłącznie istniejący core: historia, łańcuchowy TWR, annualizacja, przepływy inwestora i XIRR. Kwoty pozostają Decimal, stopy JSON są ciągami.
- RLS: cudzy rachunek także dla admina daje 404. Luki wartości, przepływów, dni i brak pierwszego recompute nie są zerami. Transfery między wybranymi rachunkami klasyfikuje core, również przy różnych datach nóg.
- Osobna `/portfel/wyniki`: tabela TWR/XIRR i istniejący P/L ekonomiczny/podatkowy, filtry dat/rachunku/waluty, PL/EN, założenia, EOD i disclaimer. Brak nowych odczytów na `/` i `/portfel`; teksty wyników poza globalnym payloadem tłumaczeń.
- OpenAPI, pending, wygenerowany klient, konwencje API i mapa ekranów zaktualizowane. Bez zmian zależności, plików BL-613, wzorów core ani schematu bazy.

## Dowody

- Lint/typecheck/unit dla zmienionych pakietów i zależnych: **66/66 zadań PASS**; portfolio 56 testów (8 nowych), API 93, i18n 42. Wektor B i granica 29/30 dni, annualizacja od 365 dni, luki i niezmienność wcześniejszego wyniku po zmianie późniejszych wycen.
- `pnpm db:test`: **PASS**, PostgreSQL 18, rzeczywiste RLS/404, waluty, transfer w drodze i brak wycen rachunku; schema comparison **ZERO DIFFERENCES**.
- Produkcyjny build web/API, kontrakty OpenAPI (25 testów; 100 operacji, 86 pending), aktualność klienta, granice modułów i kontrola tekstów: **PASS**.
- E2E wyników: **9/9 PASS**, Chromium/WebKit/Firefox, PL/EN, daty, XIRR < 30 dni, luki i axe.
- Budżety tras **PASS**: `/` 158,75/190 KiB gzip; `/portfel` i `/portfel/wyniki` 168,49/195; powłoka 29,82/30. Lighthouse, mediana z 3: LCP `/` 1802,680 ms, `/portfel` 1352,756 ms; wszystkie cztery trasy i pozostałe metryki PASS. R-53 pozostaje monitorowany przez CI, bez zmiany progów, retry lub timeoutów.
- Grep sekretów z CLAUDE.md: cztery istniejące trafienia syntetycznych fixtures, bez nowych trafień względem HEAD.

## Otwarte i decyzje

Właściciel 2026-11-13 odroczył `instrumentId` do osobnej metodologii pozycji; parametr jawnie zwraca 422. Benchmark to BL-304 (również jawne 422). XIRR `period_too_short` realizuje decyzję 2026-09-24. Nowy ADR i nowe ryzyko: brak. Przegląd metodologiczny FR-04 nie dotyczy historycznych stóp. Estymata 2 d bez zmian, nakład niezmierzony. Do wspólnego DoD pozostają CI i przegląd właściciela; pełny odbiór M3 poza tą sesją.
