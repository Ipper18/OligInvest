# M3 — backend analiz (BL-302, BL-312, BL-313, BL-318, BL-319): stan bieżący

**Cel:** przekazać stan backendu historii wartości, stopy wolnej od ryzyka, modułu uruchomień analiz i Monte Carlo — dowody, decyzje i otwarte pytania.

**2026-10-20**, `feat/m3-analytics-backend`, [PR #19](https://github.com/Ipper18/OligInvest/pull/19) (roboczy). Wykonawca: Claude Code (decyzja właściciela z 2026-09-24). Statusy `w toku` do zielonego CI i wspólnego DoD; bez `apps/web`.

## Zrobione i dowody

- **BL-302:** migracja 0007 (`total_value_pln`, `external_flow`, `external_flow_pln` nullable), recompute zapisuje `NULL` zamiast 0, przepływy liczone per rachunek i dzień; `portfolioHistory` (`packages/core`, 7 testów) i `GET /portfolio/history` (integracja PostgreSQL: wartości, luki `null`, przepływy, 422, izolacja).
- **BL-319:** `FredProvider` (`api.stlouisfed.org` na allowliście, `.` = brak wartości), zadanie `market.macro` 06:00 (bez `FRED_API_KEY` pomijane), `oli-admin risk-free-rate` (audyt przed/po, walidacja), `riskFreeRateOn` (krok NBP, `DGS3MO` stale po 7 dniach, brak → `null`).
- **BL-312:** sześć operacji `/analytics/*` zgodnych 1:1 z `openapi.yaml` (zdjęte z pending), rola `user` → 403, limit dzienny → 429, idempotencja, typy bez implementacji → 404; migawka z zapisanych wycen i proxy (XWAR → WIG, reszta → S&P 500). Właściciel w `analytics_runs.user_id`; `jobs` odczytuje go funkcją `analytics.run_owner` (SECURITY DEFINER, tylko kontekst `system`, migracja 0008, scenariusz w `testy-rls.sql`, katalog bezpieczeństwa) i zapisuje wynik, postęp i błąd w RLS właściciela; stan końcowy nienadpisywany; SSE `analytics.run.*`. `pnpm db:test` PASS, porównanie schematu: zero różnic.
- **BL-313:** `montecarlo.py` + `market_data.py` + postęp/anulowanie w `execution.py`; pytest 148 PASS (determinizm ziarna, monotoniczność wrażliwości, podatek, wyczerpanie, długość bloków, 10 000 ścieżek × 30 lat < 1 s), ruff, mypy `--strict`. Ręcznie na PostgreSQL 18 (`schema.sql`, rola `analytics_ro`): wszystkie zapytania, przebieg end-to-end do wyniku `done` zgodnego z kontraktem i `DATA_QUALITY_HOLD` przy otwartym `BLOCK`; sonda izolacji w CI wykonuje te zapytania na obrazie produkcyjnym.
- **BL-318 (część MC):** przegląd `strategy-critique` (ryzyko MEDIUM) i `backtest-review` (werdykt FIX) w opisie PR; ujawnienia wdrożone (`COSTS_NOT_MODELLED`, `CONCENTRATION_NOT_MODELLED`, typ zwrotu proxy).

## Decyzje właściciela (2026-10-20)

`DATA_QUALITY_HOLD` w `AnalyticsRun.error.code`; kolumny luk nullable; stopa NBP przez CLI; pełny backfill WIG i S&P 500; właściciel uruchomienia z rekordu (`run_owner`), bez przeszukiwania `identity.user_directory`.

## Decyzje 2026-10-20 (druga runda) — wdrożone

1. Jednorazowy backfill tabel A NBP od 2002 (`market.fx-backfill`, ≤ 93 dni na żądanie, 5 żądań na uruchomienie, postęp w `quota:nbp:backfill:*`).
2. Proxy USA `^SP500TR` (**NIEZWERYFIKOWANE**), pełna historia; bez notowań → `^GSPC` z ostrzeżeniem `PROXY_PRICE_INDEX` i założeniem `usEquityProxy`.
3. Parametr `annualCostRate` (0–5 %, domyślnie 0) odejmowany raz w roku, widoczny w założeniach i w każdym wierszu tabeli wrażliwości; prowizje transakcyjne później.
4. Build „bez analytics”: moduł tylko w `optionalDependencies` aplikacji, ładowany w `src/modules.ts` z tolerancją braku pakietu; reguła w `check:deps` (testy) i `moduly.md` § 2. Sprawdzone lokalnie na kopii bez `modules/analytics`.
5. Przy okazji: ACL `valkey-queue` dla `jobs` nie dopuszczał kluczy `benchmark:*` i `report:*` używanych od M2 (produkcyjny zapis znaczników i raportu GPW byłby odrzucony) — dodane z testem.

Pozostaje (bez blokady): wrażliwość na długość bloku bootstrapu, tabela per kryzys (BL-556), prowizje transakcyjne.

## Odchylenia i ograniczenia

- Testy Pythona w obrazie `oliginvest-pydev:local` (Python 3.13.13, uv 0.12.16); `EXE002` lokalnie pomijane (bity wykonywalności montowania Windows).
- p95 API przy 10 000 ścieżkach (NFR-01.07) i czas na serwerze (< 20 s) — do pomiaru po wdrożeniu; BL-316 (komunikaty UI) i BL-314 (ekran) poza zakresem.
