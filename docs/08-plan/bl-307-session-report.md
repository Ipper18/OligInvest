# BL-307 — stan sesji

**Cel:** przekazać stan widoku dywidend (brutto, podatek u źródła, netto, stopa od kosztu, szacowana dopłata; FR-02.08), decyzje projektowe, dowody weryfikacji i pytania do właściciela.

**2026-11-14**, gałąź `feat/bl-307-dividends`, worktree `OligInvest-wt/bl-307`, baza: `main` po scaleniu PR #78 (BL-306). Status `w toku` do CI i przeglądu właściciela; M3 pozostaje otwarty.

## Zakres i decyzje

Na main był rdzeń § 4.3 (`dividendTaxView`, `trailingDividends`, `yieldOnCostPln`, rekord `DividendRecord` w księdze) i wektor G; operacja `listDividends` była w OpenAPI, ale w `openapi-pending.json`. Dodano:

- **Rdzeń** (brakujące elementy, wzory w `packages/core`): `DividendRecord.withholdingRecorded` i `DividendRecord.rate` (kurs NBP D-1), `core.dividendPlnView` (brutto/podatek/netto w PLN i szacunek dopłaty z powodem braku), `core.sumDividendPlnViews` (suma `null` przy dowolnym nieznanym składniku; dopłata tylko z wypłat opodatkowanych), `core.yieldOnCostRatio` (stopa jako `Decimal`; `yieldOnCost` z niej korzysta).
- **API** `GET /portfolio/dividends` (`listDividends`): wiersze wypłat, sumy razem/per rok/per instrument, sumy w walutach wypłat, liczba braków per powód, założenia i `meta` z atrybucją „Kursy: NBP”. Kwoty jako ciągi, waluta zawsze jawna, kurs z datą i numerem tabeli. Cudzy rachunek → 404 (RLS), zakres w przyszłości lub `from > to` → 422. Operację usunięto z `openapi-pending.json` i dopisano do list w `apps/api/test/openapi.test.mjs` i `health.test.mjs` (bez usuwania wpisów). Schemat `Dividends` w `openapi.yaml` przepisany do faktycznego kontraktu (poprzedni szkic nie miał braków danych ani kursu).
- **Ekran** `/portfel/wyniki`: sekcja `#dividends` po ekspozycji walutowej, PL/EN w `performance.json`, `DataFreshness`, blok założeń z regułą dopłaty i definicją stopy od kosztu, pięć tabel zwiniętych w `<details>` i renderowanych na serwerze (bez JS klienta), lista braków danych i disclaimer `tax_view` 2026-09 z [`11-zgodnosc-prawna.md`](../11-zgodnosc-prawna.md) § 4.3 (obok istniejącego `general`). Szacunek nazwany „szacowana dopłata”, z regułą „19 % brutto minus podatek u źródła zaliczony najwyżej do 19 %”, wprost „nie jest wyliczeniem zobowiązania podatkowego ani doradztwem podatkowym”; bez języka imperatywnego i bez prognoz.
- **Brak danych = `null` z powodem, nigdy 0:** brak kursu NBP → kwoty w PLN `null` (`missing_fx`); niezapisany podatek u źródła (brak pola `tax` i powiązanego wiersza `TAX`/`FEE`) → podatek, netto i dopłata `null` (`missing_withholding`) — przyjęcie 0 zawyżyłoby dopłatę; jawne 0 jest znaną wartością. IKE/IKZE → dopłata „nie dotyczy”, nie 0.
- **Stopa od kosztu:** brutto w PLN (NBP D-1) z 12 miesięcy do `to` / koszt FIFO otwartej pozycji w PLN; koszt w PLN tylko na rachunku w PLN, na rachunku w walucie instrumentu `missing_cost_pln` (spójnie z Z-29/BL-306b). Opis: [`obliczenia-finansowe.md`](../03-dane/obliczenia-finansowe.md) § 4.3.1.
- **Poprawka znaleziona przy okazji:** `valuationState` nadawał operacjom z instrumentem bez `settle_date` datę rozliczenia T+1/T+2 — także dywidendom, co przesuwało dzień przychodu i kurs NBP D-1 (§ 4.3: dzień wypłaty). Dywidendy są teraz wyłączone z cyklu rozliczeń; test PostgreSQL to sprawdza (kurs z 2024-04-15 byłby użyty przy przesunięciu).
- Zastrzeżenie **Z-30** w [`wymagania.md`](../00-przeglad/wymagania.md) § 3 (kryterium „suma roczna zgodna z wyciągiem”).

