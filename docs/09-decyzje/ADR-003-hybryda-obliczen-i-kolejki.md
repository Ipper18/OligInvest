# ADR-003: Obliczenia w `packages/core` (TS) + izolowany worker Python; kolejki BullMQ na dwóch instancjach Valkey

- **Status:** zaakceptowana
- **Data:** 2026-09-18
- **Decydent:** właściciel projektu (hybryda wybrana w Kroku 0)
- **Powiązane wymagania:** FR-03.05–FR-03.10, FR-04.02–FR-04.09, NFR-01.05, NFR-01.07, NFR-02.06, NFR-03.13, NFR-08.02, NFR-08.05

## Kontekst

Specyfikacja wymaga jednej implementacji obliczeń finansowych dla wszystkich platform (§4.4) i jednocześnie zaawansowanych analiz (Monte Carlo, optymalizacja Markowitz/Black-Litterman/risk parity, backtest), dla których najlepsze darmowe biblioteki istnieją wyłącznie w Pythonie (vectorbt, PyPortfolioOpt + cvxpy, quantstats). Właściciel wybrał hybrydę. Trzeba rozstrzygnąć: co liczy TypeScript, a co Python; jak się komunikują; jak ograniczyć ryzyko, że worker Pythona (duży łańcuch zależności naukowych) stanie się wektorem ataku lub przyczyną niespójnych wyników; oraz czym realizować kolejki.

## Rozważane opcje

| Opcja | Zalety | Wady |
|---|---|---|
| **A. TS core + Python tylko do ciężkich analiz, komunikacja kolejką BullMQ** | Wyniki portfela liczone raz (TS), także offline w PWA; Python robi to, w czym jest najlepszy; jeden system kolejek dla dwóch runtime'ów | Dwa runtime'y w CI i obrazach |
| B. Wszystko w TS | Jeden runtime | Brak dojrzałych odpowiedników PyPortfolioOpt/cvxpy/vectorbt — duże ryzyko błędów numerycznych |
| C. Wszystko w Pythonie (FastAPI) | Jeden ekosystem naukowy | `core` nie działa w przeglądarce/PWA; sprzeczne z decyzją z Kroku 0 |
| D. Python jako usługa HTTP wywoływana synchronicznie | Prosty model | Długie obliczenia w ścieżce żądania (łamie NFR-01.05), brak kolejki i priorytetów |

Kolejki: BullMQ (Node + oficjalny port Python) vs pg-boss (tylko Node) vs Celery (tylko Python) vs kolejka w PostgreSQL pisana samodzielnie.

## Decyzja

1. **Podział obliczeń.** `packages/core` (TS, `decimal.js`) jest jedynym źródłem prawdy dla: pieniędzy i przeliczeń FX, partii FIFO i średniej, pozycji i wycen, P/L, TWR, XIRR, obsunięć, podstawowych metryk ryzyka, wskaźników technicznych, rebalancingu i warunków alertów. `apps/analytics` (Python) liczy wyłącznie: Monte Carlo, optymalizację portfela, backtesty, testy warunków skrajnych, analizy „co jeśli” oparte na historii, raporty quantstats. Metryki wspólne dla obu światów weryfikujemy **wspólnymi wektorami testowymi** (`packages/test-vectors`, JSON) uruchamianymi w Vitest i pytest.
2. **Izolacja workera Python.** Kontener `analytics` nie ma dostępu do internetu (sieć Docker bez bramy wychodzącej), łączy się z PostgreSQL rolą `analytics_ro` z prawem `SELECT` wyłącznie na tabelach danych rynkowych, a dane użytkownika (wagi, przepływy, parametry) otrzymuje w treści zadania. Wynik oddaje jako zadanie w kolejce `analytics-results`, które `jobs` zapisuje w kontekście RLS właściciela. Walidacja wejścia: JSON Schema eksportowany z Zod (`z.toJSONSchema`) i biblioteka `jsonschema`.
3. **Kolejki: BullMQ** (Node 6.3 / Python 3.2) na **Valkey 9**. Ponieważ BullMQ wymaga `maxmemory-policy noeviction` (inaczej traci zadania), a cache potrzebuje wypierania LRU, uruchamiamy **dwie instancje**: `valkey-queue` (kolejki, liczniki kwot dostawców; `noeviction`, AOF co 1 s) i `valkey-cache` (cache L2, pub/sub dla SSE i flag; `allkeys-lru`, bez trwałości).
4. **Zdarzenia po commit + siatka bezpieczeństwa.** Moduły dodają zadania do kolejek dopiero po zatwierdzeniu transakcji; handlery są idempotentne; nocne pełne przeliczenie pozycji i wycen naprawia skutki ewentualnie utraconego zdarzenia (świadomie rezygnujemy z wzorca transactional outbox — mniej warstw przy akceptowalnym ryzyku, bo stan pochodny zawsze da się odbudować z operacji).
5. **Limity zasobów.** `analytics`: współbieżność 1, limit CPU 2 rdzenie i 1,5 GB RAM, limit czasu per typ zadania; parametry ograniczone (np. ≤ 10 000 ścieżek MC, ≤ 500 kombinacji w backteście) — Z-19.

## Konsekwencje

- Pozytywne: wyniki portfela identyczne w UI, API, PWA i alertach; najlepsze narzędzia do analiz; skompromitowana biblioteka Pythona nie ma skąd czytać cudzych danych ani dokąd ich wysyłać; ciężkie obliczenia nie spowalniają API.
- Negatywne: dwa runtime'y (obrazy, CI, aktualizacje zależności); utrzymanie wektorów testowych w dwóch językach; payloady zadań muszą być rozsądnie małe (historię rynkową Python czyta sam z bazy).
- Ograniczenie licencyjne: vectorbt ma klauzulę Commons Clause (zakaz sprzedaży) — bez wpływu na użytek prywatny, odnotowane w `10-ograniczenia.md`.
- Zadania: `packages/test-vectors` (M1), eksport JSON Schema kontraktów zadań (M3), konfiguracja sieci i ról DB dla `analytics` (M3), dwie instancje Valkey w `compose.yaml` (M0).

## Weryfikacja

Test CI: kontener `analytics` nie może wykonać żądania HTTP na zewnątrz (oczekiwany błąd) ani `SELECT` z tabeli `transactions` (brak uprawnień). Wektory testowe przechodzą w obu językach z tolerancjami z `obliczenia-finansowe.md`. Symulacja 10 000 ścieżek nie zwiększa p95 odczytów API o więcej niż 20 % (NFR-01.07).
