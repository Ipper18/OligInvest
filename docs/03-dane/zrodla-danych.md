# Źródła danych rynkowych — tabela porównawcza i role w systemie

**Cel:** wybrać darmowe źródła danych (notowania, kursy walut, makro, newsy, import brokerski) ze zweryfikowanymi limitami i warunkami licencyjnymi oraz przypisać każdemu rolę (primary / fallback / makro / import) w warstwie `DataProvider`.

Data weryfikacji: **2026-09-18**. Oznaczenia: ✅ zweryfikowane bezpośrednio (strona dostawcy / odpowiedź API), 🔶 zweryfikowane pośrednio (dokumentacja techniczna, issue trackery, wiarygodne źródła wtórne — strona cennika nie renderuje się bez JS), ❓ **NIEZWERYFIKOWANE** (podane z zastrzeżeniem, do sprawdzenia przed implementacją).

## 1. Wnioski kluczowe

1. **GPW EOD:** oficjalne archiwum GPW zwraca jednym żądaniem XLS z całym rynkiem za dany dzień — to primary. Stooq blokuje automaty (challenge JS) — tylko ręczny import.
2. **Intraday (opóźnione):** wyłącznie Yahoo Finance (nieoficjalne, „personal use only”) obsługuje GPW (`PKO.WA`, `WIG20.WA`, waluta PLN) i USA w jednym miejscu za 0 zł. Wszystkie oficjalne API dają GPW tylko w planach płatnych. Stąd architektura: **dane EOD są trwałe w naszej bazie**, a intraday to warstwa „best effort” z jawnym znacznikiem czasu.
3. **FX:** NBP (kurs podatkowy D-1) primary, Frankfurter (ECB, self-host) fallback.
4. **Budżety zapytań są twardym ograniczeniem architektonicznym** (25/dobę Alpha Vantage, 800/dobę Twelve Data, 100/dobę Marketaux) → planowanie kwot i twardy cache (`strategia-cache.md`).
5. **Licencje:** żadne z darmowych źródeł nie pozwala na *redystrybucję publiczną*; aplikacja jest prywatna (właściciel + zaufani), ale Tiingo („internal use only”) wyklucza nawet to → nie używamy.

## 2. Tabela porównawcza

