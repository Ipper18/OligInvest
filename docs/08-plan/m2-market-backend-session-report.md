# M2 — backend danych rynkowych: stan bieżący

**Cel:** przekazać stan backendu BL-206, BL-209 i BL-213 (bez `apps/web`), dowody i warunki zamknięcia.

**2026-10-19**, `feat/m2-market-backend`, [PR #15](https://github.com/Ipper18/OligInvest/pull/15) (roboczy). Wykonawca: Claude Code (decyzja właściciela z 2026-09-24). Statusy: `w toku` do zielonego CI i wspólnego DoD; ekran `/rynek` i oznaczenia jakości w UI — Codex.

## Zrobione i dowody

- **BL-209:** `packages/core` — `DATA_QUALITY_RULES` (BLOCK/WARN/INFO z § 14) i `scanMarketSeries`: OHLC, zatwierdzony próg skoku 25 % (bez zmian), świece „martwe” > 5 sesji, wolumen > 20× mediany z 30 sesji. `modules/market` — zapis serii per instrument z historią, luki wg `trading_calendar` (WARN zamykany przy nadejściu świecy), brak instrumentu w pliku GPW, `isin_change` i `currency_change` (GPW i Yahoo) jako BLOCK, `details` w ciągach dziesiętnych; bramka FR-04 `analysisHolds`/`assertAnalysisEligible` → `DATA_QUALITY_HOLD`. Doprecyzowania w `obliczenia-finansowe.md` § 14.
- **BL-206:** katalog 11 benchmarków (6 indeksów FR-01.09 + 5 zamienników ETF) w uniwersum `benchmarks`; zadanie `market.benchmarks` (23:45): backfill 1830 dni jednym żądaniem chart v8 na serię, potem tydzień; ≤ 2 serie/min (20 % kwoty Yahoo) z kontynuacją; `GET /market/benchmarks` (`listBenchmarks`) zgodny z `openapi.yaml`, usunięty z pending. Poziomy indeksów nie są świecami bez obrotu.
- **BL-213:** zadanie `market.gpw-completeness` (19:30) i raport (tabela Markdown + JSON w `valkey-queue`, log z kodem werdyktu); kryterium ADR-005 opisane w ADR i instrukcji administratora.
- Testy: core 203/203, pokrycie linii 99,55 %; zmienione pakiety i zależne `lint typecheck test` 38/38 PASS; `pnpm db:test` PASS — nowe zestawy PostgreSQL „data quality § 14” i „benchmarks”, schemat ZERO DIFFERENCES; OpenAPI: 51 operacji, 134 pending, `check` OK. Testy bez sieci (syntetyczne próbki, sesje 2031).

## Wynik raportu kompletności (BL-213)

Brak danych produkcyjnych: weryfikacja ADR-005 wymaga 20 kolejnych sesji po wdrożeniu M2 na instancji właściciela. Werdykt na dziś: **za mało sesji (nie zmierzono)**. Po 20 sesjach właściciel wkleja tutaj tabelę z `report:gpw-completeness:latest` (pole `markdown`).

## Odchylenia i ograniczenia sesji

- Kontener sesji: `cdn.sheetjs.com` i Yahoo zablokowane przez politykę sieci, Docker Hub zwracał 429 dla przypiętego digestu. Lokalnie użyto tymczasowo `xlsx@0.18.5` z npm i obrazu `postgres:18.6-trixie` po tagu — bez commitowania; CI używa przypiętych artefaktów.
- Symbole Yahoo poza `WIG20.WA` i `^GSPC` — **NIEZWERYFIKOWANE** (R-37). Smoke `modules/market` raz przekroczył 5 s przy pełnej równoległości turbo; 3/3 i 38/38 przy `--concurrency=3` PASS.
- Poza zakresem: endpointy admina `adminListDataQualityIssues`/`adminResolveDataQualityIssue` (panel admina, BL-508), UI `/rynek` i znaczniki jakości (Codex). Bez nowych zależności, usług, kosztów i ADR; przegląd metodologiczny § 7 nie dotyczy (brak funkcji predykcyjnej).
- Ryzyka: R-37 (symbole) otwarte do weryfikacji na serwerze. R-38 zamknięte decyzją właściciela 2026-10-19: `oliginvest_analytics_ro` ma `SELECT` na `market.data_quality_issues` (ADR-003 doprecyzowany; migracja `0006_analytics-quality-read`, `schema.sql`, `testy-rls.sql`, katalog uprawnień; `pnpm db:test` PASS, schemat ZERO DIFFERENCES). Worker Python sprawdza BLOCK sam — przy budowie BL-3xx.
