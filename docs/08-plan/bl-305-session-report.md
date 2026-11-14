# BL-305 — stan sesji

**Cel:** przekazać stan obsunięć portfela i weryfikacji FR-03.09.

**2026-11-14**, gałąź `feat/bl-305-drawdowns`, worktree `OligInvest-bl-305`. Status `w toku` do CI i przeglądu właściciela; M3 pozostaje otwarty.

## Zakres i decyzje

`GET /portfolio/drawdown` korzysta ze wspólnego odczytu wycen BL-303 (RLS, transfery, brak pierwszego recompute), `portfolioHistory`, `twrIndex` i `drawdowns`. Pełne dane dzienne → max DD, daty i dni szczyt–dołek–odrobienie; dopiero potem LTTB z zachowaniem dat najgłębszego epizodu. API zwraca ciągi dziesiętne i jawną walutę PLN. Zakres obejmuje poprzednie zamknięcie jako bazę. Brak/luki → null, pusta seria i wyjaśnienie; cudzy rachunek → 404.

Sekcja `/portfel/wyniki`: PL/EN poza globalnym payloadem i18n, założenia, EOD/źródło, istniejący disclaimer general 2026-09. uPlot ładowany po rozwinięciu; tabela po 100 punktów, klawiatura, brak animacji. Obsunięcia zawsze w PLN, jawnie niezależnie od waluty tabeli TWR/XIRR.

Właściciel zaakceptował punktowe rozszerzenia: pending API, raport/backlog, wrapper uPlot w packages/ui, generowane typy klienta i core. Testy list operacji API uzupełnione o nowy endpoint. Core: mnożenie indeksu przez wartość przed dzieleniem przez bazę zapobiega zaokrągleniu 100 → 75 → 100 do 0,999…9998. Wzór, precyzja, tolerancje i progi bez zmian; regresja wymaga dokładnej równości.

## Dowody lokalne

- Frozen install; lint/typecheck/test zmienionych pakietów i zależnych: **63/63 zadań PASS**.
- Core: **248 testów PASS**, linie **99,58%**, funkcje 100%; portfolio **63 testy PASS**, wektor C z packages/test-vectors i empyrical_max_drawdown z referencji.
- OpenAPI: **25/25 testów PASS**, 101 operacji zaimplementowanych / 85 pending; klient wygenerowany.
- PostgreSQL 18: RLS, obcy rachunek/admin 404, brak wycen i luka PASS; porównanie schematu **ZERO DIFFERENCES**.
- E2E wyników: **12/12 PASS**, Chromium/WebKit/Firefox; PL/EN, lazy canvas, tabela, axe, brak danych.
- Build web/API **20/20 PASS**. Budżety PASS: `/` **158,75/190 KiB**, `/portfel` **168,49/195**, powłoka **29,82/30**; brak bibliotek wykresów w początkowych chunkach. R-53 bez pogorszenia.
- Granice zależności, dokumentacja, kontrola repozytorium i diff PASS. Grep sekretów przed commitem: bez nowych trafień.

## Pozostałe

Draft PR do main; CI sprawdzane raz na końcu, pełne macierze i obrazy pozostają w CI. Bez zmian w identity, db, jobs, manifestach i lockfile. Bez nowych bibliotek, retry, timeoutów lub obniżania progów. Nowe ADR/ryzyka: brak; usunięto błąd obliczeń w ramach istniejącego R-07. Estymata 1,5 d bez zmian, nakład i odchylenie niezmierzone. Nie zamykamy etapu M3; zakres FR-04 i jego przegląd metodologiczny nie dotyczy historycznych obsunięć.