| Dostawca | Zakres (klasy aktywów, giełdy, czy GPW) | Limit free | Opóźnienie danych | Wymaga karty? | Licencja / redystrybucja w publicznej aplikacji | Stabilność | Rola w naszym systemie | Link do ToS / źródła |
|---|---|---|---|---|---|---|---|---|
| **GPW — Archiwum notowań** ✅ | Akcje GPW (cały rynek w jednym pliku/dzień; parametr `type=10` = akcje; kody dla ETF/indeksów/obligacji ❓ do zmapowania). Kolumny: Nazwa, ISIN, Waluta, Kurs otwarcia/max/min/zamknięcia, Zmiana, Wolumen, Liczba transakcji, Obrót. | Brak opublikowanego limitu; 1 żądanie = ~125 KB; **odrzuca klientów bez nagłówków przeglądarkowych** (curl: connection reset) — używać realistycznego `User-Agent`, 1 żądanie/dzień | EOD (po sesji) | Nie | ❓ Dane GPW objęte prawami GPW; użytek prywatny, **bez redystrybucji**; brak jawnej licencji na stronie | Wysoka (archiwum od lat), format XLS może się zmienić → parser z testem kontraktowym | **PRIMARY EOD GPW** (batch nocny, backfill historii dzień po dniu) | https://www.gpw.pl/archiwum-notowan (`?fetch=1&type=10&instrument=&date=DD-MM-YYYY`) |
| **Yahoo Finance** (yfinance 1.7.0 / endpoint `v8/finance/chart`) ✅ | Akcje, ETF, indeksy, FX, krypto — globalnie, **w tym GPW** (`PKO.WA`, `WIG20.WA`, waluta PLN, TZ Europe/Warsaw — sprawdzono) | Brak oficjalnego; nieoficjalne API, rate limiting i okresowe blokady (❓ próg) | Intraday opóźnione (GPW: ❓ 15 min; meta nie zwraca `exchangeDataDelayedBy`), EOD z korektami | Nie | „Yahoo! finance API is intended for personal use only” (README yfinance, Apache-2.0 dla biblioteki); dane wg ToS Yahoo — **brak prawa redystrybucji** | Średnia — zmiany bez zapowiedzi; **nie może być jedynym źródłem** | **PRIMARY intraday (GPW + USA)**, fallback EOD, PRIMARY indeksy (WIG20.WA, ^GSPC) | https://github.com/ranaroussi/yfinance · https://legal.yahoo.com/ (❓ treść) |
| **Stooq** ✅ | Akcje/indeksy GPW i świat, CSV historyczne | Endpoint CSV zwraca **challenge JS (proof-of-work)** — automatyczne pobieranie zablokowane (test 2026-09-18) | EOD | Nie | ❓ Regulamin Stooq; użytek osobisty | Niska dla automatów | **Ręczny import CSV** przez użytkownika (fallback/backfill historii sprzed 2000 r.) | https://stooq.pl/ |
| **NBP Web API** ✅ | Kursy średnie (tabela A/B), kupna/sprzedaży (C), ceny złota; archiwum od 2002 (kursy) / 2013 (złoto) | Brak opublikowanych limitów; **max 93 dni na zapytanie**; od 2025-08-01 tylko HTTPS | Publikacja dzienna ~12:15 CET | Nie | Dane publiczne NBP; strona: „© NBP, wszelkie prawa zastrzeżone” — ❓ brak jawnej licencji; wyświetlanie kursów z podaniem źródła powszechnie praktykowane | Wysoka (instytucja publiczna) | **PRIMARY FX** (kurs D-1 do rozliczeń podatkowych), PRIMARY złoto | https://api.nbp.pl/ |
| **Frankfurter** ✅ | 206 walut, 98 źródeł (ECB jako baza), PLN tak | Bez kwot dziennych („no monthly or daily caps”), rate-limit anty-abuse; **self-host Docker** | Dzienne (ECB ~16:00 CET) | Nie | Darmowe komercyjnie; dane wg warunków ECB (dozwolone z podaniem źródła) | Wysoka; self-host eliminuje zależność | **FALLBACK FX** (gdy NBP niedostępny), kursy krzyżowe | https://frankfurter.dev/ |
| **Alpha Vantage** ✅ | Akcje globalne (sufiksy giełd; GPW ❓ `.WAR` niepotwierdzone), FX, krypto, makro USA, 50+ wskaźników TA, `NEWS_SENTIMENT` | **25 zapytań/dobę** | EOD; realtime/15-min USA tylko premium | Nie | ToS: użytek osobisty/niekomercyjny w free (❓ pełna treść); brak redystrybucji | Wysoka, ale kwota mikroskopijna | FALLBACK EOD USA; `NEWS_SENTIMENT` dla ≤ 10 tickerów/dobę; **MCP w środowisku dev** | https://www.alphavantage.co/premium/ · https://www.alphavantage.co/terms_of_service/ |
| **Finnhub** 🔶 | Akcje USA (realtime), newsy spółek, fundamenty podstawowe, FX, krypto; **giełdy międzynarodowe (GPW) tylko płatne** | **60 zapytań/min** (limit wewn. 30/s); websocket trial | Realtime USA | Nie | „personal, non-commercial” w free; brak redystrybucji | Wysoka | FALLBACK notowania USA, newsy USA per ticker | https://finnhub.io/docs/api/rate-limit · https://github.com/finnhubio/Finnhub-API/issues/122 |
| **Twelve Data** ✅ | Plan Basic: akcje i ETF USA (realtime), FX; **GPW (XWAR) tylko w planach płatnych** (❓ Grow ~29 USD/mies.) | **8 kredytów/min, 800/dobę**, 8 trial WS | Realtime USA | Nie | Free: użytek osobisty (❓ treść ToS); brak redystrybucji | Wysoka | FALLBACK USA; **MCP w dev** (logowanie OAuth) | https://twelvedata.com/pricing |
| **Tiingo** ✅ | EOD USA „Composite Prices”; reszta w Power (30 USD/mies.) | 50 zapytań/h, **1 000/dobę**, 500 symboli/mies., 1 GB/mies. | EOD | Nie | **„Internal Use Only — you may not display or share the data with another person or organization”** → wyklucza nawet zaufanych użytkowników | Wysoka | ⛔ **nie używać** | https://www.tiingo.com/about/pricing |
| **Massive (dawniej Polygon.io)** ✅ | Akcje USA (100 % pokrycia); rebranding Polygon → Massive (przekierowanie `polygon.io/pricing`) | **5 zapytań/min**, **2 lata historii**, bez websocket | EOD | ❓ | „Individual use” | Wysoka | FALLBACK EOD USA (krótka historia → tylko uzupełnianie luk) | https://massive.com/pricing |
| **EODHD** ✅ | Free: **20 zapytań/dobę**, ❓ tylko wybrane tickery (AAPL, TSLA, …) i 1 rok; plan „All World” (GPW) **19,99 USD/mies.** | 20/dobę, 1 000/min | EOD | Nie (free trial bez karty) | Free do testów; komercyjne plany płatne | Wysoka | ⛔ free bezużyteczny; **jedyna sensowna płatna opcja dla GPW EOD** → `10-ograniczenia.md` | https://eodhd.com/pricing |
| **Financial Modeling Prep (FMP)** 🔶 | **Tylko giełdy USA** w free; fundamenty (5 kwartałów), ceny (5 lat) | **250 zapytań/dobę**, 500 MB/30 dni; 429 po przekroczeniu | EOD | Nie | Free: użytek niekomercyjny (❓); brak redystrybucji | Średnia (zmiany endpointów „stable”/„v3” w 2025) | FALLBACK fundamenty USA (screener USA); brak GPW | https://site.financialmodelingprep.com/pricing-plans (403 dla fetchera) · FAQ FMP |
| **FRED (St. Louis Fed)** ✅ | Makro USA i część globalna (stopy, CPI, PKB, bezrobocie), ponad 800 tys. serii | Klucz darmowy po rejestracji; limit ❓ (nieopublikowany; społecznie ~120 zapytań/min) | Zależnie od serii | Nie | **Obowiązkowa notka:** „This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.”; serie stron trzecich mogą mieć własne ograniczenia | Wysoka | **PRIMARY makro USA/global**; makro PL → GUS/Eurostat (poza MVP, ❓) | https://fred.stlouisfed.org/docs/api/terms_of_use.html |
| **SEC EDGAR (data.sec.gov)** ✅ | Filingi i XBRL spółek USA (`submissions`, `companyfacts`, `frames`) | **10 zapytań/s**, wymagany `User-Agent: Nazwa kontakt@domena`; zakaz crawlerów | Wg publikacji | Nie | Domena publiczna (dane rządowe USA) | Wysoka | SECONDARY fundamenty USA (poza MVP) | https://www.sec.gov/os/accessing-edgar-data |
| **CoinGecko Demo** ✅ | Krypto (ceny, kapitalizacja, historia) | **100 zapytań/min, 10 000 kredytów/mies.** | ~1–5 min | Nie | Atrybucja „Data provided by CoinGecko” + link; zakaz redystrybucji/sprzedaży | Wysoka | PRIMARY krypto (poza MVP) | https://www.coingecko.com/en/api/pricing |
| **GDELT DOC 2.0** ✅ | Wyszukiwanie artykułów w 65 językach (w tym PL), histogramy tonu, timeline'y; okno 3 mies. | Brak klucza; limity nieopublikowane (❓; praktyka: 1 zapytanie/5 s) | ❓ ~15 min (cykl aktualizacji GDELT) | Nie | Otwarte dane; atrybucja GDELT | Średnia (przeciążenia) | **PRIMARY newsy + „ton” artykułów** (uwaga: ton ≠ sentyment inwestorski — komunikować jako taki) | https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/ (`https://api.gdeltproject.org/api/v2/doc/doc?query=…&mode=…&format=json`) |
| **Marketaux** ✅ | Newsy finansowe, 80+ rynków, 5 000+ źródeł; encje/sentyment tylko płatne | **100 zapytań/dobę, 3 artykuły/zapytanie** | ❓ | Nie | ❓ atrybucja/komercja niepodane na stronie cennika | Średnia | FALLBACK newsy per ticker | https://www.marketaux.com/pricing |
| **XTB xAPI (xStation5 API)** ✅ (dokumentacja) | Konto XTB: historia transakcji (`getTradesHistory`), otwarte pozycje (`getTrades`), saldo (`getMarginLevel`), symbole (`getAllSymbols`), świece (`getChartRangeRequest`) | Darmowe z kontem; **200 ms między komendami** (6 naruszeń = rozłączenie), 50 połączeń/IP, ≤ 1 kB/komenda; WebSocket SSL `wss://ws.xapi.pro/real` (dokumentacja X Open Hub; biblioteki wskazują też `wss://ws.xtb.com/real`), porty 5112/5113 (real), 5124/5125 (demo) | Realtime (dane XTB, symbole CFD/akcje wg oferty XTB) | Nie | ❓ Regulamin XTB dla klientów detalicznych; login = **hasło do rachunku** → wymóg bezpieczeństwa: nie przechowywać, sesja ad hoc (docs 06) | Średnia (protokół stabilny od lat, hosty zmieniane) | **Import pozycji/transakcji z XTB (opcja „na żywo”)**; MVP = eksport plikowy | https://xopenhub.pro/api/xapi-protocol-documentation/ |
| **XTB xStation — eksport XLSX/CSV** 🔶 | Historia konta → „Eksport”: ZIP z XLSX per konto (od 2025 XLSX domyślnie, CSV opcjonalnie); zawiera transakcje, operacje gotówkowe, dywidendy | — | — | Nie | Dane własne użytkownika | Format zmienia się (2025: wyłączono stary XLS) → parser z fixture’ami | **PRIMARY import transakcji (MVP)** | https://www.xtb.com/int/help-center/our-platforms-5-1/history-on-the-xstation-platform-1 · https://podatekgieldy.pl/pl/pomoc/brokerzy/xtb |
| **mBank eMakler — eksport CSV** 🔶 | Historia operacji → „Pobierz CSV”; kolumny ❓ (data, typ, symbol, ilość, cena, waluta); zestawienia podatkowe PDF | — | — | Nie | Dane własne użytkownika | Format niestandaryzowany → fixture z realnego pliku | SECONDARY import transakcji | https://podatekgieldy.pl/pl/pomoc/brokerzy/mbank-emakler · https://www.fundstat.pl/pl/docs/import-mbank-emakler |
| **GPW Benchmark** 🔶 | Indeksy GPW (WIG, WIG20, mWIG40, sWIG80…), „Dane historyczne”, „Dane opóźnione” | ❓ | Opóźnione 15 min na stronie | Nie | ❓ licencja indeksów GPW Benchmark (dane indeksowe są licencjonowane komercyjnie) | Wysoka | FALLBACK indeksy (primary: Yahoo `WIG20.WA`) | https://gpwbenchmark.pl/ |

