# M3 — testy warunków skrajnych i kalkulator celu (BL-556, BL-560): stan bieżący

**Cel:** przekazać stan backendu testów skrajnych i kalkulatora celu — przegląd metodologiczny wykonany przed implementacją, zakres, dowody, decyzje i otwarte pytania.

**2026-10-27**, `feat/m3-stress-goal`. Wykonawca: Claude Code (decyzja właściciela z 2026-09-24). Tylko backend (worker, kontrakty, OpenAPI, testy, dokumentacja); bez ekranów (redesign UI w przygotowaniu).

## Przegląd metodologiczny przed implementacją (AGENTS.md § 7)

### `strategy-critique` — ocena ryzyka: **MEDIUM** (behawioralne i regulacyjne)

| # | Obawa | Scenariusz porażki | Wprowadzona mitygacja |
|---|---|---|---|
| 1 | Hipoteza testu historycznego czytana jako „najgorszy przypadek” | „−32 % w 2008” odebrane jako dolna granica ryzyka | wynik = przedział ścieżki w oknie (dno i szczyt) oraz wartość na końcu okna; ostrzeżenie `HISTORICAL_PATH_NOT_WORST_CASE` w każdym wyniku |
| 2 | Proxy ukrywa ryzyko pojedynczej spółki | mała spółka GPW zmapowana na WIG traci w 2008 ok. 2× więcej niż indeks | per pozycja `series` (`instrument`/`proxy`/`none`), `ownHistoryRatio`, ostrzeżenie `PROXY_SUBSTITUTED` z udziałem wartości |
| 3 | Próg pokrycia 80 % jest pusty, gdy proxy pokrywa wszystko | pokrycie 100 % przy zerowej własnej historii | `coverageRatio` liczone bez gotówki, obok `ownHistoryRatio` |
| 4 | Ryzyko USD/PLN maskuje wynik lokalny | w 2008 słabnący złoty „zamortyzował” spadek akcji USA w PLN | zwroty w PLN (kursy NBP) i równolegle `localReturnRatio` w walucie notowania |
| 5 | Beta z okresu spokoju niedoszacowuje kryzysu (ukryta krótka korelacja) | w krachu korelacje → 1, beta rośnie | przedział bety 90 %, osobny szok korelacji, ostrzeżenia `LINEAR_SINGLE_FACTOR` i `LOW_FACTOR_FIT` (R² < 0,3) |
| 6 | Szok korelacji na rozkładzie normalnym ma cienkie ogony | P5 miesięczny zaniża skrajne straty | jawne założenie i ostrzeżenie `NORMAL_TAILS`; porównanie z korelacjami historycznymi (`baselineRange`) |
| 7 | Niepłynne serie (świece bez obrotu) zaniżają zmienność i stratę | spółka bez transakcji „nie spadła” w 2008 | flaga `illiquid` pozycji i ostrzeżenie `ILLIQUID_SERIES` (> 20 % sesji okna bez transakcji, `no_trades`; tylko własna seria) |
| 8 | Kalkulator celu czytany jako obietnica | „wpłacaj 1 200 zł i będziesz mieć 500 000 zł” | trzy poziomy p jako przedział, tabela wrażliwości (±2 p.p., okna, długość bloku), ostrzeżenie `MODEL_PROBABILITY`, cel także w złotych dzisiejszych (`targetReal`) |
| 9 | Pominięty podatek i koszty zaniżają wymaganą wpłatę | procent składany bez Belki i TER | `taxMode` (domyślnie `belka_simplified`) i `annualCostRate` w parametrach celu; ostrzeżenia kosztowe jak w MC |
| 10 | Okno scenariusza po dniu migawki (look-ahead) | admin definiuje okno kończące się „jutro” | odmowa 422, gdy okno kończy się w dniu migawki lub później |

