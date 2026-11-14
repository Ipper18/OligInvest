# BL-306 — stan sesji

**Cel:** przekazać stan ekspozycji walutowej i rozbicia wyniku na efekt ceny i efekt kursu (FR-02.06) oraz dowody weryfikacji.

**2026-11-14**, gałąź `feat/bl-306-fx-exposure`, worktree `OligInvest-wt/bl-306`. Draft PR #78; status `w toku` do CI i przeglądu właściciela; M3 pozostaje otwarty.

## Zakres i decyzje

Rozbicie per pozycja (§ 4.2, `listPositions`) było już na main; brakowało ekspozycji i sum. `getAllocation` należy do BL-207, więc dodano osobną operację `GET /portfolio/currency-exposure` (`getCurrencyExposure`, nowa ścieżka w OpenAPI; lista pending bez zmian). Wzór § 4.2.1: pozycje według waluty notowania, gotówka według waluty salda, zamknięcia EOD (bez notowań opóźnionych), kurs średni NBP z dnia wyceny lub wcześniejszy z datą, źródłem i numerem tabeli. Rdzeń: `core.currencyExposure`, `core.priceFxEffectsByCurrency`, `core.sumPriceFxEffects`; moduł korzysta ze wspólnego `valuationState` i `valuePortfolio` (bez nowego odczytu wycen), a efekt pozycji wyciągnięto do `positionEffect` współdzielonego z `listPositions`.

Brak ceny lub kursu → wartość segmentu w PLN, suma i udziały `null` z powodem (`missing_price`, `missing_fx`), nigdy 0. Brak kosztu → pozycja poza sumami bez zerowania wiersza (spójnie z decyzją 2026-10-08). Bez wiersza kompletnego suma rozbicia ma kwoty `null`, nie 0. Cudzy rachunek → 404.

**Decyzja właściciela Z-29 (2026-11-14):** (1) pozycje na rachunku w walucie instrumentu zostają w ekspozycji, ale są wyłączone z rozbicia cena/kurs — w API jawna adnotacja `decomposition.notSplit` (waluta, liczba pozycji, powód `missing_cost_pln`) i wyłączenia z tym powodem, na ekranie adnotacja widoczna bez rozwijania tabel („brak kosztu w PLN … to nie jest 0”); efekt kursu nigdy nie jest raportowany jako 0. Powód `account_currency` z pierwszej wersji PR zastąpiono `missing_cost_pln` (operacja nie była jeszcze na main). (2) BL-306b w backlogu: koszt w PLN z kursu średniego NBP z ostatniego dnia roboczego przed transakcją (§ 2.2), potem włączenie do rozbicia. Zapisane w `wymagania.md` (Z-29), § 4.2.1 i OpenAPI.

Ekran `/portfel/wyniki`: sekcja po obsunięciach, PL/EN w `performance.json` (poza globalnym payloadem i18n), DataFreshness z atrybucją „Kursy: NBP”, blok założeń (grupowanie, waluta notowania ETF, wzór efektów), istniejący disclaimer `general` 2026-09. Tabele zwinięte w `<details>` i renderowane na serwerze — bez wykresu i bez JS klienta; P/L ze znakiem, nie tylko kolorem.

## Dowody lokalne

- Core: **252 testy PASS**, linie **99,59 %**, funkcje 100 %; wektor A (pozostałość 3 szt., koszt 2 261,25 PLN) dla ekspozycji i tożsamości efektów.
- Portfolio: testy jednostkowe projekcji (wektor A, brak ceny/kursu/kosztu, pusty portfel, 404, data z przyszłości) PASS.
- OpenAPI: **25/25 PASS**, 108 operacji zaimplementowanych / 79 pending; klient wygenerowany.
- PostgreSQL 18 (`pnpm db:test`, ponowione po zmianie semantyki „brak kosztu” i decyzji Z-29): integracja z kursem i numerem tabeli NBP, efekty 76/44 PLN, brak kursu → wiersz i suma rozbicia null, rachunek USD z akcją USD → `notSplit` i `missing_cost_pln` przy zachowanej ekspozycji (2 920 PLN), obcy rachunek/admin 404, 401, 422 — **PASS**; porównanie schematu **ZERO DIFFERENCES**.
- E2E wyników: **15/15 PASS** (po decyzji Z-29 ponownie), Chromium/WebKit/Firefox; PL/EN, kurs i numer tabeli NBP, efekty 113,06/145,69 PLN, tabele zwinięte, axe, brak kursu, adnotacja Z-29 bez rozwijania tabel i brak danych.
- Lint/typecheck/test zmienionych pakietów i zależnych: **63/63 zadań PASS**; `check:contracts`, `check:docs`, `check:ui-text`, `check:deps`, `check:api-client`, `check:repository` PASS.
- Budżety PASS: `/` **158,76/190 KiB**, `/portfel` **168,51/195**, `/portfel/wyniki` **170,17/195**, powłoka **29,82/30**; w początkowych chunkach brak kodu BL-306 (sekcja tylko na serwerze). R-53 bez pogorszenia.
- Grep sekretów przed commitem: tylko 4 znane syntetyczne trafienia.

## Pozostałe

Draft PR do main; CI sprawdzane na końcu. Bez zmian w identity, migracjach db, jobs, manifestach i lockfile; bez nowych bibliotek, retry, timeoutów i obniżania progów. Przegląd metodologiczny § 7 nie dotyczy (wycena bieżąca, nie FR-04). Nowe ryzyka: brak; zastrzeżenie Z-29. Estymata 1,5 d bez zmian, nakład i odchylenie niezmierzone.
