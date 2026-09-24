# M1 core — stan bieżący

**Cel:** przekazać stan rdzenia obliczeń `packages/core` i następny krok. Nadpisywany po sesji; na końcu sekcja „Dla Codexa” i historia (≤ 10 linii na zamknięte zadanie).

**2026-09-24**, gałąź `feat/m1-core-engine` (z `feat/m0-1-skeleton`), [roboczy PR #3](https://github.com/Ipper18/OligInvest/pull/3), wykonawca: Claude Code (decyzja właściciela z 2026-09-24, `CLAUDE.md`). Node 24.21.0, pnpm 12.4.2. Zadania wykonane lokalnie mają status `w toku` do CI i wspólnego DoD.

| Zakres | Stan |
|---|---|
| BL-141, BL-142, BL-143 | wykonane lokalnie, `w toku` |
| BL-301, BL-305, BL-306 (§ 4.2), BL-307, BL-308 | rdzeń w `packages/core`; integracja (API, baza, UI) i ekspozycja walutowa BL-306 — Codex |

Dowody: `pnpm turbo run lint typecheck test build --filter=@oliginvest/core` PASS; 113 testów, pokrycie linii 99,9 % (bramka 90 % w `vitest.config.ts`); wektory A, B, C, F, G w całości; `check:deps`, `check:docs`, `check:repository` PASS. Na PR brak uruchomień CI (są tylko workflow `db` i `modules`; pełne CI — BL-017). Dosłowne `pnpm --filter @oliginvest/core lint typecheck test build` uruchamia tylko `lint` (reszta trafia jako argumenty do Biome), dlatego filtr Turbo.

Seed `seed-dev.json` (widok ekonomiczny): gotówka, 5 pozycji, wartość 47 064,47 i wpłaty netto 41 500,00 — bez różnic. Suma pozycji zaokrąglonych osobno dałaby 47 064,48; rdzeń i seed sumują bez zaokrągleń pośrednich (§ 0.2), seed bez zmian.

**Propozycje zmian dokumentów** (nie wprowadzone; wzory i wektory bez zmian):

1. OBL § 1: porównywanie `executed_at` tylko przy obu wartościach nie jest przechodnie; przyjęto porządek: data → SPLIT → `executedAt` (bez czasu na końcu dnia) → `sequence` → `id`.
2. OBL § 0.5: wektory są zaokrąglone (B: 6 miejsc w %); testy porównują z dokładnością do połowy ostatniej cyfry i dodatkowo z dokładnym łańcuchem (1e-9 względnie). Warto to dopisać.
3. OBL § 6.2: „dni” annualizacji = dni od pierwszej daty z przepływem do końca okresu (wektor B: 364).
4. OBL § 3.3: wzór z „partiami otwartymi” czytany jako pula średniej (zgodnie ze zdaniem „sprzedaż nie zmienia c̄”); proponowane doprecyzowanie.
5. OBL § 4.3: zaliczenie podatku u źródła ograniczone do 19 % (dopłata ≥ 0); dzień przychodu dywidendy = `settle_date`, a gdy brak — `trade_date` (NBP D-1). Podstawa (art. 30a ust. 9 PIT) **NIEZWERYFIKOWANE**.
6. OBL § 0.2 „0,84 %” a `system-projektowy.md` § 5 „0,54%” (Intl bez spacji) — rdzeń stosuje Intl.
7. API `ReturnFigures.xirrStatus`: brak wartości dla okresu < 30 dni (§ 6.3); rdzeń zwraca `period_too_short` — dodać do OpenAPI w BL-303.

Nowe ryzyka: brak. Decyzje do ADR: brak (otwarte kwestie danych — niżej).

## Dla Codexa

Wszystko z `@oliginvest/core`; kwoty wyłącznie `Money`/`Decimal`, daty `IsoDate`, stopy `number` (ułamki). Błędy danych: `CoreError { code, details }`.

- **Wartości:** `toDecimal(Decimal | string)`, `money(amount, currency)`, `quantity(x)`, `price(amount, currency)`, `isoDate(text)`, `fxRate({ base, quote, rate, date, source })`, `createFxRateTable(rates)` → `.onOrBefore(base, quote, date)` / `.before(base, quote, date)`, `brokerFxRate(mid, margin, "buy" | "sell")`, `fxConversionCost(gross, mid, margin)`, `roundMoney`, `moneyToJson(m, { fractionDigits })`, `format{Money,Price,Quantity,FxRate,Ratio}`.
- **Rozliczenia:** `settlementRegionForMic(mic)`, `settlementCycleDays(region, tradeDate)`, `settlementDate(tradeDate, cycleDays, isSettlementDay)` — przy imporcie uzupełnij `settle_date`.
- **Księga:** `buildLedger({ accounts: Account[], transactions: Transaction[], taxSettings?: { dateBasis, includeFxFee }, taxRates?: FxRateTable }): Ledger` → `lots`, `sales` (`consumptions`, `tax`, `taxStatus`), `positions`, `cash`, `dividends`, `issues`; `buildAverageCostView(input)` → `positions`, `sales` (średnia, widok ekonomiczny).
- **Wycena i wyniki:** `valuePortfolio({ accounts, positions, cash, quotes, fxRates, date, currency? })`, `dayChange({ valueNow, valuePrevClose, externalFlows })`, `externalFlows(transactions, { level, securityTransferValue? })`, `twrIndex(points)`, `timeWeightedReturn(points, { from?, to? })`, `periodStart(key, end, inception)`, `periodReturn(index, from, to)`, `xirr(cashflows)`, `investorCashflows({ start, flows, end })`, `drawdowns(index)`, `priceFxEffect({ cost, costInstrument, value, valueInstrument })`, `dividendTaxView(...)`, `trailingDividends(...)`, `yieldOnCost(gross, cost)`.

**BL-144–BL-146:** wiersz `portfolio.transactions` → `Transaction`: `amount` = wpływ na gotówkę z wyciągu (BUY < 0); `fee`/`tax` informacyjnie (zawarte w `amount`); `fxFee` = `fxConversionCost(q·p, mid, marża brokera)` (XTB 0,5 %, mBank 0,1 % — do konfiguracji brokera); DIVIDEND: `gross = quantity × price`, `withholdingTax = tax`. Walidacja per typ: `validateTransaction` (albo `CoreError` z `buildLedger`, np. `short_position` → wiersz importu `error`). `recompute` (BL-146): operacje rachunków użytkownika i kursy NBP → `buildLedger` → `lots` (`quantity_open = quantityAcquired × splitFactor`), `lot_consumptions` z `sales[].consumptions` (`fx_cost_pln = tax.fxCostPln`), pozycje i salda z `positions`/`cash`, `issues` jako braki danych w UI; `valuePortfolio` dla `valuations_daily`; `twrIndex` i `drawdowns` na seriach dziennych (BL-302/305). Zaokrąglaj dopiero przy zapisie (`NUMERIC(20,8)`) i prezentacji.

**Ograniczenia i kwestie otwarte:** `SECURITY_TRANSFER_IN` wymaga wcześniejszego `_OUT` (niższe `sequence`); przeniesienie spoza śledzonych rachunków → błąd, potrzebna decyzja o źródle kosztu i daty. Partie przeniesione z IKE/IKZE nie mają kosztu podatkowego. `fees_total` partii nie jest liczone. Stopa od kosztu wymaga jednej waluty — waluta przeliczenia dywidend do ustalenia. Kalendarz rozliczeń USA (dni bez rozrachunku) dostarcza wywołujący.

## Historia

- 2026-09-24 BL-141: typy wartości, kursy i formatowanie; testy na wektorze A (kursy brokera, koszty FX).
- 2026-09-24 BL-142: księga FIFO z widokiem ekonomicznym i podatkowym; wektor A co do grosza (`fxCosts` 105,63, wariant z marżą −1055,83); sprzedaże częściowe, splity, przeniesienia, braki danych, IKE, walidacja.
- 2026-09-24 BL-143: pozycje, gotówka, wycena z lukami i znacznikami czasu, wynik dnia (F), dywidendy (G), przepływy; seed bez różnic > 0,01 zł.
- 2026-09-24 Etap 2: TWR, XIRR i okresy (B), obsunięcia (C), efekt ceny i kursu (A), stopa od kosztu, średnia ważona (A) — tylko rdzeń.
