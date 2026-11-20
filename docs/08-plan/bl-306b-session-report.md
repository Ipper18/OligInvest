# BL-306b — stan sesji

**Cel:** przekazać stan kosztu w PLN pozycji na rachunku w walucie innej niż PLN (FR-02.06, Z-29), decyzje projektowe, dowody weryfikacji i pytania do właściciela.

**2026-11-20**, gałąź `feat/bl-306b-pln-cost`, worktree `OligInvest-wt/bl-306b`, baza: `main` po PR #78 (BL-306), #80 (BL-307) i #85; draft PR #88. Status `w toku` do CI i przeglądu właściciela; M3 pozostaje otwarty.

## Zakres i decyzje

- **Rdzeń** (`packages/core`, jedyna implementacja wzoru): `buildLedger` liczy dla każdej partii `costPln`, `costPlnRemaining` i `costPlnRate`, a dla pozycji `costPln`. Na rachunku PLN to koszt ekonomiczny; na rachunku w innej walucie — koszt w walucie rachunku × kurs średni NBP z ostatniego dnia roboczego **przed** dniem kosztu. Reguła i odczyt kursu są wspólne z widokiem podatkowym (§ 2.2): wydzielone `costDayOf` (dzień rozliczenia, przy `tax_date_basis = trade` dzień zawarcia) i `rateBefore` (`FxRateTable.before`) używane przez `toPln`, dywidendy i nowy koszt w PLN — bez kopii logiki. Weekend i święto przed dniem kosztu dają kurs z ostatniej opublikowanej tabeli.
- **Inaczej niż widok podatkowy:** koszt w PLN liczymy na każdym typie rachunku (także IKE/IKZE) i od kosztu ekonomicznego (z prowizją i marżą przewalutowania), bo to widok ekonomiczny. FIFO dzieli go proporcjonalnie; przeniesienie na rachunek PLN przyjmuje koszt po przeliczeniu (§ 3.5), z rachunku PLN na walutowy zachowuje pierwotny koszt w PLN.
- **Brak danych = jawny stan, nigdy 0:** brak kursu NBP przed dniem kosztu albo brak dnia kosztu (brak `settle_date`) → `costPln = null`; w ekspozycji wyłączenie `missing_cost_pln` i adnotacja `decomposition.notSplit` (bez zmiany enumów), w dywidendach stopa od kosztu `null` z `missing_cost_pln`. Nigdy kurs bieżący (fałszywe zero efektu kursu).
- **Ekspozycja walutowa** (`getCurrencyExposure`): usunięte wyłączenie „rachunek w walucie instrumentu”; `r_0` = koszt w PLN / koszt w walucie instrumentu dla każdej pozycji. Reguła obejmuje każdy rachunek w walucie innej niż PLN — także rachunek EUR z akcją USD, który wcześniej przeliczał koszt kursem bieżącym (pomijał ruch EUR/PLN od zakupu). Nowe założenie w odpowiedzi: `assumptions.costFxRates = nbp_table_a_mid_previous_business_day` (ta sama nazwa co w dywidendach).
- **Dywidendy** (`listDividends`, decyzja Z-30 pkt 2): stopa od kosztu na rachunku USD z kosztem w PLN z tej samej reguły.
- **Kontrakt:** `openapi.yaml` (opisy, `costFxRates` w `CurrencyExposure.assumptions`), Zod, klient `schema.d.ts`; bez nowych operacji — listy w `openapi.test.mjs`/`health.test.mjs` i `openapi-pending.json` bez zmian (109 zaimplementowanych / 78 pending).
- **Ekran** `/portfel/wyniki`: PL/EN w `performance.json` — wyjaśnienie rozbicia z regułą kursu NBP, adnotacja i powód `missing_cost_pln` jako „brak kursu NBP z dnia roboczego przed dniem kosztu”, stopa od kosztu. Bez nowego JS klienta.
- **Dokumenty:** [`obliczenia-finansowe.md`](../03-dane/obliczenia-finansowe.md) § 4.2.1 (przykład A′) i § 4.3.1, [`wymagania.md`](../00-przeglad/wymagania.md) Z-29 (realizacja), wektor `A_fifo_fx.instrument_currency_account` w [`wektory-testowe.json`](../03-dane/wektory-testowe.json) (kursy fikcyjne; kurs z dnia rozliczenia jako wabik).

## Dowody lokalne