Pytania do właściciela przed udostępnieniem ekranów: (1) czy ostrzeżenie `CRISIS_TESTS_UNAVAILABLE` w MC zastąpić informacją `CRISIS_TESTS_SEPARATE` (testy są teraz osobną analizą) — wdrożone, do potwierdzenia; (2) czy domyślny zestaw scenariuszy historycznych (§ 12.3) uzupełnić o 2011 i 2015 (CHF/PLN); (3) czy kalkulator celu ma pokazywać wpłatę stałą nominalnie zamiast indeksowanej inflacją (domyślnie indeksowana).

### `backtest-review` — werdykt przed implementacją: **FIX** → po poprawkach zasadny

| Punkt | Wynik | Ustalenie i poprawka |
|---|---|---|
| Look-ahead | PASS po poprawce | beta i rozkłady tylko z pełnych miesięcy przed miesiącem migawki; okno scenariusza musi kończyć się przed dniem migawki (422); test: dane po migawce nie zmieniają wyniku |
| Survivorship | NIEJASNE → ujawnienie | dzisiejsze pozycje to z definicji „ocalałe” — własna historia instrumentu z 2008 bywa lepsza niż średnia; obok zwrotu własnego pokazujemy `proxyReturnRatio` |
| Przeuczenie | PASS | brak optymalizacji; jedyny estymowany parametr to beta (60 obserwacji na parametr), `N = 1` |
| Koszty | PASS / FIX | test skrajny to wycena bez transakcji (koszty nie dotyczą); w celu `annualCostRate`, prowizje od wpłat poza modelem — ostrzeżenie `TRANSACTION_COSTS_NOT_MODELLED`/`COSTS_NOT_MODELLED` |
| Reżimy | PASS | test skrajny jest analizą reżimów; cel ma wiersze `last_10y`/`full_history` i długości bloku |
| Wielkość pozycji | PASS | bieżące wagi z migawki, bez dźwigni, kupno i trzymanie w oknie (bez rebalancingu) — jawne założenie |
| Wykonanie | FIX → flaga | wycena na zamknięciach bez modelu płynności sprzedaży — flaga `illiquid` i jawne założenie w § 12.3 (kupno i trzymanie, wycena na zamknięciach) |

## Zrobione i dowody