## 3. Źródła przejrzane i odrzucone

| Źródło | Powód |
|---|---|
| Tiingo | licencja „internal use only” |
| EODHD free | 20 zapytań/dobę i ograniczone tickery; opcja płatna opisana w `10-ograniczenia.md` |
| IEX Cloud | zamknięty (2024) |
| NewsAPI.org free | tylko development, brak użycia produkcyjnego, 24 h opóźnienia (❓ stan 2026) |
| Quandl/Nasdaq Data Link | większość zbiorów płatna, darmowe zdegradowane |
| Bankier/Money.pl/BiznesRadar | brak API; scraping naruszałby regulaminy |

Listy przeszukane: [public-apis (Finance)](https://github.com/public-apis/public-apis), [awesome-quant (Data Sources)](https://github.com/wilsonfreitas/awesome-quant) — patrz uzupełnienie w sekcji 5.

## 4. Mapa ról → moduły

| Potrzeba | Primary | Fallback 1 | Fallback 2 | Ręcznie |
|---|---|---|---|---|
| EOD akcje GPW | GPW archiwum (XLS) | Yahoo `.WA` | — | Stooq CSV |
| EOD akcje/ETF USA | Yahoo | Alpha Vantage (25/d) | Massive (2 lata) | — |
| Intraday opóźnione GPW | Yahoo | — (brak darmowej alternatywy) | — | — |
| Intraday opóźnione USA | Yahoo | Finnhub (60/min) | Twelve Data (800/d) | — |
| Indeksy | Yahoo (`WIG20.WA`, `^GSPC`) | GPW Benchmark | — | — |
| FX PLN/USD/EUR | NBP | Frankfurter (self-host) | — | — |
| Fundamenty USA | FMP (250/d) | SEC EDGAR | Alpha Vantage | — |
| Fundamenty GPW | ❌ brak darmowego API (raporty ESPI → poza MVP) | — | — | ręczne pola |
| Makro | FRED | NBP (stopy) | — | — |
| Newsy + ton | GDELT | Marketaux | Finnhub (USA) | — |
| Kalendarz earnings | Alpha Vantage `EARNINGS_CALENDAR` (USA) | FMP | — | GPW: kalendarium ESPI ❓ |
| Transakcje użytkownika | XTB XLSX/CSV | mBank CSV | XTB xAPI (opcjonalnie) | formularz ręczny |

## 5. Uzupełnienia z katalogów (public-apis, awesome-quant)

Przejrzano sekcje *Finance* i *Currency Exchange* w [public-apis](https://github.com/public-apis/public-apis) (README, 2026-09-18) oraz *Data Sources* i *Portfolio/Risk* w [awesome-quant](https://github.com/wilsonfreitas/awesome-quant). Pozycje, które wnoszą coś nowego względem tabeli § 2 (wszystkie ❓ do weryfikacji limitów przed użyciem — nie są potrzebne w MVP):

| Kandydat | Co daje | Auth | Potencjalna rola | Status |
|---|---|---|---|---|
| [OpenFIGI](https://www.openfigi.com/api) (Bloomberg) | mapowanie ISIN ↔ ticker ↔ giełda (MIC) | klucz opcjonalny (wyższe limity) | **mapowanie symboli** między dostawcami (`instrument_provider_symbols`) — rozwiązuje problem `PKO` / `PKO.WA` / `PKO.WAR` | ❓ limity free |
| [Econdb](https://www.econdb.com/api/) | makro globalne (w tym Polska) | brak | makro PL (CPI, stopy, PKB) — alternatywa dla GUS/Eurostat | ❓ |
| Eurostat przez [pandas-datareader](https://github.com/pydata/pandas-datareader) | makro UE/PL | brak | makro PL w workerze Python | ❓ (biblioteka słabo utrzymywana) |
| [Currency-api (fawazahmed0)](https://github.com/fawazahmed0/currency-api#readme) | kursy 150+ walut z CDN (jsDelivr), „no rate limits” | brak | FALLBACK FX nr 3 (po NBP i Frankfurterze) | ❓ jakość/źródło kursów |
| [Exchangerate.dev](https://exchangerate.dev/docs) | FX zgodne z API Frankfurtera, 168 par od 1999, 10 tys./mies. | brak | zamiennik Frankfurtera bez self-hostu | ❓ |
| [Goldprice.dev](https://goldprice.dev/docs) | złoto/srebro/miedź spot + 30 lat historii, 13 walut | brak | fallback dla złota (primary: NBP) | ❓ |
| [Marketstack](https://marketstack.com/) | EOD 70+ giełd (❓ czy GPW) | klucz | ewentualny FALLBACK EOD GPW | ❓ free ~100 zapytań/mies. (za mało na produkcję) |
| [Fed Treasury FiscalData](https://fiscaldata.treasury.gov/api-documentation/) | dane skarbu USA (rentowności, aukcje) | brak | makro USA uzupełniające FRED | ❓ |
| [yahooquery](https://github.com/dpguthrie/yahooquery) | alternatywny klient nieoficjalnego API Yahoo | — | zapasowa implementacja adaptera Yahoo, gdy `yfinance` przestanie działać | — |

Odrzucone z katalogów: investpy (scraping Investing.com — regularnie blokowany, naruszenie ToS), akshare/jugaad/nsetools (rynki Azji), IEX Cloud (zamknięty), Alpaca (broker USA, wymaga konta), Portfolio Optimizer API (mamy PyPortfolioOpt lokalnie — brak sensu wysyłać portfela na zewnątrz), StockData/Styvio/Finage/Intrinio (płatne lub trial).
