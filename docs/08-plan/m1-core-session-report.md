# M1 core — stan bieżący

**Cel:** przekazać stan rdzenia obliczeń `packages/core` i następny krok. Nadpisywany po sesji; historia na końcu (≤ 10 linii na zamknięte zadanie).

**2026-09-24**, gałąź `feat/m1-core-engine` (z `feat/m0-1-skeleton`), wykonawca: Claude Code (decyzja właściciela z 2026-09-24, `CLAUDE.md`). Node 24.21.0, pnpm 12.4.2. Zadania wykonane lokalnie: status `w toku` do CI i wspólnego DoD.

| Zakres | Stan |
|---|---|
| BL-141 | wykonane lokalnie: `Decimal` (34 cyfry, HALF_EVEN), `Money`, `Quantity`, `Price`, `FxRate`, tabela kursów, daty i cykle rozliczeń, formatowanie pl-PL |
| BL-142 | todo — model operacji, FIFO, P/L ekonomiczny i podatkowy (wektor A) |
| BL-143 | todo — pozycje, gotówka, wycena, wynik dnia (F, G), test integracyjny `seed-dev.json` |
| Etap 2 | BL-301, 305–308 — po zamknięciu etapu 1 |

## Plan publicznego API

- **Liczby i błędy:** `Decimal` (izolowany klon decimal.js), `toDecimal` (tylko `Decimal` lub ścisły tekst dziesiętny; `number` odrzucany w czasie wykonania), `roundHalfUp`; `CoreError` z `code` (`invalid_decimal`, `currency_mismatch`, `short_position`, …) i `isCoreError`.
- **Typy wartości:** `CurrencyCode` (`currencyCode`, `minorUnits` z Intl), `Money` (`money`, `add/subtract/negate/multiply/divide/sumMoney`, `roundMoney` HALF_UP, `moneyToJson`/`moneyFromJson`), `Quantity`, `Price`, `grossValue`.
- **Waluty:** `FxRate` (`fxRate`, `convertMoney`, `invertFxRate`, `brokerFxRate` — § 2.1, `fxConversionCost`), `createFxRateTable` z `onOrBefore` (wycena) i `before` (NBP D-1).
- **Czas:** `IsoDate`, `addDays`, `daysBetween`, `isWeekday`, `settlementCycleDays`, `settlementRegionForMic`, `settlementDate` (kalendarz od wywołującego).
- **Prezentacja:** `formatMoney`, `formatPrice`, `formatQuantity`, `formatFxRate`, `formatRatio`.
- **BL-142 (plan):** `Transaction` (unia po `type`, pola jak `portfolio.transactions`), `buildLedger({ accounts, transactions, taxSettings, taxRates })` → partie, zużycia, sprzedaże z widokiem podatkowym, gotówka, problemy danych.
- **BL-143 (plan):** pozycje i gotówka z księgi, `valuePortfolio`, `dayChange`, `netExternalFlows`, `dividendBreakdown`.

Dowody: `pnpm turbo run lint typecheck test build --filter=@oliginvest/core` PASS; 34 testy, pokrycie linii 98,9 %; `pnpm check:deps` PASS. Dosłowne `pnpm --filter @oliginvest/core lint typecheck test build` uruchamia tylko `lint` (reszta trafia jako argumenty do Biome) — dlatego filtr Turbo.

Dalej: BL-142.

## Historia

- 2026-09-24 BL-141: typy wartości, kursy i formatowanie; testy na wektorze A (kursy brokera, koszty FX).
