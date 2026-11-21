# BL-551 + BL-304 — stan sesji

**Cel:** przekazać następnej sesji stan paczki BL-551 (metryki ryzyka) i BL-304 (benchmark) oraz przyjęty projekt, aby praca ruszyła bez ponownej analizy.

**2026-11-21**, gałąź `feat/bl-551-risk-metrics` (z `origin/main` 419b7df), worktree `OligInvest-wt/risk-pkg`, `pnpm install --frozen-lockfile` PASS. Sesja przerwana limitem użycia po analizie — **kod nie powstał**, PR nie istnieje.

## Ustalenia z analizy

- Rdzeń § 8 gotowy w `packages/core/src/risk.ts` (`riskMetrics`, `sharpeRatio`, `historicalVar`/`Cvar`, `beta`, `correlation`) i `risk-free.ts` (`riskFreeRateOn`, seria `NBP:REF_RATE` w `market.macro_observations`). Nie duplikować.
- Wzorzec end-to-end: BL-305 (commit 6673585) — `modules/portfolio/src/server/drawdown.ts` na `readValuationSeries` z `performance.ts`, kontrakt `drawdown-contracts.ts` (Zod `.openapi`), trasa w `read-routes.ts`, sekcja serwerowa `apps/web/src/portfolio/drawdown-section.tsx` + leniwy uPlot (`drawdown-chart.tsx`, `packages/ui`), teksty `packages/i18n/src/{pl,en}/performance.json`, testy `modules/portfolio/test/*.test.mjs`, integracja `modules/portfolio/integration/*.mjs` (wywoływana z `apps/api/integration/portfolio.mjs`), E2E `apps/web/e2e/performance.spec.ts` + `apps/web/test/portfolio-fixture.mjs`.
- `getRiskMetrics` jest w `openapi-pending.json`; schemat `RiskMetrics` (openapi.yaml ok. l. 5943) ma liczby — do zmiany na ciągi dziesiętne jak BL-303/305; brak odpowiedzi 404 (dodać). `getPerformance.benchmark` (l. 5550) ma `twr`/`sameFlowsXirr` jako liczby — do zmiany; `readValuationSeries` dziś zwraca 422 dla `benchmarkId`.
- Benchmarki: `modules/market/src/benchmarks.ts`, `MarketRepository.benchmarks()` (uniwersum `benchmarks`), ceny `market.bars_daily` (`close × adjustment_factor`), kursy `market.fx_rates` (NBP preferowany jak w `valuationState`).

## Projekt do realizacji (decyzje samodzielne do PR)

1. Stopy i metryki w JSON jako ciągi dziesiętne (precedens BL-303/305, polecenie właściciela) — poprawić `openapi.yaml`, odnotować przy § 0.1.
2. Zwroty: indeks TWR (`twrIndex`) próbkowany w dni robocze pon.–pt. (weekend wchodzi w poniedziałek), tygodniowo — ostatni dzień tygodnia; P = 252/52. Funkcja próbkowania w `packages/core` z testem.
3. Stopa wolna od ryzyka: `riskFreeRate` z zapytania albo `riskFreeRateOn("PLN", …, to)` stała w oknie; brak → Sharpe `null` z powodem `risk_free_missing`, nigdy 0. Pokazać serię, datę obowiązywania, częstotliwość, okno, annualizację, liczbę obserwacji (< 60 → ostrzeżenie „mało danych”).
4. Beta/korelacja tylko z wybranym `benchmarkId` (bez domyślnego indeksu), inaczej `null` z powodem `no_benchmark`; BLOCK z § 14 → ostrzeżenie `data_quality_hold` (FR-03, nie FR-04).
5. BL-304: symulacja „te same przepływy” w `packages/core` (Decimal), nowy wektor `I_benchmark_same_flows` w `docs/03-dane/wektory-testowe.json` (aktualizacja `packages/test-vectors` i `apps/analytics/.../vectors.py` + testów liczby kluczy); seria porównawcza ≤ 3000 punktów.
6. Obie sekcje na `/portfel/wyniki` zwinięte (`<details>`), uPlot po rozwinięciu + tabela; `mapa-ekranow.md` — przenieść `getRiskMetrics` z `/portfel/ryzyko` do `/portfel/wyniki` (polecenie właściciela).

## Pozostało

Całość implementacji, testy (wektor D przez API, PostgreSQL/RLS, E2E w 3 przeglądarkach, budżety), backlog, przegląd § 7.3 w PR, draft PR i CI.