## Dowody lokalne

- Core: **260 testów PASS** (nowy `dividend-pln.test.mjs` na wektorze G: 92,25 / 17,53 / 13,84 / **3,69 PLN**, powiązany wiersz `TAX`, brak podatku u źródła, brak kursu, IKE, dywidenda PLN, sumy).
- Portfolio: `dividends.test.mjs` **9/9 PASS** (wektor G z numerem tabeli, brak podatku u źródła i kursu, IKE, stopa od kosztu 0,375 % i powody, filtr instrumentu, pusty wybór, 404 i 422).
- OpenAPI: kontrakt Zod = `openapi.yaml`, `openapi.test.mjs` + `health.test.mjs` **39/39 PASS**; klient `schema.d.ts` wygenerowany.
- PostgreSQL 18 (`pnpm db:test`): kurs i numer tabeli NBP z bazy, dzień wypłaty bez cyklu T+n, dopłata 0,79 PLN, brak kursu i niezapisany podatek u źródła → `null` z powodem, sumy `null`, stopa od kosztu 0,0100625 i 0,005125 oraz `missing_fx`, obcy rachunek 404, 401, 422 — **PASS**; porównanie schematu **ZERO DIFFERENCES**.
- E2E `performance.spec.ts`: **18/18 PASS** (Chromium/WebKit/Firefox): PL/EN, wektor G w USD i PLN, kurs 3,6900 z tabelą, dopłata 3,69, stopa 0,38 %, tabele zwinięte, `tax_view`, axe, brak podatku u źródła bez zera, pusty zakres.
- `ci:lint` **22/22**, `ci:unit` **44/44**, `ci:typecheck` **40/41** — jedyny błąd to `apps/analytics` (mypy: `os.killpg` nie istnieje na Windows; znany problem lokalny, kod Pythona nietknięty, CI na Linuksie). `check:contracts`, `check:api-client`, `check:deps`, `check:repository`, `check:docs`, `check:ui-text` PASS.
- Budżety PASS i bez pogorszenia: `/` **158,76/190 KiB**, `/portfel` **168,51/195** (jak po BL-306), `/portfel/wyniki` **170,18/195** (+0,01 KiB, sekcja tylko na serwerze); size-limit powłoki **20,06/30,72 kB**.
- Grep sekretów przed commitem: tylko 4 znane syntetyczne trafienia.

## Pytania do właściciela (rekomendacje)

1. **Z-30 — „suma roczna zgodna z wyciągiem”.** Rekomendacja: zgodność sprawdzać na sumach w walucie wypłaty (`totalsByCurrency`, zakres roku), a kwoty w PLN traktować jako przeliczenie NBP (widok podatkowy), nie jako kwoty z wyciągu.
2. **Koszt w stopie od kosztu dla rachunku w walucie instrumentu.** Teraz `null` (`missing_cost_pln`), jak w Z-29. Rekomendacja: zostawić do BL-306b i wtedy użyć kosztu w PLN z kursu NBP D-1 transakcji — bez osobnej decyzji dla dywidend.
3. **Osobna trasa `/portfel/dywidendy`** z mapy ekranów. Rekomendacja: zostać przy sekcji na `/portfel/wyniki` (brak nowej trasy i budżetu JS); osobną trasę dodać dopiero, gdy lista wypłat przekroczy kilkaset pozycji (dziś do 5 000 wierszy w odpowiedzi, bez stronicowania).
4. **Brak wiersza podatku u źródła w imporcie XTB.** Rekomendacja: zostawić `missing_withholding` (nie 0) i pozwolić uzupełnić podatek ręcznie (edycja operacji), zamiast zgadywać stawkę z umowy o unikaniu podwójnego opodatkowania.

## Pozostałe

Draft PR do main; CI sprawdzane na końcu. Bez zmian w identity, migracjach db, jobs, manifestach i lockfile; bez nowych bibliotek, retry, timeoutów i obniżania progów. Przegląd metodologiczny § 7 nie dotyczy (dane historyczne, bez prognoz i backtestu). R-53: sekcja tylko na serwerze, nic nie dochodzi do pierwszego ładowania `/` i `/portfel`. Estymata 1,5 d bez zmian, nakład i odchylenie niezmierzone.