- Core: **271 testów PASS**, linie **99,6 %**, funkcje 100 %; nowy `pln-cost.test.mjs` (11 testów) na wektorze A′: poniedziałek → kurs z piątku (9 240,00 PLN), dzień po święcie 11.11 → kurs z 10.11 (3 703,70 PLN), pozostałość FIFO 2 222,22 PLN, efekt ceny 108,78 + efekt kursu −63,00 = P/L 45,78, brak kursu i brak `settle_date` → `null`, `tax_date_basis = trade`, IKE w USD, rachunek PLN, przeniesienia, transfer z kosztem deklarowanym.
- Python: parzystość loaderów wektorów TS/Python `test_vectors.py` **5/5 PASS**.
- Portfolio: `currency-exposure.test.mjs` + `dividends.test.mjs` **16/16 PASS** (pozycja z rachunku USD w rozbiciu: 358,75 = 191,0625 + 167,6875; kurs-wabik z dnia rozliczenia nieużyty; stopa od kosztu 0,00384375 przy rozliczeniu w poniedziałek; brak kursu → `missing_cost_pln`).
- `check:contracts` PASS (OpenAPI 25/25), `check:api-client` PASS.
- `pnpm turbo run lint typecheck test --filter=...[origin/main]`: **86/88 zadań PASS**; dwa błędy lokalne: formatowanie `ledger.ts` (poprawione, `biome check` PASS) i znany `apps/analytics` mypy `os.killpg` tylko pod Windows (kod Pythona nietknięty, CI na Linuksie).
- PostgreSQL 18 (`pnpm db:test`): ekspozycja — pozycja z rachunku USD bez kursu NBP przed dniem rozliczenia → `missing_cost_pln` i `notSplit`, po dodaniu tabeli z poniedziałku przed rozliczeniem we wtorek: koszt 390 PLN, wiersz USD 170 = 115 + 55 PLN, `notSplit` i wyłączenia puste; dywidendy — stopa od kosztu na rachunku USD 0,005125 (koszt 4 000 PLN z kursu piątku przed rozliczeniem w poniedziałek); obcy rachunek 404, 401, 422 — **PASS**; porównanie schematu **ZERO DIFFERENCES**.
- E2E `performance.spec.ts`: **18/18 PASS** (Chromium/WebKit/Firefox), w tym reguła kursu NBP w bloku założeń i nowa treść adnotacji/powodu `missing_cost_pln`; axe bez naruszeń.
- `check:docs`, `check:ui-text`, `check:repository`, `check:deps` PASS.
- Budżety PASS i bez pogorszenia: `/` **158,60/190 KiB**, `/portfel` **168,35/195**, `/portfel/wyniki` **170,03/195**; size-limit powłoki **20,45/30,72 kB**. R-53 bez zmian.
- Grep sekretów przed commitem: tylko 4 znane syntetyczne trafienia.

## Pytania do właściciela

1. **`listPositions` na rachunku walutowym** (poza zakresem BL-306b, bez zmian w tym PR): kolumny efektu ceny i kursu w `/portfel` dla pozycji na rachunku USD liczą koszt kursem bieżącym, więc efekt kursu wychodzi 0, a `costBasis`/P/L w PLN są kosztem po kursie bieżącym. Propozycja: osobne zadanie — te same `Position.costPln` w `listPositions` (koszt w PLN i P/L w PLN z kursu NBP przed dniem kosztu), co zmienia wynik w PLN widoku portfela dla rachunków walutowych; albo do decyzji `null` z powodem zamiast 0.
2. **Kurs nieświeży:** jak widok podatkowy przyjmujemy ostatnią tabelę przed dniem kosztu także przy luce w danych NBP; widok podatkowy ostrzega `stale_tax_rate`, rozbicie nie pokazuje tego ostrzeżenia (kalendarz dni roboczych NBP nie jest przekazywany — domyślnie pon.–pt., więc święta dawałyby fałszywe ostrzeżenia).

## Pozostałe

Bez zmian w identity, migracjach db, jobs, manifestach i lockfile; bez nowych bibliotek, retry, timeoutów i obniżania progów. Przegląd metodologiczny § 7 nie dotyczy (wycena bieżąca, bez prognoz i backtestu). R-53: zmiany tylko w sekcji renderowanej na serwerze na `/portfel/wyniki`; nic nie dochodzi do pierwszego ładowania `/` i `/portfel`. Nowe ryzyka: brak. Estymata 1 d bez zmian, nakład niezmierzony.
