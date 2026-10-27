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
| Wykonanie | FIX → flaga | wycena na zamknięciach bez modelu płynności sprzedaży — flaga `illiquid` i ograniczenie w `10-ograniczenia.md` |

## Zakres i dowody

*(uzupełniane na koniec sesji)*
