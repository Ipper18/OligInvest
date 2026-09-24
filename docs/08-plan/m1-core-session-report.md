# M1 core — stan bieżący

**Cel:** przekazać stan rdzenia obliczeń `packages/core` i następny krok. Nadpisywany po sesji; historia na końcu (≤ 10 linii na zamknięte zadanie).

**2026-09-24**, gałąź `feat/m1-core-engine` (z `feat/m0-1-skeleton`), wykonawca: Claude Code (decyzja właściciela z 2026-09-24, `CLAUDE.md`). Node 24.21.0, pnpm 12.4.2. Zadania wykonane lokalnie: status `w toku` do CI i wspólnego DoD.

| Zakres | Stan |
|---|---|
| BL-141 | wykonane lokalnie: `Decimal` (34 cyfry, HALF_EVEN), `Money`, `Quantity`, `Price`, `FxRate`, tabela kursów, daty i cykle rozliczeń, formatowanie pl-PL |
| BL-142 | wykonane lokalnie: `Transaction` (unia po `type`, walidacja jak w `schema.sql`), `buildLedger` — FIFO per rachunek, split, przeniesienia, P/L ekonomiczny i podatkowy (`settle_date`, NBP D-1, `fxCosts`, `tax_include_fx_fee`), pełny wektor A |
| BL-143 | wykonane lokalnie: pozycje i gotówka per waluta z księgi, dywidendy (G), `valuePortfolio`, P/L niezrealizowany, `dayChange` (F), `externalFlows`; `seed-dev.json` zgodny z blokiem `expected` co do grosza |
| Etap 2 | BL-301, 305–308 — po zamknięciu etapu 1 |

## Plan publicznego API

- **Liczby i błędy:** `Decimal` (izolowany klon decimal.js), `toDecimal` (tylko `Decimal` lub ścisły tekst dziesiętny; `number` odrzucany w czasie wykonania), `roundHalfUp`; `CoreError` z `code` (`invalid_decimal`, `currency_mismatch`, `short_position`, …) i `isCoreError`.
- **Typy wartości:** `CurrencyCode` (`currencyCode`, `minorUnits` z Intl), `Money` (`money`, `add/subtract/negate/multiply/divide/sumMoney`, `roundMoney` HALF_UP, `moneyToJson`/`moneyFromJson`), `Quantity`, `Price`, `grossValue`.
- **Waluty:** `FxRate` (`fxRate`, `convertMoney`, `invertFxRate`, `brokerFxRate` — § 2.1, `fxConversionCost`), `createFxRateTable` z `onOrBefore` (wycena) i `before` (NBP D-1).
- **Czas:** `IsoDate`, `addDays`, `daysBetween`, `isWeekday`, `settlementCycleDays`, `settlementRegionForMic`, `settlementDate` (kalendarz od wywołującego).
- **Prezentacja:** `formatMoney`, `formatPrice`, `formatQuantity`, `formatFxRate`, `formatRatio`.
- **Księga (BL-142):** `Transaction` (unia po `type`, pola jak `portfolio.transactions`), `sortTransactions`, `validateTransaction`, `buildLedger({ accounts, transactions, taxSettings, taxRates })` → `lots`, `sales` (z `consumptions` i `tax`), `issues` (`missing_settle_date`, `missing_tax_rate`); błędy danych jako `CoreError` (`short_position`, `unmatched_security_transfer`, `invalid_transaction`).
- **Portfel (BL-143):** `ledger.positions`, `ledger.cash`, `ledger.dividends` (`dividendTaxView`: 19 % brutto, zaliczenie podatku u źródła do wysokości 19 %, dopłata ≥ 0), `valuePortfolio` (luki `gaps`, `asOf`, `fxAsOf`), `dayChange`, `externalFlows`.

Dowody: `pnpm turbo run lint typecheck test build --filter=@oliginvest/core` PASS; 94 testy, pokrycie linii 99,8 %; `pnpm check:deps` PASS. Dosłowne `pnpm --filter @oliginvest/core lint typecheck test build` uruchamia tylko `lint` (reszta trafia jako argumenty do Biome) — dlatego filtr Turbo.

Odwzorowanie § 1 (do potwierdzenia): kolejność w dniu = SPLIT, potem `executedAt` (operacje bez czasu po operacjach z czasem), `sequence`, `id` — porównanie `executedAt` tylko przy obu wartościach nie jest przechodnie. `SECURITY_TRANSFER_IN` musi następować po swoim `_OUT` (niższe `sequence`); przeniesienie spoza śledzonych rachunków (IN bez OUT) jest błędem — potrzebna decyzja, skąd brać koszt i datę.

Seed (`seed-dev.json`, widok ekonomiczny): gotówka, 5 pozycji (ilość, koszt, wartość, wynik), wartość portfela 47 064,47 i wpłaty netto 41 500,00 — bez różnic. Jedyny efekt zaokrągleń: suma wartości pozycji zaokrąglonych osobno dałaby 47 064,48; rdzeń (jak seed) sumuje bez zaokrągleń pośrednich (§ 0.2), więc seed pozostaje bez zmian.

Dalej: etap 2 (BL-301, rdzeń BL-305–BL-308).

## Historia

- 2026-09-24 BL-141: typy wartości, kursy i formatowanie; testy na wektorze A (kursy brokera, koszty FX).
- 2026-09-24 BL-143: pozycje, gotówka, wycena z lukami i znacznikami czasu, wynik dnia (F), dywidendy (G), przepływy zewnętrzne; test integracyjny seed bez różnic > 0,01 zł.
- 2026-09-24 BL-142: księga FIFO z widokiem ekonomicznym i podatkowym; wektor A zgodny co do grosza (także `fxCosts` 105,63 i wariant z marżą −1055,83); testy sprzedaży częściowych, splitów, przeniesień, braków danych, IKE i walidacji.
