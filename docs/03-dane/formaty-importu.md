# Formaty plików importu i ich mapowanie na operacje

**Cel:** opisać układ plików, które OligInvest importuje (eksporty XTB i mBank eMakler, archiwum GPW, CSV ze Stooq, szablon ogólny), reguły ich rozpoznawania i normalizacji oraz mapowanie na typy operacji z [`obliczenia-finansowe.md`](obliczenia-finansowe.md) § 1 — tak, aby parsery dało się napisać i przetestować bez dostępu do prawdziwych wyciągów.

Oznaczenia wiarygodności: ✅ zweryfikowane na prawdziwym pliku, 🔶 zweryfikowane pośrednio (parsery open source testowane na prawdziwych eksportach), ❓ **NIEZWERYFIKOWANE** (założenie do potwierdzenia na pierwszym prawdziwym pliku).

Źródła wiedzy o formatach (stan 2026-09-19): [ike-terminal](https://github.com/pulos-lab/ike-terminal) (MIT; parsery XTB i mBank z opisem formatów „zweryfikowanych na eksportach 2007–2026”), [xtb-xlsx-cleaner](https://github.com/Piotr20/xtb-xlsx-cleaner), [xtb-dividend-analysis](https://github.com/darekwojciechowski/xtb-dividend-analysis), pomoc XTB i podatekgieldy.pl. Z projektów tych przejmujemy **wiedzę o formacie**, nie kod.

Pliki przykładowe (syntetyczne) i oczekiwane wyniki: [`fixtures/anonymized/`](fixtures/anonymized/README.md).

---

## 1. Zasady wspólne potoku importu

1. **Wykrywanie formatu** po zawartości, nie po nazwie pliku: typ pliku (XLS BIFF / XLSX / CSV), nazwy arkuszy, sygnatura nagłówka wyszukiwana w pierwszych 40 wierszach (`maxScanRows`), język nagłówków (EN/PL).
2. **Kodowanie CSV:** BOM UTF-8 → UTF-8; poprawny UTF-8 z wielobajtowymi znakami → UTF-8; w przeciwnym razie Windows-1250.
3. **Separator CSV:** wykrywany z wiersza nagłówka (`;` lub `,`).
4. **Liczby:** akceptujemy `1234.56`, `1234,56`, `1 234,56`, `1 234,56` (spacja twarda) i znak minus `-`/`−`; wynik — `Decimal`, nigdy `float`.
5. **Daty:** komórki daty Excela (XLSX/XLS) lub tekst `YYYY-MM-DD HH:mm:ss`, `DD.MM.YYYY HH:mm:ss`, `DD/MM/YYYY HH:mm:ss`; strefa czasowa: Europe/Warsaw, jeśli plik jej nie podaje.
6. **Wynik parsowania** = lista wierszy znormalizowanych (`ImportRow`) ze statusem: `new`, `duplicate`, `unsupported` (np. CFD — z efektem gotówkowym zachowanym jako `ADJUSTMENT`), `needs_mapping` (instrument nierozpoznany), `error` (z kodem i numerem wiersza źródłowego). **Żaden wiersz nie ginie po cichu.**
7. **Idempotencja:** klucz `(account_id, source, external_id)`; gdy broker nie podaje identyfikatora — `sha256(znormalizowany wiersz + numer wystąpienia)`. Ponowny import tego samego pliku → same `duplicate`.
8. **Mapowanie instrumentów:** kolejno ISIN → ticker brokera z sufiksem (tabela `market.instrument_provider_symbols`, źródło `xtb`/`mbank`) → nazwa (mBank podaje tylko nazwę) → ręczne przypisanie przez użytkownika (zapamiętywane per użytkownik i źródło).
9. **Uzgodnienie** (NFR-08.03): po parsowaniu liczymy saldo gotówki i ilości z pliku i porównujemy z sumą operacji; różnice pokazujemy przed zatwierdzeniem.
10. **Bezpieczeństwo:** plik ≤ 10 MB, parsowanie w `jobs` (nigdy w przeglądarce ani w `api`), limit wierszy 50 000, brak wykonywania formuł (SheetJS czyta wartości, nie formuły), surowy plik przechowywany 90 dni (NFR-11.02).

---

## 2. XTB — eksport z xStation 5

Eksport: *Historia konta → Eksport* (ZIP z jednym XLSX na rachunek; od 2025 r. XLSX domyślnie, CSV opcjonalnie). Jeden plik = jeden rachunek i **jedna waluta** (osobne pliki dla subkont PLN/USD/EUR). 🔶

### 2.1 Dwie generacje szablonu 🔶

| Cecha | Szablon nowy (pliki `PLN_*.xlsx`, `USD_*.xlsx`) | Szablon stary (`account_*`) |
|---|---|---|
| Arkusz operacji gotówkowych | `Cash Operations` | `CASH OPERATION HISTORY` |
| Wiersz nagłówka | 5 (nad nim metadane rachunku) | ok. 12–13 (metadane, scalone komórki, pusta pierwsza kolumna) |
| Kolumny operacji | `Type`, (`Ticker`), `Instrument`, `Time`, `Amount`, `ID`, `Comment`, `Product` — dwa warianty: z kolumną `Ticker` i bez niej | `ID`, `Type`, `Time`, `Comment`, `Symbol`, `Amount` |
| Instrument | `Ticker` z sufiksem kraju (`MSFT.US`, `CDR.PL`) lub pełna **nazwa** w `Instrument` | `Symbol` z sufiksem |
| Inne arkusze | `Closed Positions` | `CLOSED POSITION HISTORY`, `OPEN POSITION <data>` |
| Nagłówki PL | ❓ w wersji PL: `Typ`, `Czas`, `Komentarz`, `Kwota` (🔶 wg xtb-dividend-analysis) | jw. |

Kolumny arkusza pozycji zamkniętych (szablon stary) 🔶: `Position`, `Symbol`, `Type` (BUY/SELL), `Volume`, `Open time`, `Open price`, `Close time`, `Close price`, `Open origin`, `Close origin`, `Purchase value`, `Sale value`, `SL`, `TP`, `Margin`, `Commission`, `Swap`, `Rollover`, `Gross P/L`, `Comment`.

### 2.2 Typy operacji i mapowanie

| `Type` (EN; PL w nawiasie, jeśli znane) | Mapowanie OligInvest | Uwagi |
|---|---|---|
| `deposit` | `DEPOSIT` (kwota > 0) lub `WITHDRAWAL` (storno, kwota < 0) | kierunek po znaku kwoty 🔶 |
| `withdrawal` | `WITHDRAWAL` (kwota < 0) lub `DEPOSIT` (kwota > 0) | jw. |
| `Stock purchase` (`Zakup akcji/ETF`) | `BUY` | ilość i cena z `Comment` (§ 2.3); `Amount` = koszt w walucie rachunku |
| `Stock sale` | `SELL` — **w parze z** `close trade` | `Amount` sprzedaży = zwrócony nominał otwarcia; przychód = `Amount(sale) + Amount(close trade)` 🔶 |
| `close trade` | część `SELL` (P/L zamknięcia) albo `ADJUSTMENT(category=cfd_pl)` dla CFD | parowanie po (instrument, czas) |
| `DIVIDENT` / `Dividend` (`Dywidenda`) | `DIVIDEND` (brutto) | literówka `DIVIDENT` występuje w eksportach 🔶 |
| `Withholding Tax` (`Podatek od dywidend`) | pole `tax_withheld` dywidendy (parowanie po instrumencie i czasie), inaczej `TAX` powiązany | kwota ujemna |
| `commission` | `fee` transakcji (parowanie FIFO po instrumencie i czasie) | w nowym szablonie prowizje akcji/ETF zwykle 0 |
| `Sec Fee` | `FEE(subtype=sec_fee)` powiązana ze sprzedażą po dacie z `Comment` | sprzedaż akcji USA |
| `Tax IFTT` i podobne (FTT) | `TAX(subtype=ftt)` powiązany z zakupem | podatek od transakcji finansowych (np. Włochy) |
| `Free-funds Interest` | `INTEREST` | odsetki od wolnych środków |
| `Free-funds Interest Tax` | `TAX(subtype=interest_tax)` | |
| `swap`, `rollover`, `Dividend Equivalent` | `ADJUSTMENT(category=cfd_*)` | dotyczą CFD — nieobsługiwane w modelu pozycji (Z-15) |
| `rights issue` | `ADJUSTMENT(category=corporate_action)` + zadanie dla użytkownika | wymaga ręcznej obsługi |
| `Subaccount Transfer` ❓ | `CASH_TRANSFER_IN/OUT` | nazwa typu niezweryfikowana |
| inny | wiersz `unsupported` z kodem `unknown_operation_type` | zachowany w podglądzie |

### 2.3 Wzorce komentarzy 🔶

| Przykład `Comment` | Znaczenie |
|---|---|
| `OPEN BUY 64 @ 16.00` | zakup 64 szt. po 16,00 (cena w walucie notowania) |
| `OPEN BUY 33/60 @ 35.560` | częściowe wykonanie: 33 z 60 szt. |
| `BUY 0.3069 @ 494.15` | zakup ułamkowy |
| `CLOSE BUY 12 @ 230.00` | sprzedaż (zamknięcie pozycji kupna) 12 szt. po 230,00 — XTB pisze „BUY” także przy sprzedaży |
| `AAPL.US USD 0.2600/ SHR` | dywidenda 0,26 USD na akcję |
| `AAPL.US USD WHT 15%` | podatek u źródła 15 % |

Wyrażenie dla transakcji: `(?:OPEN |CLOSE )?BUY ([\d.]+)(?:/[\d.]+)? @ ([\d.]+)`.

### 2.4 Waluty i kursy

- `Amount` jest zawsze w walucie rachunku (pliku); cena w `Comment` — w walucie notowania.
- Waluta notowania: z sufiksu tickera (`.US` → USD, `.PL` → PLN, `.DE`/`.FR`/`.NL`/`.IT`/`.ES` → EUR, `.UK` → GBP ❓ lub GBX — ceny w pensach dzielimy przez 100) lub z arkusza pozycji zamkniętych; brak → kurs implikowany i ostrzeżenie.
- Kurs implikowany: `|Amount| / (q · p)` — zawiera marżę przewalutowania (0,5 %); zapisujemy go jako `fx_rate` operacji (widok ekonomiczny).
- Sufiks → Yahoo: `.US` → brak sufiksu (`AAPL`), `.PL` → `.WA` (`CDR.WA`), `.DE` → `.DE`, `.UK` → `.L` ❓, `.FR` → `.PA` ❓, `.NL` → `.AS` ❓.

### 2.5 Rozpoznawanie i nieobsługiwane pozycje

- Metadane rachunku (waluta, numer) — z wierszy nad nagłówkiem (szablon stary: ok. wiersz 6, komórka waluty w kolumnie ~L; nowy: wiersze 1–4 „etykieta: wartość”).
- Typ rachunku IKE/IKZE: ❓ nie wynika jednoznacznie z pliku — użytkownik wybiera rachunek docelowy przy imporcie.
- **CFD** (instrumenty bez sufiksu giełdy, np. `US500`, `OIL.WTI`, `GOLD`, produkt `CFD`) → `unsupported` z zachowanym efektem gotówkowym jako `ADJUSTMENT(category=cfd_pl)`, aby saldo gotówki się zgadzało.

---

## 3. mBank eMakler

Eksport: bankowość internetowa → *Inwestycje → eMakler → Historia* → „Pobierz CSV”. Dwa pliki: **historia transakcji** i **historia finansowa**. 🔶

### 3.1 Historia transakcji 🔶

- ~34 wiersze metadanych banku nad nagłówkiem (skanujemy do sygnatury).
- Nagłówek: `Czas transakcji;Papier;Giełda;K/S;Liczba;Kurs;Waluta;Prowizja;Waluta;Wartość;Waluta` — trzy kolumny `Waluta` (kursu, prowizji, wartości).
- Separator: `;` (starsze eksporty) lub `,` (nowsze) — wykrywany. Kodowanie: Windows-1250. Data: `DD.MM.YYYY HH:mm:ss`.
- `K/S`: `K` = kupno, `S` = sprzedaż. `Papier` = **nazwa** instrumentu (brak ISIN) → mapowanie przez nazwę + historię finansową (ISIN w opisach rozliczeń) + ręczne potwierdzenie.
- `Giełda`: m.in. `WWA-GPW`, `USA-NYSE`, `USA-NASDAQ`, `GBR-LSE`, `DEU-XETRA` → MIC `XWAR`, `XNYS`, `XNAS`, `XLON`, `XETR`; brak kolumny waluty → waluta z giełdy (z ostrzeżeniem; `GBR-LSE` bywa kwotowany w USD).
- W nowszych eksportach `Prowizja`, `Wartość` i waluty mogą być puste — prowizja jest wtedy w historii finansowej.
- eMakler rozlicza się **wyłącznie w PLN**; przewalutowanie na rynkach zagranicznych — kurs mid ± 0,1 % (broker zagraniczny). Kurs rozliczenia pochodzi z historii finansowej lub, w ostateczności, z NBP (oznaczone).

### 3.2 Historia finansowa 🔶

- Nagłówek `Data;Opis;Kwota` (separator `;` lub `,`), Windows-1250.
- Klasyfikacja po `Opis`:

| Wzorzec | Mapowanie |
|---|---|
| `Dywidenda z N PW: <ISIN> DP: <data> stawka brutto w wal.: <x> stawka pod.: <y>% [kurs przewalutowania: <k>]` | `DIVIDEND` (brutto = N · x, podatek y %, kurs k) |
| `WYC.BK: …` | `DEPOSIT` |
| `WYP.BK: …` | `WITHDRAWAL` ❓ (wzorzec wnioskowany) |
| `Przelew z r-ku …`, `PRZELEW NA IKZE …`, `ZASILENIE IKZE`, `DOPŁATA DO LIMITU IKZE …` | `DEPOSIT`/`WITHDRAWAL` wg znaku |
| `Blokada środków …`, `Odblokowanie środków …` | pomijane (blokady pod zlecenia) |
| `WYC: … PW: <ISIN>` | pomijane (rozliczenie T+2 transakcji z pliku transakcji) — ale źródło ISIN dla nazwy |
| `IKE/IKZE WYPELNIONY LIMIT` | pomijane (wiersz informacyjny) |
| inne | `unsupported` z kodem `unknown_description` |

---

## 4. Archiwum notowań GPW (dane rynkowe, nie transakcje) ✅

Plik z `https://www.gpw.pl/archiwum-notowan?fetch=1&type=10&instrument=&date=DD-MM-YYYY` (typ 10 = akcje): binarny **XLS (BIFF8)**, jeden arkusz `Worksheet`, nagłówek w wierszu 1, jeden wiersz na instrument (2026-09-16: 402 instrumenty, w tym 38 bez obrotu).

| Kolumna | Znaczenie | Uwagi (zweryfikowane 2026-09-19) |
|---|---|---|
| `Data` | data sesji | tekst `YYYY-MM-DD` |
| `Nazwa` | nazwa skrócona GPW (np. `PKOBP`) | **nie** ticker (`PKO`) — kluczem jest ISIN |
| `ISIN` | identyfikator | klucz mapowania do `market.instruments` |
| `Waluta` | waluta notowania | w pliku akcji: tylko `PLN` |
| `Kurs otwarcia`, `Kurs max`, `Kurs min`, `Kurs zamknięcia` | OHLC | przy braku obrotu — wartości techniczne; świecy nie traktujemy jako notowania |
| `Zmiana` | zmiana % do poprzedniego kursu | kontrola spójności |
| `Wolumen` | liczba sztuk | 0 = brak transakcji |
| `Liczba Transakcji` | liczba transakcji | |
| `Obrót` | wartość obrotu **w tys. zł** | potwierdzone: `Obrót·1000/Wolumen` mieści się w zakresie min–max dnia (PKO BP, KGHM, PZU, Orlen, Allegro) |
| `Liczba otwartych pozycji`, `Wartość otwartych pozycji` | dla instrumentów pochodnych | w pliku akcji: 0 |
| `Cena nominalna` | | informacyjnie |

Zasady: wiersze z `Wolumen = 0` zapisujemy z flagą `no_trades` (nie tworzą świecy do wskaźników, ale utrzymują ciągłość wyceny); kody `type` dla ETF, indeksów i obligacji ❓ do zmapowania w M2; plik z datą nie-sesyjną zwraca pustą tabelę (kalendarz).

## 5. Stooq — CSV (import ręczny przez admina) 🔶

Nagłówek (wersja polska): `Data,Otwarcie,Najwyzszy,Najnizszy,Zamkniecie,Wolumen` (wersja angielska: `Date,Open,High,Low,Close,Volume`); separator `,`, kropka dziesiętna, data `YYYY-MM-DD`. Instrument wybiera admin przy imporcie (plik nie zawiera identyfikatora). Automatyczne pobieranie jest niedozwolone ([ADR-005](../09-decyzje/ADR-005-strategia-danych-rynkowych.md)).

## 6. Szablon ogólny OligInvest (CSV, FR-03.03/FR-03.04)

Kodowanie UTF-8, separator `,`, kropka dziesiętna, nagłówek obowiązkowy:

```
date,type,isin,ticker,mic,quantity,price,price_currency,amount,amount_currency,fee,fee_currency,tax,tax_currency,fx_rate,external_id,note
2025-03-03,BUY,US0378331005,AAPL,XNAS,10,240.00,USD,-9599.76,PLN,0,PLN,0,PLN,3.9999,ext-1,
2025-08-14,DIVIDEND,US0378331005,AAPL,XNAS,,,,14.28,PLN,,,2.14,PLN,,ext-2,WHT 15%
2025-10-15,WITHDRAWAL,,,,,,,-1000.00,PLN,,,,,,ext-3,
```

`type` ∈ typy z `obliczenia-finansowe.md` § 1; `amount` ze znakiem z perspektywy gotówki rachunku. Dla plików innych brokerów użytkownik tworzy **szablon mapowania kolumn** (FR-03.04), zapisywany w `portfolio.import_templates`.

## 7. Pliki przykładowe (syntetyczne)

| Plik | Co sprawdza |
|---|---|
| `fixtures/anonymized/xtb/xtb-syntetyczny-nowy-szablon-PLN.xlsx` | szablon nowy z kolumną `Ticker`, nagłówek w wierszu 5, komórki dat Excela |
| `fixtures/anonymized/xtb/xtb-syntetyczny-stary-szablon-PLN.xlsx` | szablon stary (pusta pierwsza kolumna, nagłówek w wierszu 12), arkusze pozycji, wiersz CFD |
| `fixtures/anonymized/mbank/mbank-syntetyczny-historia-transakcji.csv` | Windows-1250, `;`, metadane nad nagłówkiem, wiersz USA bez wartości |
| `fixtures/anonymized/mbank/mbank-syntetyczny-historia-finansowa.csv` | klasyfikacja opisów, kwoty z przecinkiem i spacją tysięcy |
| `fixtures/anonymized/oczekiwane-wyniki.json` | oczekiwane pozycje, gotówka, P/L, dywidendy, wiersze nieobsługiwane |

Oba pliki XTB zawierają **te same operacje logiczne** — parser musi dać z nich identyczny wynik (test parytetu), a dla AAPL odtworzyć przykład A z `obliczenia-finansowe.md` (P/L ekonomiczny −1 083,63 PLN). Pliki są syntetyczne; gdy właściciel dostarczy prawdziwy (zanonimizowany) eksport, dodajemy go obok i korygujemy oznaczenia ❓ w tym dokumencie.