- **Dokument przed kodem:** `obliczenia-finansowe.md` § 12.3 i § 12.6 (implementacja, znaki kwot, wybór serii, pokrycie, beta, szok korelacji, dokładny kwantyl wpłaty); OpenAPI: `StressTestResult` (statusy, przedziały, `series`, `ownHistoryRatio`, liczby `null` przy odmowie), `GoalParams` (+`indexToInflation`, `taxMode`, `annualCostRate`), `GoalResult` (+`targetReal`, `alreadyMet`, tabela wrażliwości, kwota `null` poza zakresem), `StressScenario` jako płaski obiekt.
- **Worker (`apps/analytics`):** `stress.py` (`stress-1.0.0`, deterministyczny), `stress_data.py` (tylko tabele `market`, kursy wyłącznie NBP w oknach dziennych, `no_trades` jako sygnał niepłynności), `goal.py` (`goal-1.0.0`, ziarno PCG64), `COVERAGE_TOO_LOW` z procesu potomnego. pytest **180 PASS** (+29: ręcznie policzony przykład okna, dane po oknie nie zmieniają wyniku, tolerancja krawędzi 7 dni, odmowa < 80 %, przejście na proxy przy `BLOCK`, beta = `polyfit`, szok korelacji przy ρ = 1, wpłata = granica bisekcji na pełnej symulacji z podatkiem i bez), ruff, mypy `--strict`. Ręcznie na PostgreSQL 16 (minimalne tabele z `schema.sql`): nowe zapytania, loader → JSON → `runner.run` dla `stress_test` i `goal` z wynikiem zgodnym z kontraktem; cel 10 000 ścieżek × 15 lat w 0,89 s (limit 120 s).
- **Kontrakty (`packages/contracts`):** zadania i wyniki obu typów, wspólne fikstury TS ↔ Python (+5 przypadków), schemat JSON workera aktualny; vitest 105 PASS.
- **Moduł (`modules/analytics`) i `api`:** `stress_test` i `goal` w `IMPLEMENTED_TYPES`; scenariusze wbudowane § 12.3 zastępowane lub ukrywane wierszami `analytics.stress_scenarios` (wiersz niepoprawny ukrywa klucz), okno przed dniem migawki, walidacja pól szoku (422 ze ścieżką), `GET /analytics/stress-scenarios` (zdjęte z pending), `jobs` nie zapisuje wyniku innego rodzaju (status `failed`/`INTERNAL` i zdarzenie `failed`). Kontrakt OpenAPI ↔ Zod OK (76 operacji), redocly OK, testy modułu i `api` PASS. Test integracyjny `apps/api/integration/analytics.mjs` rozszerzony (scenariusze admina, odmowy 422, wartości domyślne, zapis wyniku) — **uruchamia CI** (PostgreSQL 18).
- **Przy okazji (własny błąd z PR #19):** rodzic nie przekazywał `tickers` do procesu potomnego, więc `proxySeries`/`proxyReturnType` w MC pokazywały UUID i `unknown` — poprawione; MC: `CRISIS_TESTS_UNAVAILABLE` → `CRISIS_TESTS_SEPARATE` (odesłanie do testów skrajnych).

## Pominięte i dlaczego

- **Ekrany** (BL-314, ekrany testów skrajnych i celu) — redesign UI w przygotowaniu.
- **`adminUpsertStressScenario`** — wydzielone do **BL-567**: trasy admina idą przez `Administration.http` (audyt przed/po, step-up) w transakcji roli `oliginvest_auth`, która nie ma praw do `analytics.*`; wymaga zmiany infrastruktury admina w `apps/api`, poza zakresem tej paczki. Do tego czasu scenariusze admina zmienia się w tabeli (R-49).
- **Testy PostgreSQL 18 / Docker** — zostawione CI (sonda izolacji wykonuje nowe zapytania jako `analytics_ro`).

## Odchylenia i uwagi

- `apps/web/src/api/schema.d.ts` — **jedyny** plik w `apps/web`, wygenerowany `pnpm gen:api-client` (CI `contracts` wymaga aktualności); bez zmian kodu ekranów.
- § 12.6 mówi o wyszukiwaniu binarnym; implementacja liczy jego granicę dokładnie (liniowość ścieżek przy wspólnych liczbach losowych), test porównuje z bisekcją — opisane w dokumencie.
- Lokalnie Node 22 zamiast 24 i `xlsx` z rejestru npm zamiast tarballa SheetJS (host zablokowany przez politykę sieci) — tylko do lokalnych kontroli, lockfile i `package.json` bez zmian.

## Decyzje właściciela (2026-10-27)

1. `CRISIS_TESTS_SEPARATE` zamiast `CRISIS_TESTS_UNAVAILABLE` w MC — zaakceptowane.
2. Kalkulator celu: model stały (bootstrap stacjonarny, blok 6 mies., cała historia), wpłata domyślnie indeksowana inflacją (`indexToInflation` można wyłączyć), cel nominalny porównywany z wartością po podatku — zaakceptowane.
3. Szoki hipotetyczne: okno 60 miesięcy, przedział normalny 90 %, szok indeksu w walucie notowania indeksu — zaakceptowane; wpływ kursu przy `index_shock` wyłącznie przez historyczną betę na stopach w PLN, ekran podaje walutę szoku (§ 12.3).
4. Scenariuszy 2011 i 2015 (CHF/PLN) nie dodajemy — portfel nie ma ekspozycji na CHF.

## Nowe ryzyka

R-46 (test skrajny jako „najgorszy przypadek”, ocalali, proxy), R-47 (beta z okresu spokoju), R-48 (wpłata czytana jako obietnica), R-49 (edycja scenariuszy bez audytu do BL-567) — [`ryzyka.md`](ryzyka.md).
