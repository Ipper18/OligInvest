# M2-UI — stan bieżący

**Cel:** przekazać stan BL-202/203/204/205/207/214/216 i ekranów rynku.
**2026-10-23**, `feat/m2-ui`, [roboczy PR #17](https://github.com/Ipper18/OligInvest/pull/17).
Statusy `w toku` do zielonego CI i wspólnego DoD; nakład/odchylenie niezmierzone. M2 nie jest zamknięte.

## Scalenie i naprawa CI

- Merge `origin/main` (`31b5f3f`, PR #18) zapisany i wypchnięty jako `f5b0e1e`. Zachowano poprawki WebKit i auth z main. Jedyny konflikt: test zgodności tekstów — obie strony miały 30 s; przyjęto wspólną stałą `BULK_TEST_TIMEOUT_MS` z main, bez zmiany asercji.
- Odczyt nieudanych kroków i ich raportów: `deps-audit` 39671596120 blokował Vite 8.3.0 / GHSA-587h-7wmj-h5pm (7,5; poprawka od 8.3.3). Merge wprowadza 8.3.4. `images` 39671595910 blokował Caddy z Go 1.26.9 / GO-2026-6809 (brak oceny CVSS, kontrola odrzuca nieznaną ocenę); poprawka od 1.26.10, obecna w scalonym Dockerfile. Nie dodano wyjątków audytu ani nie zmieniono progów.
- Frozen install PASS. Kontrole zmienionych pakietów i zależnych: 55/56 PASS, jedyny błąd skanu chunków wynikał z nałożenia dwóch lokalnych buildów. Po zakończeniu buildów komplet web **36/36 PASS**, bez zmian w teście. Granice modułów PASS; produkcyjny build web PASS.
- WebKit: powłoka/auth oraz onboarding **15/15 PASS** (axe, klawiatura, zapis/replay, bramki i returnTo). Initial budgets PASS; powłoka **28,96/30 KiB**; onboarding razem **185,18/190**, driver **7,12/8**. Limity bez zmian.
- Końcowy odczyt `gh pr checks` raz po ostatnim pushu; wynik w odpowiedzi sesji. Pełne audyty zależności i obrazów pozostawiono CI; lokalnie potwierdzono poprawione wersje względem zakresów w raportach błędów.

## Zakres paczki

- BL-202: SMA/EMA/BB/RSI/MACD/ATR z core na pełnej serii przed decymacją; leniwe nakładki/panele, parametry i tabela. BL-203/204: 57 treści MDX, pierwsze 30 haseł, synonimy, objaśnienia metryk i test pokrycia kluczy.
- BL-205: watchlisty REST/UI, kolejność, notatki, idempotencja i RLS. BL-214: historia NBP USD/EUR, numery tabel i oznaczenie danych ECB. `/rynek`: benchmarki, źródła/opóźnienia, WARN/BLOCK; rozszerzenie DataMeta zatwierdzone przez właściciela.
- BL-216: leniwy, pomijalny i powtarzalny driver.js, stan per użytkownik; wyłączony moduł daje 404. BL-207: wyłącznie UI zgodne z OpenAPI, nieaktywne pola z komunikatem; backend/integracja osobna sesja zgodnie z decyzją właściciela. Bez nowych zmian w portfolio/analytics.
- Wcześniejsze dowody: OpenAPI 68 implemented / 117 pending, typy aktualne; `db:test` PASS (watchlisty 3 × 50, onboarding, RLS, ZERO DIFFERENCES); nowe E2E trzech przeglądarek PASS; build API/web bez education i frozen lockfile PASS. Szczegóły w opisie PR.

## Pozostałe warunki

Backend/integracja BL-207, renderowanie 50 pozycji <100 ms i odbiór czytnikiem ekranu pozostają otwarte. Cały M2 wymaga pięciu lat benchmarków, realnego eksportu mBank, 20 sesji kompletności GPW i pomiaru p95 SSE. Bez nowych ADR, usług, kosztów i kategorii ryzyka; nadal R-10 (budżety JS) i R-37 (symbole benchmarków).
