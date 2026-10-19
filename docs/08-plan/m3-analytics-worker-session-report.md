# M3 — worker analityki (BL-311, BL-317): stan bieżący

**Cel:** przekazać stan kontraktów zadań `analytics`, walidacji w workerze i wektorów B–D, dowody i warunki zamknięcia.

**2026-10-19**, `feat/m3-analytics-worker`, [PR #16](https://github.com/Ipper18/OligInvest/pull/16) (roboczy). Wykonawca: Claude Code (decyzja właściciela z 2026-09-24). Statusy `w toku` do zielonego CI i wspólnego DoD.

## Zrobione i dowody

- **BL-311:** `packages/contracts/src/analytics-jobs.ts` — sześć typów zadań (`.strict()`, `v: 1`), limity Z-19, limity czasu, koperta wyniku `failed`; eksport `analytics-jobs.schema.json` do paczki workera (`pnpm gen:analytics-schema`, kontrola `pnpm check:analytics-schema` w `contracts.yml` i w Vitest). Worker: `contracts.py` (kształt JSON, rozmiar, `jsonschema` 4.26 z `re.ASCII`, odpowiedniki `.refine`), `execution.py`/`runner.py` (proces potomny bez sekretów, zabijany po limicie czasu), konsument kolejki `analytics` → `analytics-results`. Kontrakt opisany w [moduly.md § 5.2.1](../01-architektura/moduly.md).
- **Izolacja:** `infra/tests/analytics-isolation-probe.py` w `scripts/ci-images.mjs` — HTTP/TCP na zewnątrz zablokowane; `oliginvest_analytics_ro` czyta `market.*` z `data_quality_issues`, bez portfela, `analytics_runs`, watchlist, `auth`, zapisów i `CREATE`. Lokalnie: sonda PASS w sieci `internal`, a w zwykłym bridge wykrywa wyjście (kontrola negatywna). Limity CPU/RAM bez zmian w `compose.yaml` (2 rdzenie, 1,5 GB).
- **BL-317:** `test_reference_vectors.py` — B (TWR, annualizacja, XIRR), C (max DD, seria, indeksy), D (14 metryk z remisami) kontra empyrical-reloaded 0.5.12; empyrical zgodny z definicjami § 8.
- Testy: contracts Vitest 97/97 (78 wspólnych przypadków); pytest 128 PASS + 1 pominięty (wymaga Compose); ruff, mypy --strict, wheel z plikiem schematu; zmienione pakiety TS i zależne `lint typecheck test` PASS (`db#test` wymagał wcześniejszego buildu `data-providers` w świeżym checkoutcie — niezwiązane). Pętla workera na prawdziwym Valkey sprawdzona lokalnie w kontenerach; pełne `pnpm queues:test` (Node → Python) — w CI.

## Decyzje właściciela (2026-10-19)

- Limity czasu `goal` 120 s, `stress_test` 60 s, `what_if` 30 s (OpenAPI podawało tylko MC/optymalizację/backtest).
- Zlib dopuszczone wyłącznie dla numpy (SEC § 4.4, STACK § 7, `deps-audit.py`).
- `peewee` (martwa zależność empyrical, tylko sdist) wykluczone przez `[tool.uv] exclude-dependencies`.

## Odchylenia i ograniczenia

- Host Windows bez `uv` i Pythona 3.13: testy Pythona w kontenerze z przypiętych obrazów projektu (python 3.13.13, uv 0.12.16, node 24.21).
- Uzupełnienia metadanych licencji (pandas, scipy, bottleneck, empyrical) dopisane z wyprzedzeniem; potwierdzi audyt zależności w CI.
- Poza zakresem: logika analiz i wynik `done` (BL-313), produkcja zadań w `api` i zapis wyników w `jobs` (BL-312), połączenie workera z bazą (pierwszy odczyt danych w BL-313). Worker zużywa kolejkę `analytics` także w produkcji; do BL-313 poprawne zadanie kończy się `INTERNAL`.
- Przegląd metodologiczny § 7 nie dotyczy (brak funkcji predykcyjnej). Bez nowych usług, kosztów i ADR.
