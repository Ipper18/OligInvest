# M1 core — stan bieżący

**Cel:** przekazać stan rdzenia obliczeń `packages/core` i następny krok. Nadpisywany po sesji; na końcu sekcja „Dla Codexa” i historia (≤ 10 linii na zamknięte zadanie).

**2026-09-24**, gałąź `feat/m1-core-engine` (z `feat/m0-1-skeleton`), [roboczy PR #3](https://github.com/Ipper18/OligInvest/pull/3), wykonawca: Claude Code (decyzja właściciela z 2026-09-24, `CLAUDE.md`). Node 24.21.0, pnpm 12.4.2. Zadania wykonane lokalnie mają status `w toku` do CI i wspólnego DoD; CI ruszy po scaleniu #2.

| Zakres | Stan |
|---|---|
| BL-141, BL-142, BL-143, BL-201 | wykonane lokalnie, `w toku` |
| BL-301, BL-305, BL-306 (§ 4.2), BL-307, BL-308, BL-315 (§ 12.5), BL-551 (§ 8) | rdzeń w `packages/core`; integracja (API, baza, UI, kolejki) i ekspozycja walutowa BL-306 — Codex |

Dowody: `pnpm turbo run lint typecheck test build --filter=@oliginvest/core` PASS; 191 testów, pokrycie linii 99,5 % (bramka 90 %); wektory A–H w całości (D, E z tolerancjami 1e-6 i 1e-8; F zmieniony na 0,53 %, D uzupełniony o `tied_*`); seed `seed-dev.json` bez różnic; `check:deps`, `check:docs` PASS.

**Decyzje właściciela z 2026-09-24 — wprowadzone:** kolejność operacji (OBL § 1); zaliczenie podatku u źródła do 19 % (OBL § 4.3, podstawa **NIEZWERYFIKOWANE**); `xirrStatus = period_too_short` (backlog BL-303, zmiana OpenAPI); `SECURITY_TRANSFER_IN` bez `_OUT` — koszt i data od użytkownika, bez nich pozycja wyceniana bez P/L i widoku podatkowego, ostrzeżenie `missing_acquisition_cost` (OBL § 3.5); stopa od kosztu w PLN po NBP D-1 (OBL § 4.3). Doprecyzowania bez zmiany wzorów: OBL § 0.2 (format procentu Intl), § 0.5 (zaokrąglone wektory), § 6.2 (dni annualizacji).

**Decyzje właściciela z 2026-09-24 (druga tura):** OBL § 3.3 — pula średniej (c̄ = koszt puli / ilość puli; zakup dodaje koszt i ilość, sprzedaż zdejmuje q·c̄), rdzeń liczył już tak. OBL § 12.5 — pasmo na wagach sprzed nowej gotówki, `buy_only` tylko z nowej gotówki (wolna gotówka — przyszła opcja w backlogu BL-315), sprzedaż do pełnych sztuk; szacowany podatek od kosztu z widoku podatkowego (data rozliczenia, NBP D-1, marża osobno), etykieta „szacunek” — zmieniony rdzeń; wektor H bez zmian (nie ma pól podatku).

**Niezależny przegląd** ([`m1-core-przeglad.md`](m1-core-przeglad.md), 28 znalezisk): wszystkie naprawione, 33 testy przeglądu + 5 testów decyzji przechodzą (§ 7 przeglądu). Decyzje właściciela z 2026-09-24 zapisane w OBL:
- C-01 — przeniesienie między walutami po kursie NBP z dnia przeniesienia (`transferRate` w partii); § 3.5.
- C-02 — przeniesienie bez drugiej strony wśród śledzonych rachunków jest przepływem portfela o wartości rynkowej, a brak tej wartości jest błędem; § 1.
- C-03 — split `ratioFrom`/`ratioTo` z `cashInLieu`; § 3.4.
- C-11 — podatek planu = 19 % × max(0, Σ wyników), uwzględnia `tax_include_fx_fee`; § 12.5.
- C-12 — `buy_only` najwyżej do wielkości luki; § 12.5.
- C-13 — wynik dnia względem `V(D−1) + F`, wektor F 0,53 %; § 5.1.
- C-23 — CVaR według empyrical; § 8.

Nowe ryzyka: brak. Decyzje do ADR: brak.

## Dla Codexa

Wszystko z `@oliginvest/core`; kwoty wyłącznie `Money`/`Decimal`, daty `IsoDate`, stopy i statystyki `number` (§ 0.1). Błędy danych: `CoreError { code, details }` (m.in. `short_position`, `unmatched_security_transfer`, `currency_mismatch` z `transactionId`, `missing_transfer_value`, `invalid_allocation`).

- **Wartości i kursy:** `toDecimal`, `money`, `quantity`, `price`, `isoDate`, `fxRate`, `createFxRateTable` (`onOrBefore`/`before`), `brokerFxRate`, `fxConversionCost`, `roundMoney`, `moneyToJson`, `format{Money,Price,Quantity,FxRate,Ratio}`, `settlementRegionForMic`, `settlementCycleDays`, `settlementDate`.
- **Księga:** `buildLedger({ accounts, transactions, taxSettings?, taxRates?, isNbpBusinessDay? })` → `lots` (`transferRate`, `taxRateDate`), `sales`, `positions`, `cash`, `dividends`, `issues`. `LEDGER_ISSUE_CODES`: `missing_settle_date`, `missing_tax_rate`, `missing_acquisition_cost`, `missing_transfer_rate`, `stale_tax_rate`, `tax_cost_unavailable`. `buildAverageCostView(input)`.
- **Wycena i wyniki:** `valuePortfolio`, `dayChange`, `externalFlows(tx, { level, securityTransferValue })`, `twrIndex`, `timeWeightedReturn`, `periodStart`, `periodReturn`, `xirr`, `investorCashflows`, `drawdowns`, `priceFxEffect`, `dividendTaxView`, `trailingDividends`, `yieldOnCost`, `yieldOnCostPln`.
- **Wskaźniki, ryzyko, rebalancing:**
  - `sma`, `ema`, `rsi`, `macd`, `bollingerBands`, `atr`.
  - `riskMetrics` — wartości `null` przy n < 2.
  - `zForConfidence`.
  - `rebalance({ …, includeFxFee? })` → `trades[].taxableResult` (wynik ze znakiem), `estimatedTax` (szacunek planu, `null` przy `blocked`).

**Zadania BL-144 (schemat — nie zmieniane w PR #3):**
1. `portfolio.transactions.split_ratio` i `market.corporate_actions.ratio` (`numeric(24,12)`) zastąpić parą liczb całkowitych (np. `ratio_from`, `ratio_to`), a w `transactions` dodać kwotę `cash_in_lieu` operacji `SPLIT` (C-03).
2. Partie bez kosztu (`missing_acquisition_cost`, `missing_transfer_rate`): rdzeń zwraca `null`, a `portfolio.lots.cost_total`, `portfolio.lot_consumptions.cost_economic` i `realized_pl_economic` są `NOT NULL` — zdjąć `NOT NULL` albo dodać `cost_known`.
3. Kolumny na deklarowany koszt i datę nabycia `SECURITY_TRANSFER_IN` (`acquisitionCost`, `acquiredOn`) oraz na `transfer_rate` partii.

**Kontrakt integracji (BL-144–BL-146 i dalej):**
- Wiersz transakcji → `Transaction`:
  - `amount` = wpływ na gotówkę z wyciągu (także ujemny dla `SELL`);
  - `executedAt` tylko z `Z` lub przesunięciem;
  - `fxFee` = `fxConversionCost(q·p, mid, marża)`;
  - DIVIDEND: `gross = quantity × price`;
  - FTT, opłata SEC i podatek u źródła jako `TAX`/`FEE` z `relatedTransactionId` — rdzeń sam przypisuje je do operacji (C-04).
- `recompute`:
  - `buildLedger` z kursami NBP i kalendarzem dni roboczych NBP;
  - `lots` (`quantity_open = quantityAcquired × splitFactor`);
  - `lot_consumptions` (`fx_cost_pln = tax.fxCostPln`);
  - `issues` jako ostrzeżenia w UI;
  - `valuePortfolio` dla `valuations_daily`.
- `externalFlows` dla TWR/XIRR wymaga `securityTransferValue` (wartość rynkowa z dnia przeniesienia).
- Uwagi z przeglądu (§ 2):
  - **RSI bez ruchu = 0** (jak TA-Lib) — alerty BL-562 traktują brak ruchu jako brak wartości.
  - **Metryki ryzyka** tylko ze stóp dni sesyjnych (P = 252), bez weekendów.
  - **Notowania z `asOf` po dniu wyceny** odrzucać lub oznaczać przed `valuePortfolio`.
  - **NBP i zapasowe ECB** — osobne `createFxRateTable` (ta sama para i dzień w jednej tabeli to duplikat).

**Ograniczenia:**
- Kurs przeniesienia pochodzi z tabeli NBP przekazanej jako `taxRates`.
- XLON i SIX bez cyklu rozliczeń — import podaje `settle_date`.
- Ekspozycja walutowa (BL-306) i agregacje roczne dywidend — do zrobienia.

## Historia

- 2026-09-24 BL-141–BL-143: typy, księga FIFO (wektor A), portfel, wycena, F, G; seed bez różnic > 0,01 zł.
- 2026-09-24 Etap 2 (rdzeń): TWR, XIRR, okresy (B), obsunięcia (C), efekt ceny i kursu, stopa od kosztu, średnia ważona.
- 2026-09-24 Decyzje właściciela: dokumenty OBL § 0.2, § 0.5, § 1, § 3.5, § 4.3, § 6.2, backlog BL-303; rdzeń: przeniesienia spoza rachunków, `missing_acquisition_cost`, stopa od kosztu w PLN.
- 2026-09-24 BL-201: SMA, EMA, RSI, MACD, Bollinger, ATR — wektor E (1e-8).
- 2026-09-24 BL-551 (rdzeń): metryki ryzyka — wektor D (1e-6).
- 2026-09-24 BL-315 (rdzeń): rebalancing z kosztami, podatkiem i blokadą — wektor H.
- 2026-09-24 Decyzje (druga tura): OBL § 3.3 i § 12.5; szacowany podatek rebalancingu od kosztu podatkowego. Następny krok: niezależny przegląd w osobnej sesji.
- 2026-09-24 Niezależny przegląd rdzenia (osobna sesja): 28 znalezisk, każde z testem pomijanym w `review-findings.test.mjs` (`CORE_REVIEW=1` uruchamia) — [m1-core-przeglad.md](m1-core-przeglad.md); część poprawek przed BL-144 (§ 6 przeglądu).
- 2026-09-24 Przegląd niezależny: 28 znalezisk naprawionych (C-01…C-28), decyzje właściciela w OBL § 1, 3.4, 3.5, 5.1, 8, 12.5; wektory F i D zaktualizowane.
