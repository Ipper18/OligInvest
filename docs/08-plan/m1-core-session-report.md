# M1 core — stan bieżący

**Cel:** przekazać stan rdzenia obliczeń `packages/core` i następny krok. Nadpisywany po sesji; na końcu sekcja „Dla Codexa” i historia (≤ 10 linii na zamknięte zadanie).

**2026-09-24**, gałąź `feat/m1-core-engine` (z `feat/m0-1-skeleton`), [roboczy PR #3](https://github.com/Ipper18/OligInvest/pull/3), wykonawca: Claude Code (decyzja właściciela z 2026-09-24, `CLAUDE.md`). Node 24.21.0, pnpm 12.4.2. Zadania wykonane lokalnie mają status `w toku` do CI i wspólnego DoD; CI ruszy po scaleniu #2.

| Zakres | Stan |
|---|---|
| BL-141, BL-142, BL-143, BL-201 | wykonane lokalnie, `w toku` |
| BL-301, BL-305, BL-306 (§ 4.2), BL-307, BL-308, BL-315 (§ 12.5), BL-551 (§ 8) | rdzeń w `packages/core`; integracja (API, baza, UI, kolejki) i ekspozycja walutowa BL-306 — Codex |

Dowody: `pnpm turbo run lint typecheck test build --filter=@oliginvest/core` PASS; 150 testów, pokrycie linii 99,8 % (bramka 90 %); wektory A–H w całości (D, E z tolerancjami 1e-6 i 1e-8); seed `seed-dev.json` bez różnic; `check:deps`, `check:docs` PASS.

**Decyzje właściciela z 2026-09-24 — wprowadzone:** kolejność operacji (OBL § 1); zaliczenie podatku u źródła do 19 % (OBL § 4.3, podstawa **NIEZWERYFIKOWANE**); `xirrStatus = period_too_short` (backlog BL-303, zmiana OpenAPI); `SECURITY_TRANSFER_IN` bez `_OUT` — koszt i data od użytkownika, bez nich pozycja wyceniana bez P/L i widoku podatkowego, ostrzeżenie `missing_acquisition_cost` (OBL § 3.5); stopa od kosztu w PLN po NBP D-1 (OBL § 4.3). Doprecyzowania bez zmiany wzorów: OBL § 0.2 (format procentu Intl), § 0.5 (zaokrąglone wektory), § 6.2 (dni annualizacji).

**Decyzje właściciela z 2026-09-24 (druga tura):** OBL § 3.3 — pula średniej (c̄ = koszt puli / ilość puli; zakup dodaje koszt i ilość, sprzedaż zdejmuje q·c̄), rdzeń liczył już tak. OBL § 12.5 — pasmo na wagach sprzed nowej gotówki, `buy_only` tylko z nowej gotówki (wolna gotówka — przyszła opcja w backlogu BL-315), sprzedaż do pełnych sztuk; szacowany podatek od kosztu z widoku podatkowego (data rozliczenia, NBP D-1, marża osobno), etykieta „szacunek” — zmieniony rdzeń; wektor H bez zmian (nie ma pól podatku).

Nowe ryzyka: brak. Decyzje do ADR: brak.

## Dla Codexa

Wszystko z `@oliginvest/core`; kwoty wyłącznie `Money`/`Decimal`, daty `IsoDate`, stopy i statystyki `number` (§ 0.1). Błędy danych: `CoreError { code, details }`.

- **Wartości i kursy:** `toDecimal`, `money`, `quantity`, `price`, `isoDate`, `fxRate`, `createFxRateTable(rates)` → `.onOrBefore` / `.before`, `brokerFxRate`, `fxConversionCost`, `roundMoney`, `moneyToJson`, `format{Money,Price,Quantity,FxRate,Ratio}`, `settlementRegionForMic`, `settlementCycleDays`, `settlementDate`.
- **Księga:** `buildLedger({ accounts, transactions, taxSettings?, taxRates? })` → `lots`, `sales`, `positions`, `cash`, `dividends`, `issues` (`LEDGER_ISSUE_CODES`: `missing_settle_date`, `missing_tax_rate`, `missing_acquisition_cost`). Pola kosztu partii, sprzedaży i pozycji są `null`, gdy `costKnown = false`. `buildAverageCostView(input)`.
- **Wycena i wyniki:** `valuePortfolio`, `dayChange`, `externalFlows`, `twrIndex`, `timeWeightedReturn`, `periodStart`, `periodReturn`, `xirr`, `investorCashflows`, `drawdowns`, `priceFxEffect`, `dividendTaxView`, `trailingDividends`, `yieldOnCost`, `yieldOnCostPln(records, costPln)`.
- **Wskaźniki (BL-201):** `sma(values, n)`, `ema`, `rsi`, `macd(values, fast, slow, signal)` → `{ macd, signal, histogram }`, `bollingerBands(values, n, k)` → `{ upper, middle, lower }`, `atr(high, low, close, n)`; wejście `Decimal[]` (pełne serie skorygowane o splity), wynik `(number | null)[]`.
- **Ryzyko (BL-551):** `riskMetrics(returns, { benchmark?, riskFreeAnnual?, periodsPerYear?, mar?, confidence? })` → wartości + `assumptions` + `insufficientData` (< 60 obserwacji); osobno `annualVolatility`, `sharpeRatio`, `sortinoRatio`, `beta`, `correlation`, `historicalVar`, `historicalCvar`, `parametricVar`, `calmarRatio`, `dailyRiskFreeRate`. Wejście: dzienne stopy z `twrIndex`.
- **Rebalancing (BL-315):** `rebalance({ holdings, targets, mode, cash?, newCash?, band?, minOrder?, costRate?, minCost?, taxable, reconciled })` → `status` (`blocked` bez uzgodnionego importu), `trades` (kwota ze znakiem, ilość, koszt, `estimatedTax`), `skipped`, `weightsBefore/After`, `costs`, `cashAfter`. `holdings[].lots` = `ledger.positions[].lots` (podatek: szacunek od `taxCostRemaining`, etykieta „szacunek”, `null` bez kosztu podatkowego lub poza PLN); `costRate` z modelu kosztów § 12.7 (konfiguracja brokera).

**BL-144–BL-146:** wiersz `portfolio.transactions` → `Transaction` (`amount` z wyciągu; `fxFee` = `fxConversionCost(q·p, mid, marża)`; DIVIDEND: `gross = quantity × price`, `withholdingTax = tax`; IN spoza rachunków: `acquisitionCost` + `acquiredOn` z formularza). `recompute`: `buildLedger` → `lots` (`quantity_open = quantityAcquired × splitFactor`), `lot_consumptions` (`fx_cost_pln = tax.fxCostPln`), pozycje, salda, `issues` jako ostrzeżenia w UI; `valuePortfolio` dla `valuations_daily`. Zaokrąglaj tylko przy zapisie i prezentacji. Kolumny na zadeklarowany koszt IN wymagają zmiany `schema.sql` (BL-144).

**Ograniczenia:** partie przeniesione z IKE/IKZE nie mają kosztu podatkowego; `fees_total` nie jest liczone; kalendarz rozliczeń USA dostarcza wywołujący; ekspozycja walutowa (BL-306) i agregacje roczne dywidend — do zrobienia.

## Historia

- 2026-09-24 BL-141–BL-143: typy, księga FIFO (wektor A), portfel, wycena, F, G; seed bez różnic > 0,01 zł.
- 2026-09-24 Etap 2 (rdzeń): TWR, XIRR, okresy (B), obsunięcia (C), efekt ceny i kursu, stopa od kosztu, średnia ważona.
- 2026-09-24 Decyzje właściciela: dokumenty OBL § 0.2, § 0.5, § 1, § 3.5, § 4.3, § 6.2, backlog BL-303; rdzeń: przeniesienia spoza rachunków, `missing_acquisition_cost`, stopa od kosztu w PLN.
- 2026-09-24 BL-201: SMA, EMA, RSI, MACD, Bollinger, ATR — wektor E (1e-8).
- 2026-09-24 BL-551 (rdzeń): metryki ryzyka — wektor D (1e-6).
- 2026-09-24 BL-315 (rdzeń): rebalancing z kosztami, podatkiem i blokadą — wektor H.
- 2026-09-24 Decyzje (druga tura): OBL § 3.3 i § 12.5; szacowany podatek rebalancingu od kosztu podatkowego. Następny krok: niezależny przegląd w osobnej sesji.
