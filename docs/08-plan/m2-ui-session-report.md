# M2-UI — stan bieżący

**Cel:** przekazać stan BL-202/203/204/205/207/214/216 i ekranów rynku.
**2026-10-21**, `feat/m2-ui`, [roboczy PR #17](https://github.com/Ipper18/OligInvest/pull/17).
Zadania pozostają `w toku` do zielonego CI i wspólnego DoD. Nakład i odchylenie niezmierzone; M2 nie jest zamknięte.

## Zrobione

- BL-202: SMA/EMA/BB/RSI/MACD/ATR wyłącznie z core, pełna seria przed decymacją; leniwe kontrolki, nakładki/panele, tabela alternatywna. Test 4001 świec wykrywa obliczenie po decymacji.
- BL-203/204: 57 treści MDX, w tym pierwsze 30 haseł; synonimy, objaśnienia wskaźników i metryk MVP, test pokrycia kluczy, klawiatura i disclaimer.
- BL-205: API i UI list, kolejności, instrumentów i notatek; idempotencja i izolacja RLS. BL-214: historia NBP USD/EUR, numery tabel, oznaczenie zastępczych danych ECB.
- `/rynek`: benchmarki i stan dostawców z PR #15, metadane jakości WARN/BLOCK, źródło i opóźnienie. Właściciel zatwierdził rozszerzenie `DataMeta.qualityStatus` oraz backend market.
- BL-207: widok i pola klasyfikacji zgodne z istniejącym OpenAPI, wejście z portfela. Backend i integracja pozostają osobnej sesji zgodnie z decyzją właściciela; ekran pokazuje brak usługi, pola są nieaktywne. Bez zmian w portfolio/analytics.
- BL-216: leniwy driver.js 1.8.0, zapis per użytkownik, pominięcie i powtórzenie; Tab/Enter/Esc, powrót fokusu, reduced motion. Wyłączenie edukacji daje 404; build działa też po fizycznym usunięciu modułu.
- Commity etapów wypchnięte: edukacja `9a9bdb8`, watchlisty `716263f`, wskaźniki `d04de06`, alokacja `3c6d972`, onboarding `67e2e7e`, metryki `9b4c46b`, wydajność/a11y `ca385eb`.

## Dowody i CI

- Zmienione pakiety i zależne: lint/typecheck/test **56/56 PASS**. OpenAPI **68 implemented / 117 pending**, typy klienta aktualne. Granice modułów, teksty UI i size-limit PASS.
- `db:test` PASS: watchlisty 3 × 50, stan onboardingu, izolacja użytkowników/admina; schemat ZERO DIFFERENCES.
- Nowe E2E: 8 scenariuszy × Chromium/Firefox/WebKit **24/24 PASS**, osobno alokacja **3/3 PASS** po poprawie selektora testu. Axe, klawiatura, zapis/powtórzenie i pomiary pobranego JS.
- Budżety bez zmian: powłoka **29,91/30 KiB**, onboarding razem **184,57/190**, driver **7,12/8**, instrument razem **234,76/280**, wykres **52,48/54**. Initial JS wszystkich wdrożonych tras PASS.
- Produkcyjny build web PASS; build API/web bez education **14/14 PASS**, frozen lockfile bez zmian. Pełny lokalny `ci:build education` ograniczony brakiem `uv`; wariant Python pozostaje w CI.
- Odczytano pięć wcześniejszych nieudanych kontroli: poprawiono oczekiwania listy operacji API, dokumentację WARN/BLOCK i timeout pełnego skanu tekstów. Końcowy odczyt CI po pushu — wynik w odpowiedzi sesji.
- Przed odczytem CI wykonano fetch/merge origin/main: już aktualne (`33204d4`). PR #18 i #21 nadal otwarte podczas sprawdzenia; po ich scaleniu potrzebny merge i weryfikacja. Plików testów sesji WebKit nie nadpisywano.

## Pozostałe warunki

Backend/integracja BL-207, pomiar renderowania 50 pozycji <100 ms i ręczny odbiór czytnikiem ekranu pozostają otwarte. Kryteria M2: pięć lat benchmarków, realny eksport mBank, 20 sesji kompletności GPW i p95 SSE wymagają odbioru poza tą paczką. Bez nowej decyzji ADR, usług i kosztów. Ryzyka istniejące: R-10 (mały zapas JS), R-37 (symbole benchmarków); brak nowych kategorii ryzyka.
