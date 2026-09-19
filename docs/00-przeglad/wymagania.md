# Wymagania funkcjonalne i niefunkcjonalne

**Cel:** zdefiniować mierzalnie, co OligInvest ma robić (FR) i jakie ma spełniać cechy jakościowe (NFR) — z identyfikatorami, priorytetami i kryteriami akceptacji, na których opiera się architektura, backlog i macierz pokrycia — oraz jawnie wypisać zastrzeżenia do specyfikacji.

Źródło: [`specyfikacja-zrodlowa.md`](specyfikacja-zrodlowa.md) (oznaczenia „§”). Wizja i zakres: [`wizja-produktu.md`](wizja-produktu.md). Pojęcia: [`slownik-pojec.md`](slownik-pojec.md).

## 0. Konwencje

- **Identyfikatory:** `FR-XX.YY` / `NFR-XX.YY`. Człon `XX` to obszar (np. `FR-01` = analiza rynku, `NFR-01` = wydajność), `YY` — konkretne wymaganie. Identyfikatorów nie zmieniamy ani nie używamy ponownie; wymaganie wycofane dostaje status „wycofane” i zostaje w tabeli.
- **Priorytet (P):**
  - **P0** — MVP (etap M1): bez tego produkt nie ma sensu.
  - **P1** — ważne, zaraz po MVP (M2–M4; panele admina w M5a — ADR-006; kilka wymagań P1 wchodzi już do M1, bo są warunkiem udostępnienia aplikacji innym osobom).
  - **P2** — pełny produkt (głównie M5a–M5b).
  - **P3** — opcjonalne; po M6, jeśli nie koliduje z NFR.
  Priorytet mówi, co jest ważniejsze i co wycinamy przy braku czasu; etap przypisuje [`../08-plan/backlog.md`](../08-plan/backlog.md) według zasad z [`../08-plan/roadmapa.md`](../08-plan/roadmapa.md) § 1.
- **Kryterium akceptacji** jest warunkiem zamknięcia zadania w backlogu (Definition of Done w `CONTRIBUTING.md`).
- „Dane opóźnione” = notowania z opóźnieniem ~15 min lub większym; „EOD” = dane dzienne po zamknięciu sesji (patrz Z-01).

---

## 1. Wymagania funkcjonalne

### FR-01 Analiza rynku (§3.1.1)

| ID | Wymaganie | P | Kryterium akceptacji | § |
|---|---|---|---|---|
| FR-01.01 | Wyszukiwarka instrumentów po tickerze, nazwie i ISIN (akcje i ETF z GPW i USA, indeksy, pary walutowe); wynik pokazuje giełdę (MIC), walutę i źródło danych. | P0 | Wpisanie „PKO”, „PKO BP” lub „PLPKO0000016” zwraca PKO BP (XWAR, PLN) w < 300 ms (p95) z lokalnego katalogu; brak trafienia → wyszukanie u dostawcy w tle i dopisanie do katalogu. | 3.1.1 |
| FR-01.02 | Karta instrumentu: ostatni kurs, zmiana dzienna (kwotowo i %), wolumen, zakres 52 tyg., waluta, źródło, znacznik czasu i opóźnienie danych. | P0 | Dla `PKO@XWAR` i `AAPL@XNAS` widoczne wszystkie pola; etykieta „opóźnione ~15 min” / „zamknięcie z DD.MM” zgodna z metadanymi odpowiedzi (`asOf`, `delayMinutes`). | 3.1.1 |
| FR-01.03 | Wykres świecowy OHLC z wolumenem: interwały 1D/1W/1M z historii EOD (≥ 10 lat, jeśli dostępna), przybliżanie i przesuwanie gestami i myszą. | P0 | 10 lat danych dziennych przychodzi jedną odpowiedzią ≤ 3 000 punktów (decymacja dla 1W/1M); przewijanie bez zadań > 50 ms na profilu mobilnym. | 3.1.1, 4.1 |
| FR-01.04 | Interwały intraday (15 min, 1 h) z danych opóźnionych — dla instrumentów, dla których dostawca je udostępnia. | P2 | Etykieta opóźnienia widoczna; przy braku danych przełącznik nieaktywny z wyjaśnieniem. | 3.1.1 |
| FR-01.05 | Wskaźniki techniczne: SMA, EMA, wstęgi Bollingera (nakładki), RSI, MACD, ATR (panele) z konfigurowalnymi parametrami, liczone w `packages/core`. | P1 | Wartości zgodne z TA-Lib (wspólne wektory testowe) z tolerancją 1e-8. | 3.1.1 |
| FR-01.06 | Volume Profile w wersji przybliżonej z barów dziennych, jawnie oznaczony jako przybliżenie. | P3 | Opis metody i ograniczeń w podpowiedzi; wynik deterministyczny dla danych testowych. | 3.1.1 |
| FR-01.07 | Kontekstowe wyjaśnienie każdego wskaźnika (co mierzy, jak czytać, pułapki) — realizowane przez FR-06.02. | P1 | Każdy wskaźnik ma ikonę „?” z opisem dostępnym z klawiatury i dla czytnika ekranu. | 3.1.1, 3.1.6 |
| FR-01.08 | Watchlisty: wiele list, dodawanie/usuwanie, kolejność, notatka przy instrumencie. | P1 | 3 listy × 50 instrumentów; lista 50 pozycji renderuje się < 100 ms po otrzymaniu danych. | 3.1.1 |
| FR-01.09 | Indeksy i benchmarki: WIG20, WIG, mWIG40, sWIG80, S&P 500, Nasdaq-100 (oraz ETF-y jako zamienniki) dostępne na wykresach i w porównaniach. | P1 | Każdy wymieniony indeks ma w bazie historię EOD ≥ 5 lat. | 3.1.1, 3.1.3 |
| FR-01.10 | Heatmapa sektorowa: GPW (sektory wg subindeksów sektorowych), USA (sektory wg klasyfikacji dostawcy); kolor = zmiana w okresie, rozmiar = obrót lub kapitalizacja; alternatywa tabelaryczna. | P2 | Heatmapa GPW obejmuje ≥ 90 % spółek z subindeksów sektorowych; widok tabeli z tymi samymi danymi. | 3.1.1 |
| FR-01.11 | Screener z kryteriami użytkownika (cena, zmiana %, wolumen/obrót, wskaźniki techniczne; dla USA podstawowe fundamenty, gdy dostępne), zapisywane zestawy kryteriów; uniwersum: cała GPW + zdefiniowane uniwersum USA. | P2 | Zapytanie na uniwersum GPW zwraca wynik < 1 s z danych lokalnych; wynik bez języka rekomendacji. | 3.1.1, 3.1.4 |
| FR-01.12 | Kalendarz: wyniki spółek (USA z dostawcy; GPW — wpisy admina) i dane makro (publikacje z FRED, decyzje RPP — wpisy admina), filtr „tylko moje pozycje i watchlisty”. | P2 | Kalendarz USA odświeżany raz dziennie jednym zapytaniem; wpis admina widoczny dla wszystkich. | 3.1.1 |
| FR-01.13 | Newsy dla instrumentu i rynku z „tonem” artykułów (GDELT) i opcjonalnym sentymentem dostawcy (USA), z opisem metody i źródła. | P3 | Każdy artykuł ma źródło, datę i link; ton opisany jako „ton artykułów, nie sygnał inwestycyjny”. | 3.1.1 |
| FR-01.14 | Kursy walut NBP (tabela A — bieżące i historyczne) i ceny złota NBP; przeliczenia PLN ↔ USD/EUR w całej aplikacji. | P0 | Kurs USD/PLN dla dnia D zgodny z tabelą A NBP z dnia D (lub ostatniego dnia roboczego); użycie kursu ECB (fallback) oznaczone w UI. | 3.1.2 |
| FR-01.15 | Status danych: każdy widok z danymi rynkowymi pokazuje wiek danych, źródło i flagę „nieaktualne” z przyczyną (limit dostawcy, awaria, poza sesją). | P0 | Symulowana awaria dostawcy → ostatnie dane z flagą „nieaktualne” w ≤ 1 cyklu odświeżania; brak pustych ekranów. | 3.1.1, 6.5 |

### FR-02 Portfel — stan obecny (§3.1.2)

| ID | Wymaganie | P | Kryterium akceptacji | § |
|---|---|---|---|---|
| FR-02.01 | Wiele rachunków na użytkownika (np. „XTB — zwykły”, „XTB — IKE”, „mBank”) z walutą rachunku i typem (zwykły / IKE / IKZE); widok zbiorczy. | P0 | 3 rachunki; widok zbiorczy sumuje wartości w PLN. | 3.1.2 |
| FR-02.02 | Pozycje: instrument, ilość, średni koszt (wg metody rachunku), wartość bieżąca, udział %, P/L niezrealizowany (kwotowo i %) w walucie instrumentu i w PLN. | P0 | Dla portfela z wektorów testowych wartości zgodne z `03-dane/obliczenia-finansowe.md` co do 0,01 PLN. | 3.1.2 |
| FR-02.03 | Wycena portfela aktualizowana automatycznie (dane opóźnione w trakcie sesji, zamknięcia po sesji) bez przeładowania strony; znacznik czasu wyceny. | P0 | Po aktualizacji notowań w cache wycena w otwartej karcie zmienia się w ≤ 5 s (SSE); poza sesją widoczny kurs zamknięcia z datą. | 3.1.2 |
| FR-02.04 | Gotówka na rachunku per waluta (z importu i operacji ręcznych), uwzględniona w wartości i alokacji. | P0 | Saldo gotówki po imporcie XTB zgodne z wyciągiem (różnica 0,00). | 3.1.2 |
| FR-02.05 | Alokacja wg klasy aktywów, sektora, geografii (kraj emitenta / rynek notowań) i waluty — wykres i tabela; ręczne nadpisanie klasyfikacji instrumentu. | P1 | Suma udziałów = 100 % (±0,01 p.p.); instrument bez klasyfikacji → „Nieokreślone” z podpowiedzią. | 3.1.2 |
| FR-02.06 | Ekspozycja walutowa: udział walut i rozbicie wyniku pozycji zagranicznych na efekt ceny i efekt kursu. | P1 | Dla pozycji w USD: efekt ceny + efekt kursu = P/L w PLN (tolerancja 0,01 PLN). | 3.1.2 |
| FR-02.07 | P/L zrealizowany (FIFO domyślnie, średnia ważona opcjonalnie) za dzień / miesiąc / rok / YTD / od początku, z prowizjami i kosztami przewalutowania; dwa widoki: ekonomiczny i podatkowy (Z-16). | P0 | Dla anonimizowanego wyciągu XTB wynik zgodny z raportem brokera co do 0,01 PLN albo różnica wyjaśniona w raporcie uzgodnienia. | 3.1.2, 3.1.3 |
| FR-02.08 | Dywidendy: otrzymane (brutto, podatek u źródła, netto, w walucie i w PLN), historia per pozycja i rok; stopa dywidendy od kosztu. | P1 | Dywidendy z importu XTB z podatkiem u źródła; suma roczna zgodna z wyciągiem. | 3.1.2 |
| FR-02.09 | „Wynik dnia”: zmiana wartości portfela od poprzedniego zamknięcia z rozbiciem na pozycje (udostępniany także Skrótom, FR-09.04). | P0 | Wartość = wycena bieżąca − wycena na zamknięciu D-1 − przepływy dnia. | 3.1.2, 4.4 |
| FR-02.10 | Historia wartości portfela: wartość rynkowa vs skumulowane wpłaty netto, markery przepływów. | P1 | Wykres 5-letni renderuje się < 300 ms po otrzymaniu danych. | 3.1.2, 3.1.3 |

### FR-03 Analiza inwestycji przeszłych (§3.1.3)

| ID | Wymaganie | P | Kryterium akceptacji | § |
|---|---|---|---|---|
| FR-03.01 | Import z XTB (eksport XLSX/CSV z xStation): podgląd przed zapisem, mapowanie instrumentów (ISIN/ticker), deduplikacja (idempotentny ponowny import), raport błędów i uzgodnienie sald. | P0 | Ponowny import tego samego pliku nie tworzy duplikatów; 5 000 wierszy < 30 s; wiersze nieobsługiwane (np. CFD) oznaczone, nie gubione. | 3.1.3 |
| FR-03.02 | Import z mBank eMakler (CSV). | P1 | Kryteria jak FR-03.01 dla anonimizowanego pliku mBank. | 3.1.3 |
| FR-03.03 | Ręczne dodawanie, edycja i usuwanie operacji: kupno, sprzedaż, dywidenda, odsetki, opłata, podatek, wpłata, wypłata, przelew między rachunkami, przewalutowanie, split/scalenie, przeniesienie papierów. | P0 | Każdy typ operacji ma walidację (Zod) i test wpływu na pozycje i gotówkę; edycja przelicza pozycje w ≤ 5 s. | 3.1.3 |
| FR-03.04 | Import generyczny CSV z mapowaniem kolumn i zapamiętywanymi szablonami. | P2 | Plik z nietypowymi nagłówkami importuje się po zmapowaniu; szablon zapisany i użyty ponownie. | 3.1.3 |
| FR-03.05 | Koszt nabycia (cost basis): FIFO (domyślnie; zgodne z polskimi przepisami podatkowymi) i średnia ważona; lista partii z historią zużycia; przeliczenie po zmianie metody. | P0 (FIFO) / P1 (średnia) | Wektory testowe (częściowe sprzedaże, splity, prowizje, waluty) dają wyniki identyczne z `obliczenia-finansowe.md`. | 3.1.3 |
| FR-03.06 | Stopy zwrotu: TWR (dzienna metoda łańcuchowa) i MWR/XIRR dla rachunku, portfela zbiorczego i pozycji, dla dowolnego okresu, w PLN i w walucie rachunku. | P1 | XIRR zgodny z funkcją XIRR arkusza (tolerancja 1e-6); TWR zgodny z definicją z dokumentu wzorów. | 3.1.3 |
| FR-03.07 | Benchmark: TWR portfela vs indeks/ETF oraz symulacja „te same przepływy w benchmarku”. | P1 | Wynik symulacji dla wektora testowego zgodny z obliczeniem ręcznym. | 3.1.3 |
| FR-03.08 | Atrybucja wyniku okresu: wkład pozycji, sektorów i walut. | P2 | Suma wkładów = wynik okresu (tolerancja 0,01 PLN). | 3.1.3 |
| FR-03.09 | Obsunięcia: maksymalne obsunięcie, czas trwania i odrabiania, wykres „underwater”. | P1 | Max drawdown zgodny z empyrical-reloaded dla wektora testowego. | 3.1.3 |
| FR-03.10 | Statystyki ryzyka: zmienność, Sharpe, Sortino, beta i korelacja z benchmarkiem, VaR/CVaR historyczne — z opisem założeń (stopa wolna od ryzyka, częstotliwość, okno). | P2 | Wartości zgodne z empyrical-reloaded; każda metryka z podpowiedzią założeń. | 3.1.3 |
| FR-03.11 | Dziennik transakcji: teza, horyzont, planowany poziom wyjścia i ryzyka, pewność, tagi; postmortem po zamknięciu pozycji (ocena procesu niezależnie od wyniku). | P1 | Postmortem można dodać do każdej zamkniętej pozycji; pola wymagane konfigurowalne. | 3.1.3 |
| FR-03.12 | Statystyki skuteczności decyzji: trafność, średni zysk/strata, expectancy, profit factor, czas trzymania; filtrowanie po tagach i strategiach; rozróżnienie jakości decyzji od wyniku. | P2 | Liczone tylko z zamkniętych pozycji; próbka < 20 transakcji oznaczona „mało danych”. | 3.1.3 |
| FR-03.13 | Eksport transakcji, pozycji i wyników (CSV, JSON). | P1 | Eksport → import na czyste konto odtwarza te same pozycje. | 3.1.3, 4.3 |

### FR-04 Analiza inwestycji przyszłych (§3.1.4)

| ID | Wymaganie | P | Kryterium akceptacji | § |
|---|---|---|---|---|
| FR-04.01 | **Reguła nadrzędna:** wszystkie wyniki tego obszaru to scenariusze i rozkłady z założeniami, źródłem danych, horyzontem, przedziałami i disclaimerem; brak prognoz punktowych i języka rekomendacji. | P0 (reguła) | Checklista z [`../11-zgodnosc-prawna.md`](../11-zgodnosc-prawna.md) § 4.4 przechodzi dla każdego ekranu obszaru; testy e2e sprawdzają blok założeń i disclaimer. | 3.1.4, 6.4, 6.5 |
| FR-04.02 | Symulacja Monte Carlo wartości portfela (horyzont do 40 lat): bootstrap blokowy historycznych zwrotów lub model parametryczny, wpłaty/wypłaty, inflacja; wynik: wachlarz percentyli (5/25/50/75/95), prawdopodobieństwo osiągnięcia celu, rozkład maks. obsunięcia. | P1 | Wynik odtwarzalny z zapisanym ziarnem (seed); 10 000 ścieżek × 30 lat (krok miesięczny) < 20 s na serwerze docelowym; UI: „to nie prognoza”. | 3.1.4 |
| FR-04.03 | Optymalizacja portfela: minimalna wariancja, maks. Sharpe, efektywna granica, risk parity / HRP, Black-Litterman z poglądami użytkownika; ograniczenia wag; prezentacja niepewności (resampling wag). | P2 | Wyniki zgodne z PyPortfolioOpt dla danych testowych; wagi z przedziałem niepewności; ostrzeżenie o błędzie estymacji. | 3.1.4 |
| FR-04.04 | Testy warunków skrajnych: scenariusze historyczne (np. 2008, 2020, 2022) i hipotetyczne (spadek indeksu o X %, zmiana USD/PLN o Y %). | P2 | Scenariusz opisany (okres, źródło, założenia); instrumenty bez historii w okresie scenariusza oznaczone, zamiennik (proxy) wskazany jawnie. | 3.1.4 |
| FR-04.05 | Analiza „co jeśli”: hipotetyczna pozycja/kwota → zmiana zmienności, korelacji, koncentracji i historycznego obsunięcia portfela. | P2 | Porównanie „przed/po” na tym samym oknie danych; okno i częstotliwość widoczne. | 3.1.4 |
| FR-04.06 | Kalkulator rebalancingu: alokacja docelowa → lista transakcji z kosztami (prowizje, przewalutowanie), skutkiem podatkowym (FIFO) i minimalną kwotą zlecenia; tryb „tylko dokupowanie”. | P1 | Po symulowanym wykonaniu odchylenie od celu ≤ zadany próg; koszt i szacowany podatek widoczne. | 3.1.4 |
| FR-04.07 | Screening kandydatów wg kryteriów użytkownika (na bazie FR-01.11) z listą spełnionych warunków; bez rankingu „najlepszych”. | P2 | Wynik zawiera wyłącznie instrumenty spełniające kryteria, z uzasadnieniem per kryterium. | 3.1.4 |
| FR-04.08 | Backtest strategii regułowych z realistycznymi kosztami (prowizje, spread, przewalutowanie, podatek), podziałem in-sample / out-of-sample i walk-forward; raport z ostrzeżeniami metodologicznymi (look-ahead, survivorship, przeuczenie — liczba testowanych wariantów). | P2 | Raport zawiera okres, uniwersum i jego ograniczenia, koszty, liczbę kombinacji parametrów, wyniki OOS obok IS; celowy przypadek z sygnałem „z przyszłości” jest wykrywany testem. | 3.1.4, 6.4 |
| FR-04.09 | Kalkulator celu: wymagana miesięczna wpłata dla kwoty X z prawdopodobieństwem p (na bazie FR-04.02). | P2 | Wynik jako przedział (p = 50 / 75 / 90 %) z założeniami. | 3.1.4 |

### FR-05 System alertów (§3.1.5)

| ID | Wymaganie | P | Kryterium akceptacji | § |
|---|---|---|---|---|
| FR-05.01 | Alert cenowy: kurs powyżej/poniżej progu, zmiana dzienna ±X %. | P1 | Wyzwolenie w ≤ 1 cykl odświeżania (≤ 5 min w trakcie sesji), jednokrotnie na przekroczenie (histereza + cooldown). | 3.1.5 |
| FR-05.02 | Alert na wskaźniku: RSI przekracza próg, cena przecina SMA/EMA, przecięcie MACD, wyjście poza wstęgę Bollingera — na zamknięciach dziennych lub danych opóźnionych. | P2 | Warunek liczony funkcjami `packages/core` (tymi samymi co wykres); test porównuje z wykresem. | 3.1.5 |
| FR-05.03 | Alert portfelowy: zmiana wartości o X %, obsunięcie > Y %, odchylenie alokacji od celu > Z p.p. | P2 | Liczony po każdej wycenie; zgodny z widokiem portfela. | 3.1.5 |
| FR-05.04 | Alert na wynikach spółek: przypomnienie N dni przed publikacją wyników spółki z pozycji/watchlisty. | P3 | USA z kalendarza dostawcy, GPW z wpisów admina. | 3.1.5 |
| FR-05.05 | Alert na newsach: nowe artykuły lub skok liczby wzmianek o instrumencie. | P3 | Próg i okno konfigurowalne; domyślnie maks. 1 alert/instrument/dzień. | 3.1.5 |
| FR-05.06 | Kanały i preferencje: Web Push i e-mail wybierane per alert; ciche godziny; deduplikacja i cooldown; historia wyzwoleń i doręczeń. | P1 | Brak subskrypcji push → automatycznie e-mail; historia pokazuje status doręczenia per kanał. | 3.1.5, 4.4 |
| FR-05.07 | Treść alertu: wartość, próg, czas i źródło danych, link do instrumentu; bez języka rekomendacji. | P1 | Szablony przechodzą checklistę języka z [`../11-zgodnosc-prawna.md`](../11-zgodnosc-prawna.md) § 4. | 3.1.5, 6.5 |

### FR-06 Samouczki i warstwa edukacyjna (§3.1.6)

| ID | Wymaganie | P | Kryterium akceptacji | § |
|---|---|---|---|---|
| FR-06.01 | Interaktywny onboarding przy pierwszym logowaniu (rachunek, import, jak czytać portfel, gdzie są wyjaśnienia) z możliwością pominięcia i powtórzenia. | P1 | Ładowany leniwie (brak wpływu na initial JS); stan ukończenia zapisany per użytkownik. | 3.1.6 |
| FR-06.02 | Kontekstowe wyjaśnienia przy wskaźnikach i metrykach: definicja, jak czytać, pułapki, link do glosariusza i do wzoru. | P1 | 100 % wskaźników i metryk w UI ma wyjaśnienie (test sprawdza klucze treści). | 3.1.6 |
| FR-06.03 | Glosariusz (PL, wyszukiwalny) z powiązaniami do miejsc w aplikacji. | P1 | ≥ 60 haseł na koniec M5a; wyszukiwanie po fragmencie i synonimie. | 3.1.6 |
| FR-06.04 | Tryb demo: fikcyjny portfel na danych historycznych, odizolowany od danych realnych, dostępny dla zalogowanych (np. przed pierwszym importem). | P2 | Operacje demo nie modyfikują danych realnych (rachunek typu `demo`, test izolacji); stały baner „DEMO”. | 3.1.6 |
| FR-06.05 | Ścieżki nauki (podstawy, dywersyfikacja, koszty, podatki w PL, ryzyko, pułapki behawioralne) z ćwiczeniami na danych demo i zapisem postępu. | P3 | Lekcja ma cel, treść, ćwiczenie i podsumowanie; postęp zapisywany. | 3.1.6 |
| FR-06.06 | „Jak czytać ten wynik” przy analizach FR-04 (percentyle, przedziały, dlaczego to nie prognoza). | P2 | Obecne na każdym ekranie wyników FR-04.02–FR-04.09. | 3.1.6, 3.1.4 |

### FR-07 Użytkownicy, uwierzytelnianie, role (§3.2)

| ID | Wymaganie | P | Kryterium akceptacji | § |
|---|---|---|---|---|
| FR-07.01 | Rejestracja wyłącznie z zaproszenia: jednorazowy link ważny 72 h, wystawiany przez admina, przypisujący rolę. | P0 | Rejestracja bez ważnego zaproszenia → 403; użyty/wygasły link nie działa. | 3.2 |
| FR-07.02 | Logowanie e-mailem i hasłem (Argon2id), weryfikacja adresu e-mail, sprawdzanie hasła w bazie wycieków (k-anonimowość). | P0 | Hasło < 12 znaków lub z wycieku odrzucone; hash w formacie Argon2id. | 3.2, 4.3 |
| FR-07.03 | Logowanie OAuth (Google, GitHub) jako alternatywny pierwszy składnik, z wymuszonym drugim składnikiem (Z-04). | P2 | Logowanie przez Google u użytkownika z TOTP kończy się ekranem kodu; bez kodu brak dostępu do danych. | 3.2 |
| FR-07.04 | Obowiązkowe 2FA TOTP dla każdego konta: konfiguracja przed pierwszym dostępem do danych, 10 kodów zapasowych, reset tylko przez admina (audyt). | P0 | Każdy endpoint danych zwraca 403 `MFA_REQUIRED` dla sesji bez zweryfikowanego TOTP; test e2e całej ścieżki. | 3.2, 4.3 |
| FR-07.05 | Zarządzanie sesjami przez użytkownika: lista urządzeń, wylogowanie zdalne, „wyloguj wszędzie”. | P1 | Unieważnienie działa w ≤ 60 s na wszystkich urządzeniach. | 3.2, 4.3 |
| FR-07.06 | Role user / pro / admin (RBAC) z uprawnieniami per moduł; „pro” = dostęp do ciężkich analiz (FR-04.02–FR-04.09) i wyższe limity (Z-20). | P0 (model) / P1 (bramkowanie „pro”) | Macierz uprawnień z `01-architektura/moduly.md` pokryta testami autoryzacji (403 przy braku uprawnienia). | 3.2 |
| FR-07.07 | Tokeny API użytkownika (PAT) do automatyzacji (Skróty, HTTP Shortcuts): zakresy (np. `portfolio:read`, `transactions:write`), wygasanie, odwołanie, pokazywane tylko raz; utworzenie wymaga ponownej weryfikacji TOTP. | P1 | Token z zakresem `portfolio:read` nie doda transakcji (403); odwołany token przestaje działać natychmiast. | 4.4, 4.3 |
| FR-07.08 | Profil i preferencje: waluta bazowa (domyślnie PLN), metoda cost basis, strefa czasowa, język, motyw (jasny/ciemny/systemowy), paleta zysk/strata przyjazna daltonistom. | P1 | Zmiana palety działa globalnie bez przeładowania; preferencje synchronizowane między urządzeniami. | 3.2 |
| FR-07.09 | RODO: eksport wszystkich danych użytkownika (JSON + CSV), usunięcie konta i danych (14 dni na anulowanie), klauzula informacyjna. | P1 | Eksport obejmuje każdą tabelę z `user_id` (test porównuje z listą tabel); po usunięciu brak danych osobowych poza pseudonimizowanym audytem. | 4.3 |
| FR-07.10 | Reset hasła przez e-mail (jednorazowy link ważny 30 min), a następnie TOTP. | P0 | Link jednorazowy; reset unieważnia wszystkie sesje. | 3.2 |
| FR-07.11 | Passkeys (WebAuthn) jako dodatkowa metoda logowania. | P3 | Rejestracja passkey (Face ID) działa w zainstalowanej PWA na iPhonie. | 3.2 |
| FR-07.12 | Dokumenty prawne i zgody: przy rejestracji akceptacja regulaminu i potwierdzenie zapoznania się z informacją o przetwarzaniu danych (wersjonowane, z historią zdarzeń); ponowna akceptacja po istotnej zmianie regulaminu (bramka); zgody opcjonalne (diagnostyka wydajności) domyślnie niezaznaczone i wycofywane równie łatwo jak udzielane. | P0 | Rejestracja bez akceptacji → `422`; nowa wersja regulaminu → `403 TERMS_ACCEPTANCE_REQUIRED` do czasu akceptacji; bez zgody przeglądarka nie wysyła pomiarów RUM (test e2e). | 3.2, 4.3 |

### FR-08 Panel administratora (§3.2)

| ID | Wymaganie | P | Kryterium akceptacji | § |
|---|---|---|---|---|
| FR-08.01 | Zarządzanie użytkownikami: lista, zaproszenia, zmiana roli, blokada, reset 2FA, usunięcie — **bez wglądu w dane finansowe użytkowników**. | P0 (zaproszenia, role) / P1 (reszta) | Admin nie odczyta portfela innego użytkownika (test RLS); każda akcja w audycie. | 3.2 |
| FR-08.02 | Sesje: podgląd aktywnych sesji (urządzenie, IP, czas), unieważnianie. | P1 | Unieważnienie przez admina → wylogowanie w ≤ 60 s. | 3.2 |
| FR-08.03 | Limity API: zużycie kwot dostawców (minuta/doba), budżety dostawców, limity per rola (np. liczba symulacji/dzień). | P1 | Zmiana budżetu bez restartu; przekroczenie limitu roli → 429 z czasem odnowienia. | 3.2 |
| FR-08.04 | Feature flags: włączanie modułów i funkcji globalnie, per rola, per użytkownik. | P1 | Wyłączenie modułu ukrywa nawigację i zwraca 404 dla jego endpointów w ≤ 60 s. | 3.2, 4.2 |
| FR-08.05 | Audit log: przegląd z filtrami (aktor, akcja, zasób, czas), eksport; wpisy niemodyfikowalne (append-only). | P0 (zapis) / P1 (UI) | Rola aplikacyjna nie ma UPDATE/DELETE na tabeli audytu (test uprawnień DB). | 3.2 |
| FR-08.06 | Status integracji: stan każdego dostawcy (circuit breaker, ostatni sukces, błędy, kwota), ręczne wymuszenie odświeżenia. | P1 | Status odświeżany ≤ 60 s; wymuszenie respektuje kwoty. | 3.2 |
| FR-08.07 | Kolejki zadań: zadania oczekujące / aktywne / nieudane per kolejka; ponowienie i usunięcie zadania nieudanego. | P1 | Ponowienie zapisane w audycie. | 3.2 |
| FR-08.08 | Health-checki i zasoby: stan usług (web, api, jobs, analytics, postgres, valkey), wersje, CPU/RAM/dysk lub odnośnik do monitoringu. | P1 | Każda usługa ma health-check; panel pokazuje stan z opóźnieniem ≤ 60 s. | 3.2 |
| FR-08.09 | Dane rynkowe: ręczny import notowań (CSV ze Stooq, XLS z archiwum GPW), korekty instrumentów (split, ISIN, sektor), wpisy kalendarza GPW. | P2 | Import ręczny przechodzi tę samą kontrolę jakości co automatyczny. | 3.2, 2.1 |
| FR-08.10 | Każda akcja administracyjna w audycie: kto, co, na czym, kiedy, skąd (IP, UA), stan przed/po. | P0 | Test: każda trasa `/api/v1/admin/*` zapisuje wpis audytu. | 3.2 |

### FR-09 Integracje mobilne i systemowe (§4.4)

| ID | Wymaganie | P | Kryterium akceptacji | § |
|---|---|---|---|---|
| FR-09.01 | Instalowalna PWA (manifest, ikony, ekran startowy, tryb standalone) na iOS (Safari → „Do ekranu początkowego”), Androidzie (Chrome) i desktopie (Chrome/Edge; Safari na macOS „Dodaj do Docka”). | P1 | Kryteria instalowalności Lighthouse spełnione; na iPhonie aplikacja otwiera się bez paska Safari. | 4.4 |
| FR-09.02 | Offline shell: aplikacja uruchamia się bez sieci i pokazuje ostatnio zsynchronizowany stan portfela (tylko odczyt) z datą. | P2 | W trybie samolotowym dashboard pokazuje dane z datą synchronizacji; brak białego ekranu. | 4.4 |
| FR-09.03 | Web Push dla alertów (iOS ≥ 16.4 po instalacji PWA, Android, desktop); prośba o zgodę wyłącznie po geście użytkownika. | P1 | Na iPhonie alert dociera jako powiadomienie; kliknięcie otwiera właściwy ekran. | 4.4, 3.1.5 |
| FR-09.04 | API „szybkich akcji” dla automatyzacji (Skróty iOS, HTTP Shortcuts): podsumowanie portfela, wynik dnia, dodanie transakcji (oraz „moje alerty” udostępniane przez moduł alertów); odpowiedź tekstowa lub JSON; uwierzytelnianie PAT. | P1 | `GET /api/v1/quick/today?format=text` zwraca jedną linię (np. „Dziś: +1 234,56 zł (+0,84 %) · dane 15:42, opóźnione”) w < 300 ms. | 4.4 |
| FR-09.05 | Gotowe Skróty iOS (link iCloud + instrukcja): „Pokaż mój portfel”, „Ile dziś zarobiłem”, „Dodaj transakcję”, „Moje alerty”; konfiguracja Stuknięcia w tył, Siri, automatyzacji i widżetu Skrótów. | P2 | Instrukcja w [`../12-dla-uzytkownika/instrukcja.md`](../12-dla-uzytkownika/instrukcja.md) § 9 przetestowana na aktualnym iOS. | 4.4 |
| FR-09.06 | Android: skróty aplikacji w manifeście (przytrzymanie ikony), otwieranie linków w zainstalowanej PWA, konfiguracja HTTP Shortcuts (widżet, kafelek Szybkich ustawień); Tasker jako opcja płatna. | P2 | Instrukcja przetestowana na Androidzie ≥ 12. | 4.4 |
| FR-09.07 | Linki głębokie (https) do instrumentu, rachunku, alertu i wyniku analizy — w powiadomieniach, e-mailach i Skrótach. | P1 | Link z powiadomienia otwiera właściwy ekran (po zalogowaniu powrót do celu). | 4.4 |
| FR-09.08 | Widżety z danymi (ekran główny/blokady) opcjonalnie przez aplikacje zewnętrzne (Scriptable na iOS, HTTP Shortcuts na Androidzie) korzystające z FR-09.04. | P3 | Przykładowy skrypt widżetu w dokumentacji; brak wymagań serwerowych poza FR-09.04. | 4.4 |

---

## 2. Wymagania niefunkcjonalne

### NFR-01 Wydajność (§4.1)

| ID | Wymaganie | P | Weryfikacja | § |
|---|---|---|---|---|
| NFR-01.01 | LCP < 2,0 s, INP < 200 ms, CLS < 0,1 (75. percentyl) na profilu mobilnym (4G, telefon średniej klasy) dla: logowania, dashboardu, portfela, karty instrumentu. | P0 | Lighthouse CI (profil mobilny, 3 przebiegi, mediana) + pomiar RUM (`web-vitals` do własnego endpointu). | 4.1 |
| NFR-01.02 | Initial JS pierwszego wczytania trasy < 200 KB gzip; budżety per trasa w `04-frontend/wydajnosc.md`. | P0 | `size-limit` + raport buildu w CI; przekroczenie = czerwony build. | 4.1 |
| NFR-01.03 | Code splitting per moduł: biblioteki wykresów, onboarding, panel admina i widoki analityczne ładowane wyłącznie na trasach, które ich używają. | P0 | Test w CI: chunki trasy `/` nie zawierają `lightweight-charts`, `uplot`, `driver.js`. | 4.1 |
| NFR-01.04 | Wykresy na canvas; serwer decymuje serie do ≤ 3 000 punktów; listy i tabele > 100 wierszy wirtualizowane. | P0 | Test API (liczba punktów), test komponentu (liczba węzłów DOM). | 4.1 |
| NFR-01.05 | Ścieżka żądania użytkownika nie zawiera wywołań zewnętrznych API; odczyty p95 < 300 ms (cache/baza). | P0 | Test obciążeniowy na serwerze docelowym; metryki czasu odpowiedzi API. | 4.1 |
| NFR-01.06 | Aktualizacje przez SSE docierają < 2 s od zapisu nowych danych. | P1 | Test integracyjny z pomiarem opóźnienia. | 4.1 |
| NFR-01.07 | Ciężkie obliczenia wykonywane asynchronicznie z postępem, limitem czasu i pamięci; interfejs pozostaje responsywny. | P1 | Uruchomienie symulacji MC nie zwiększa p95 odczytów API o > 20 %. | 4.1 |
| NFR-01.08 | Całość działa w VM ≤ 6 GB RAM / 3 vCPU obok Immich przy ≤ 5 równoczesnych użytkownikach. | P0 | Pomiar zużycia zasobów w teście obciążeniowym. | 4.1, 4.5 |
| NFR-01.09 | Konflikty wydajności z funkcjami zgłaszane jawnie (ADR, [`../10-ograniczenia.md`](../10-ograniczenia.md)), nigdy ukrywane. | P0 | Przegląd spójności w Kroku 7. | 4.1 |

### NFR-02 Modularność i rozszerzalność (§4.2)

| ID | Wymaganie | P | Weryfikacja | § |
|---|---|---|---|---|
| NFR-02.01 | Monorepo Turborepo + pnpm z podziałem `apps/`, `modules/`, `packages/`. | P0 | Struktura zgodna z `01-architektura/moduly.md`. | 4.2 |
| NFR-02.02 | Moduły funkcjonalne mają własne API (prefiks), model domenowy, tabele, zdarzenia i uprawnienia; moduł opcjonalny można wyłączyć flagą i usunąć bez zmian w innych modułach. | P0 | Build i testy z usuniętym modułem opcjonalnym przechodzą (zadanie CI). | 4.2 |
| NFR-02.03 | Zależności między modułami wyłącznie zgodnie z warstwami (platforma → fundament → moduły funkcjonalne); moduły funkcjonalne nie zależą od siebie nawzajem. | P0 | Skrypt CI walidujący graf zależności workspace. | 4.2 |
| NFR-02.04 | Dostawcy danych jako wymienne adaptery (port/adapter) z testami kontraktowymi. | P0 | Nowy dostawca = plik adaptera + wpis w rejestrze + fixture; zero zmian w modułach domenowych. | 4.2, 2.1 |
| NFR-02.05 | Wersjonowanie API (`/api/v1`); zmiana niekompatybilna: ≥ 90 dni okresu przejściowego, nagłówki `Deprecation`/`Sunset`, changelog. | P1 | `02-api/konwencje-api.md`; test kontraktu OpenAPI w CI. | 4.2 |
| NFR-02.06 | Jedna implementacja obliczeń finansowych (`packages/core`) dla web, api i jobs; worker Python weryfikowany wspólnymi wektorami testowymi. | P0 | Katalog `packages/test-vectors` używany przez Vitest i pytest. | 4.2, 4.4 |
| NFR-02.07 | Checklisty dodania i usunięcia modułu w dokumentacji. | P0 | `01-architektura/moduly.md` § 7. | 4.2 |

### NFR-03 Bezpieczeństwo (§4.3; szczegóły w `docs/06-bezpieczenstwo/`)

| ID | Wymaganie | P | Weryfikacja | § |
|---|---|---|---|---|
| NFR-03.01 | Model zagrożeń STRIDE per moduł z macierzą ryzyk; mapowanie na OWASP Top 10 (2021) i ASVS L2. | P0 | Dokumenty w `06-bezpieczenstwo/`. | 4.3 |
| NFR-03.02 | Hasła: Argon2id (parametry wg OWASP), sprawdzanie wycieków, limity prób i czasowa blokada, ochrona przed credential stuffing. | P0 | Test: seria nieudanych prób → blokada; hash w formacie Argon2id. | 4.3 |
| NFR-03.03 | Sesje: ciasteczka `HttpOnly` + `Secure` + `SameSite`, rotacja przy zmianie uprawnień, wygasanie bezczynności i absolutne, unieważnianie. | P0 | Testy integracyjne sesji. | 4.3 |
| NFR-03.04 | RLS na każdej tabeli z danymi użytkownika; aplikacja łączy się rolą bez `BYPASSRLS`; kontekst użytkownika ustawiany w każdej transakcji. | P0 | Testy RLS w CI: użytkownik A nie odczyta danych B nawet przy zapytaniu bez filtra. | 4.3 |
| NFR-03.05 | Dane użytkownika nie trafiają do współdzielonych kluczy cache ani logów; klucze cache danych użytkownika zawierają `user_id`. | P0 | Przegląd + test izolacji cache. | 4.3 |
| NFR-03.06 | TLS 1.3, HSTS, CSP bez `unsafe-inline` (nonce), `frame-ancestors 'none'`/X-Frame-Options, Referrer-Policy, Permissions-Policy. | P0 | Skan nagłówków na środowisku docelowym. | 4.3 |
| NFR-03.07 | Walidacja wejścia (Zod) na każdej granicy; zapytania parametryzowane; sanityzacja danych z zewnętrznych API; ochrona CSRF; ochrona SSRF (allowlista hostów dostawców, brak pobierania URL-i podanych przez użytkownika). | P0 | Testy negatywne; reguły lint. | 4.3 |
| NFR-03.08 | Szyfrowanie wrażliwych danych at-rest na poziomie aplikacji (sekrety TOTP, tokeny OAuth, kody zapasowe), szyfrowane kopie zapasowe; serwer nie przechowuje haseł do rachunków maklerskich. | P0 | Przegląd schematu; test, że kolumny wrażliwe nie są czytelnym tekstem. | 4.3 |
| NFR-03.09 | Łańcuch dostaw: lockfile i pinowanie, Renovate/Dependabot, SCA (osv-scanner), SBOM (CycloneDX), podpisane obrazy (cosign), CodeQL, skanowanie sekretów. | P1 | Workflow CI (`07-wdrozenie/ci-cd.md`). | 4.3 |
| NFR-03.10 | Logowanie zdarzeń bezpieczeństwa, wykrywanie anomalii (seria nieudanych logowań, nowe urządzenie/kraj, masowy eksport), plan reagowania na incydent. | P1 | `06-bezpieczenstwo/plan-reagowania.md`; alerty monitoringu. | 4.3 |
| NFR-03.11 | Hardening: firewall (domyślnie deny), CrowdSec, SSH wyłącznie kluczami, kontenery non-root z read-only FS i ograniczonymi capabilities, automatyczne odnawianie certyfikatów. | P0 | Checklista w `07-wdrozenie/infrastruktura.md`. | 4.3 |
| NFR-03.12 | Publiczne repozytorium bez sekretów, adresów IP, wewnętrznych nazw hostów, portów, konfiguracji VPN i danych rzeczywistych (fixtures anonimizowane). | P0 | Skanowanie sekretów z push protection; przegląd PR. | 4.3 |
| NFR-03.13 | Worker analityczny bez dostępu do internetu i do danych użytkowników w bazie (dane wejściowe w treści zadania, dane rynkowe tylko do odczytu). | P1 | Konfiguracja sieci kontenera + uprawnienia roli DB; test. | 4.3 |

### NFR-04 Wieloplatformowość (§4.4)

| ID | Wymaganie | P | Weryfikacja | § |
|---|---|---|---|---|
| NFR-04.01 | Wspierane przeglądarki: Safari iOS/iPadOS ≥ 17, Safari macOS ≥ 17, Chrome i Edge (2 ostatnie wersje, desktop i Android), Firefox (2 ostatnie, desktop). | P0 | E2E Playwright na silnikach WebKit, Chromium, Firefox. | 4.4 |
| NFR-04.02 | Responsywność 360–2560 px, mobile-first, gesty na wykresach, obsługa safe-area. | P0 | Testy wizualne na 3 szerokościach. | 4.4 |
| NFR-04.03 | Działanie bez sklepów z aplikacjami i bez kont deweloperskich (0 zł). | P0 | Brak zależności od App Store / Google Play. | 4.4, 4.5 |
| NFR-04.04 | Współdzielona logika biznesowa w `packages/core` (patrz NFR-02.06). | P0 | — | 4.4 |

### NFR-05 Budżet 0 zł (§4.5)

| ID | Wymaganie | P | Weryfikacja | § |
|---|---|---|---|---|
| NFR-05.01 | Każdy komponent self-hostowany lub z trwałym darmowym tierem; wyjątki w [`../10-ograniczenia.md`](../10-ograniczenia.md) (koszt najtańszej opcji, darmowy substytut, co tracimy). | P0 | Przegląd stosu w Kroku 7. | 4.5 |
| NFR-05.02 | System działa w pełni na darmowych limitach API (kwoty planowane, twardy cache). | P0 | Plan dobowy vs limity (`03-dane/strategia-cache.md` § 5). | 4.5, 2.1 |
| NFR-05.03 | Mieści się na posiadanym sprzęcie (Dell 7020 obok Immich) i istniejącym VPS jako edge. | P0 | NFR-01.08. | 4.5 |

### NFR-06 Dostępność (WCAG 2.1 AA)

| ID | Wymaganie | P | Weryfikacja | § |
|---|---|---|---|---|
| NFR-06.01 | WCAG 2.1 AA: kontrast, obsługa klawiatury, widoczny focus, etykiety, role ARIA, alternatywa tabelaryczna dla każdego wykresu, respektowanie `prefers-reduced-motion`. | P0 | axe (Playwright) bez naruszeń krytycznych; ręczny test VoiceOver przed wydaniem. | 5 (`04-frontend/dostepnosc.md`) |
| NFR-06.02 | Zysk/strata komunikowane nie tylko kolorem (znak, ikona ▲▼, tekst); paleta przyjazna daltonistom do wyboru; tryb ciemny. | P0 | Test kontrastu tokenów; przegląd. | 5 (`system-projektowy.md`) |
| NFR-06.03 | Prosty język w treściach edukacyjnych; liczby i daty formatowane wg locale pl-PL. | P1 | Przegląd treści. | 3.1.6 |

### NFR-07 Zgodność regulacyjna i przejrzystość (§6.4–6.5)

| ID | Wymaganie | P | Weryfikacja | § |
|---|---|---|---|---|
| NFR-07.01 | Obowiązkowe disclaimery na ekranach analiz, screenera, alertów i eksportów wg [`../11-zgodnosc-prawna.md`](../11-zgodnosc-prawna.md) § 4.3. | P0 | Testy e2e obecności disclaimera. | 6.5 |
| NFR-07.02 | Każda funkcja predykcyjna/backtestowa ma udokumentowane założenia, źródło danych, ograniczenia oraz ryzyko look-ahead, survivorship i przeuczenia; przegląd metodologiczny przed wdrożeniem (checklisty `strategy-critique` i `backtest-review` przeniesione do dokumentacji dla Codex). | P0 | Checklista w szablonie PR. | 6.4 |
| NFR-07.03 | Atrybucje źródeł i licencji danych w UI (m.in. FRED, NBP, GDELT, TradingView). | P1 | Strona „Źródła danych i licencje” + stopki komponentów. | 2.1, 6.5 |
| NFR-07.04 | Brak redystrybucji danych rynkowych poza zarejestrowanych użytkowników (brak publicznych stron i API z danymi). | P0 | Wszystkie trasy z danymi wymagają sesji lub PAT. | 2.1 |

### NFR-08 Poprawność obliczeń i jakość danych

| ID | Wymaganie | P | Weryfikacja | § |
|---|---|---|---|---|
| NFR-08.01 | Kwoty pieniężne w typach dziesiętnych (`decimal.js` / `Decimal` / `NUMERIC`), waluta zawsze jawna, zasady zaokrągleń zdefiniowane (ADR-014). | P0 | Typy markowane `Money`; przegląd; test braku `float` w ścieżkach pieniężnych. | 3.1.2–3.1.3 |
| NFR-08.02 | Każdy wzór z `obliczenia-finansowe.md` ma testy na wektorach referencyjnych z tolerancjami. | P0 | Pokrycie `packages/core` ≥ 90 % linii i 100 % wzorów. | 3.1.3 |
| NFR-08.03 | Uzgodnienie z brokerem po imporcie (ilości, gotówka, P/L zrealizowany) z raportem różnic. | P0 | Testy na anonimizowanych plikach XTB i mBank. | 3.1.3 |
| NFR-08.04 | Kontrola jakości danych rynkowych (luki, duplikaty, skoki bez splitu) z oznaczeniem w UI. | P1 | Testy modułu jakości danych. | 2.1 |
| NFR-08.05 | Analizy odtwarzalne: zapis ziarna losowego, wersji algorytmu, zakresu i wersji danych przy każdym wyniku. | P1 | Ponowne uruchomienie z tymi samymi parametrami daje identyczny wynik. | 3.1.4 |

### NFR-09 Niezawodność i utrzymanie ruchu

| ID | Wymaganie | P | Weryfikacja | § |
|---|---|---|---|---|
| NFR-09.01 | Docelowa dostępność 99 % miesięcznie; pojedyncze punkty awarii udokumentowane (Z-27; szczegóły w [`../10-ograniczenia.md`](../10-ograniczenia.md) § 2). | P1 | Monitoring dostępności. | 4.3 |
| NFR-09.02 | Łagodna degradacja przy awarii dostawców danych (dane z flagą „nieaktualne” zamiast błędu). | P0 | Test z wyłączonym adapterem. | 2.1 |
| NFR-09.03 | Kopie zapasowe 3-2-1, szyfrowane; RPO ≤ 24 h (cel ≤ 1 h dla bazy), RTO ≤ 4 h; test odtworzenia co kwartał z protokołem. | P0 | `07-wdrozenie/backup-dr.md` + protokoły testów. | 4.3 |
| NFR-09.04 | Monitoring: health-checki, metryki, logi strukturalne JSON z identyfikatorem korelacji, alerty do admina. | P1 | `07-wdrozenie/monitoring.md`. | 4.3 |
| NFR-09.05 | Wdrożenia z przerwą ≤ 1 min, migracje kompatybilne wstecz (expand/contract), możliwość wycofania. | P1 | `07-wdrozenie/ci-cd.md`. | 4.2 |

### NFR-10 Utrzymywalność i dokumentacja (§6.6–6.7)

| ID | Wymaganie | P | Weryfikacja | § |
|---|---|---|---|---|
| NFR-10.01 | Dokumentacja jako produkt: każdy dokument zaczyna się od celu, decyzje w ADR, dokumentacja aktualizowana przed kodem. | P0 | Przegląd PR. | 6.7 |
| NFR-10.02 | Testy: jednostkowe (core), integracyjne API z prawdziwym Postgresem (RLS), kontraktowe (parsery, adaptery, OpenAPI), e2e Playwright dla ścieżek krytycznych. | P0 | Progi w CI. | 6.7 |
| NFR-10.03 | Conventional Commits, zielone CI przed scaleniem, Definition of Done w `CONTRIBUTING.md`. | P0 | Ochrona gałęzi `main`. | 5 |
| NFR-10.04 | UI po polsku, architektura gotowa na i18n (klucze komunikatów, formatowanie `Intl`). | P1 | Brak literałów tekstowych w komponentach (lint/test). | 5 |
| NFR-10.05 | Minimalizm zależności: każda biblioteka uzasadniona w `stack-technologiczny.md` lub ADR; standard platformy ma pierwszeństwo. | P0 | Przegląd PR; polityka zależności. | 6.6 |

### NFR-11 Prywatność (RODO)

| ID | Wymaganie | P | Weryfikacja | § |
|---|---|---|---|---|
| NFR-11.01 | Minimalizacja danych; brak zewnętrznych trackerów i analityki stron trzecich. | P0 | CSP blokuje domeny trzecie; przegląd. | 4.3 |
| NFR-11.02 | Polityka retencji (logi, audyt, pliki importu, dane usuniętych kont) i realizacja praw osób (eksport, usunięcie, sprostowanie). | P1 | `06-bezpieczenstwo/prywatnosc-rodo.md`. | 4.3 |
| NFR-11.03 | Dane przechowywane w Polsce (serwer domowy); przekazywanie podmiotom trzecim tylko w niezbędnym zakresie (e-mail — dostawca z UE). | P1 | Rejestr podmiotów przetwarzających w dokumencie RODO. | 4.3 |

---

## 3. Zastrzeżenia do specyfikacji

Zgodnie z §6.3: poniżej miejsca, w których specyfikacja jest sprzeczna, nierealna przy 0 zł lub szkodliwa dla wydajności — z propozycją alternatywy. Koszty i substytuty szczegółowo w [`../10-ograniczenia.md`](../10-ograniczenia.md).

| ID | Dotyczy | Zastrzeżenie | Propozycja / decyzja | Wpływ |
|---|---|---|---|---|
| Z-01 | §3.1.1 „w czasie rzeczywistym” | Darmowe źródła nie dają danych czasu rzeczywistego dla GPW; realtime GPW wymaga licencji dystrybutora danych. | Dane opóźnione (~15 min, best effort) + EOD; każda liczba z wiekiem i źródłem (FR-01.15); SSE zamiast WebSocket ([ADR-007](../09-decyzje/ADR-007-sse-zamiast-websocket.md)). | W UI: „notowania opóźnione”. |
| Z-02 | §2.1 Stooq | Stooq blokuje automatyczne pobieranie CSV (wyzwanie JS). | EOD GPW z oficjalnego archiwum GPW (XLS, cały rynek w jednym pliku); Stooq tylko jako import ręczny ([ADR-005](../09-decyzje/ADR-005-strategia-danych-rynkowych.md)). | Parser XLS (SheetJS CE). |
| Z-03 | §2.1 intraday GPW | Jedyne darmowe źródło intraday dla GPW to nieoficjalne API Yahoo („personal use only”), bez gwarancji działania. | Warstwa „best effort” z degradacją do trybu tylko-EOD; płatna alternatywa w [`../10-ograniczenia.md`](../10-ograniczenia.md) (L-11, L-12). | Ryzyko R-02 w [`../08-plan/ryzyka.md`](../08-plan/ryzyka.md). |
| Z-04 | §3.2 obowiązkowe 2FA + OAuth | Better Auth domyślnie nie wymusza 2FA dla logowań OAuth/passkey. | MVP: e-mail + hasło + TOTP; OAuth (P2) po spiku „wymuszenie 2FA po OAuth” (własny hook) + bramka MFA w API dla każdej sesji ([ADR-004](../09-decyzje/ADR-004-postgres-better-auth-rls.md)). | FR-07.03 = P2. |
| Z-05 | §3.2 panel admina „nie od zera” vs §4.1 budżet JS | Frameworki panelu (react-admin, Refine z UI) są ciężkie; osobna aplikacja dubluje uwierzytelnianie. | Minimalny panel w aplikacji (leniwa trasa `/admin`) na gotowych komponentach i API Better Auth admin; Refine headless w rezerwie ([ADR-006](../09-decyzje/ADR-006-panel-administratora.md)). | — |
| Z-06 | §4.4 iOS: App Intents, URL scheme, x-callback-url, widżety ekranu blokady | Wymagają natywnej aplikacji (konto Apple Developer, 99 USD/rok). PWA nie rejestruje własnego schematu URL, a linki otwierane przez Skróty trafiają do Safari, nie do PWA. | Skróty z akcją „Pobierz zawartość URL” + API szybkich akcji z PAT (FR-09.04); Stuknięcie w tył, Siri, automatyzacje i widżet Skrótów uruchamiają skróty; widżety z danymi opcjonalnie przez Scriptable (darmowa; ostatnia aktualizacja 2024-09 — ryzyko porzucenia) ([ADR-008](../09-decyzje/ADR-008-pwa-i-integracje-mobilne.md)). | FR-09.05, FR-09.08. |
| Z-07 | §4.4 Android: kafelek Szybkich ustawień, widżety, Tasker | Kafelek i widżet wymagają natywnej aplikacji; Tasker jest płatny (jednorazowo ok. 3,5–4,5 USD). | HTTP Shortcuts (MIT, darmowa: widżety, kafelki, Bearer) + skróty w manifeście PWA; Tasker opcjonalnie (koszt w [`../10-ograniczenia.md`](../10-ograniczenia.md), L-21). | FR-09.06. |
| Z-08 | §3.1.5 / §4.4 push | Web Push na iOS działa tylko w zainstalowanej PWA (≥ 16.4) i po zgodzie wyrażonej gestem; czas doręczenia bez gwarancji. W 2024 r. Apple zapowiedział usunięcie PWA w UE (DMA) i wycofał się po protestach — polityka może się zmienić. | Alerty krytyczne dodatkowo e-mailem; monitorowanie zmian iOS w rejestrze ryzyk. | FR-05.06. |
| Z-09 | §3.1.5 e-mail za 0 zł | Wysyłka z domowego IP lub VPS bez reputacji trafia do spamu albo jest blokowana (port 25). | Darmowy tier transakcyjny przez SMTP: Brevo (300 e-maili/dzień, firma z UE) — wymiennie Resend (3 000/mies., 100/dzień); SPF/DKIM/DMARC dla domeny ([ADR-010](../09-decyzje/ADR-010-kanaly-powiadomien.md)). | Logo Brevo w stopce e-maili (plan darmowy). |
| Z-10 | §3.1.1 heatmapy sektorowe | Brak darmowego źródła klasyfikacji sektorowej spółek GPW. | Klasyfikacja z portfeli subindeksów sektorowych GPW (półautomatycznie + korekta admina); USA — sektor z profilu dostawcy. | FR-01.10 = P2. |
| Z-11 | §3.1.1 / §3.1.4 screener | Pełne uniwersum możliwe tylko dla GPW (archiwum = cały rynek dziennie); limity darmowych API nie pozwalają codziennie pobierać ~8 000 spółek z USA; fundamenty GPW nie są dostępne za darmo. | Screener GPW na pełnym rynku (kryteria cenowe i techniczne); USA na zdefiniowanym uniwersum (lista utrzymywana przez admina + watchlisty). | FR-01.11. |
| Z-12 | §3.1.1 kalendarz wyników | Brak darmowego API kalendarza wyników spółek GPW. | USA z dostawcy (1 zapytanie/dzień); GPW — wpisy admina. | FR-01.12. |
| Z-13 | §3.1.1 newsy z sentymentem | „Ton” GDELT nie jest sentymentem inwestorskim; pokrycie polskich mediów częściowe; darmowy sentyment dostawców (Alpha Vantage: 25 zapytań/dobę) jest znikomy. | Funkcja P3, prezentowana jako „ton artykułów”, bez sygnałów i bez alertów „kup/sprzedaj”. | FR-01.13. |
| Z-14 | §3.1.1 Volume Profile | Wymaga danych tickowych lub intraday; w MVP mamy EOD. | Przybliżenie z barów dziennych, jawnie oznaczone. | FR-01.06 = P3. |
| Z-15 | §3.1.2 portfel z XTB | Obok akcji i ETF XTB oferuje CFD (dźwignia, punkty swapowe, korekty dywidendowe) — wymagają osobnego modelu. Koszt przewalutowania w XTB (❓ 0,5 % — do weryfikacji w tabeli opłat w Kroku 4) wpływa na koszt nabycia. | MVP: akcje i ETF (także na IKE/IKZE); wiersze CFD rozpoznawane i oznaczane jako nieobsługiwane (nie gubione); koszt przewalutowania wliczany do kosztu nabycia. | FR-03.01. |
| Z-16 | §3.1.2–3.1.3 wynik w PLN | Wynik ekonomiczny (faktyczne kursy przewalutowania brokera) różni się od wyniku podatkowego (kurs średni NBP z ostatniego dnia roboczego przed dniem transakcji). | Dwa widoki P/L: ekonomiczny (domyślny) i podatkowy (FIFO + kurs NBP D-1) — definicje w `obliczenia-finansowe.md` ([ADR-014](../09-decyzje/ADR-014-pieniadze-waluty-czas.md)). | FR-02.07. |
| Z-17 | §4.3 2FA vs automatyzacje | Skróty i HTTP Shortcuts nie przejdą TOTP przy każdym wywołaniu. | Tokeny PAT: minimalne zakresy, wygasanie (domyślnie 90 dni), odwołanie, utworzenie po ponownym TOTP, limit żądań; zapis wyłącznie z zakresem `transactions:write`. | FR-07.07. |
| Z-18 | §4.1 LCP < 2 s przy serwerze domowym | Każde żądanie przechodzi przez VPS i tunel WireGuard do domu; wydajność zależy od łącza domowego (upload) i RTT tunelu. | HTML strumieniowany, zasoby statyczne z długim cache w przeglądarce, pomiar RUM; jeśli budżet nie zostanie osiągnięty — cache zasobów statycznych na VPS pod osobną subdomeną (bez danych użytkowników) lub przeniesienie `web` na VPS, wpis w [`../10-ograniczenia.md`](../10-ograniczenia.md) L-04 ([ADR-011](../09-decyzje/ADR-011-topologia-wdrozenia.md)). | NFR-01.01. |
| Z-19 | §3.1.4 MC/backtest/optymalizacja vs §4.1 „nie moloch” | i5-4590 (4 wątki) współdzielony z Immich (w tym uczenie maszynowe); ciężkie zadania trwają sekundy–minuty. | Wykonanie asynchroniczne z postępem; maks. 1 ciężkie zadanie naraz; limity parametrów (np. ≤ 10 000 ścieżek MC, ≤ 500 kombinacji w backteście); dostęp dla roli „pro”. | NFR-01.07. |
| Z-20 | §3.2 rola „pro” | Aplikacja prywatna bez płatności — rola „pro” nie ma modelu biznesowego. | „pro” = dostęp do zasobożernych analiz i wyższe limity; nadawana przez admina. | FR-07.06. |
| Z-21 | §3.2 pełny audit log vs RODO | Niemodyfikowalny audyt a prawo do usunięcia danych. | Po usunięciu konta audyt zachowuje pseudonimizowany identyfikator aktora; retencja audytu do ustalenia w dokumencie RODO (propozycja: 2 lata). | NFR-11.02. |
| Z-22 | §4.3 „dane nie mogą wyciec przez błąd w kodzie” | RLS chroni zapytania SQL, ale nie wycieki przez współdzielony cache, logi, eksporty czy strumienie SSE. | RLS + klucze cache z `user_id` + zakaz logowania danych finansowych + kanały SSE per użytkownik + testy izolacji end-to-end (NFR-03.04, NFR-03.05). | — |
| Z-23 | Repozytorium publiczne (decyzja z Kroku 2) | Ujawnia architekturę i zależności (ułatwia rekonesans); ryzyko przypadkowego commitu sekretów lub danych. | Bezpieczeństwo nie opiera się na ukryciu; skanowanie sekretów z push protection; brak IP/hostów/portów/konfiguracji VPN w repo; fixtures anonimizowane ([ADR-013](../09-decyzje/ADR-013-repozytorium-publiczne.md)). | NFR-03.12. |
| Z-24 | §0 `AGENT.md` / budowa w Codex | Codex czyta `AGENTS.md` (limit 32 KiB) i nie ma skilli Claude (`strategy-critique`, `backtest-review`). | `AGENTS.md` zamiast `AGENT.md`; checklisty metodologiczne przeniesione do dokumentacji i `AGENTS.md`. | [`../../AGENTS.md`](../../AGENTS.md) § 7. |
| Z-25 | §4.3 CSP bez `unsafe-inline` w Next.js | CSP z nonce wymusza dynamiczne renderowanie wszystkich stron (brak optymalizacji statycznej, ISR i PPR). | Akceptowalne: ekrany po zalogowaniu i tak są spersonalizowane; strony publiczne (logowanie) są lekkie. | NFR-03.06. |
| Z-26 | §3.1.6 tryb demo | Publiczne demo z danymi rynkowymi = redystrybucja danych (licencje) i dodatkowa powierzchnia ataku. | Demo tylko dla zalogowanych (osobny rachunek typu `demo`). | FR-06.04. |
| Z-27 | §4.5 serwer domowy + VPS jako edge | Awaria domu (prąd, łącze, sprzęt) albo VPS oznacza niedostępność aplikacji; redundancja nie mieści się w 0 zł. | Akceptowane dla aplikacji prywatnej: cel 99 % miesięcznie, monitoring z VPS, odtworzenie ≤ 4 h ([`../07-wdrozenie/backup-dr.md`](../07-wdrozenie/backup-dr.md)); UPS i drugi węzeł jako koszt w [`../10-ograniczenia.md`](../10-ograniczenia.md) (L-01, L-02; brak UPS potwierdzony 2026-09-19). | NFR-09.01, NFR-09.03. |
| Z-28 | §4.3 ASVS L2 „kontrola po kontroli” | Kilka wymagań ASVS 5.0 L2 jest nieproporcjonalnych dla jednej VM i kilku użytkowników (TLS między kontenerami jednego hosta, sejf sekretów, logi na osobnym systemie) albo koliduje z funkcjami (migawka offline w przeglądarce, kody zapasowe szyfrowane zamiast haszowanych w Better Auth). | Każde odstępstwo opisane z uzasadnieniem, środkami kompensującymi i warunkiem powrotu ([`../06-bezpieczenstwo/kontrole-bezpieczenstwa.md`](../06-bezpieczenstwo/kontrole-bezpieczenstwa.md) § 8). | NFR-03.01. |

---

## 4. Założenia

| ID | Założenie | Skutek, jeśli nieprawdziwe |
|---|---|---|
| A-01 | Waluta bazowa PLN; instrumenty w PLN, USD i EUR. | Dodanie waluty = konfiguracja (FX z NBP obejmuje tabelę A). |
| A-02 | Strefa czasowa użytkowników Europe/Warsaw; daty sesji wg kalendarza giełdy. | Preferencja strefy per użytkownik (FR-07.08). |
| A-03 | ≤ 10 kont, ≤ 5 równoczesnych użytkowników. | Rewizja NFR-01.08 i limitów kolejek. |
| A-04 | Adres aplikacji: `invest.oligi.pl` (potwierdzony przez właściciela 2026-09-19). | Zmiana konfiguracji DNS/TLS. |
| A-05 | VPS OVH 1 vCPU / 2 GB RAM / 20 GB (potwierdzone 2026-09-19) pełni funkcję edge: dziś kończy TLS dla Immicha w Caddy, docelowo wyłącznie przekaźnik TCP (routing po SNI) przez WireGuard, bez dostępu do odszyfrowanej treści. | Zmiana projektu edge w ADR-011. |
| A-06 | Użytkownicy mają rachunki w XTB i/lub mBank eMakler; przed M1 właściciel dostarczy anonimizowane pliki eksportu jako fixtures. | Bez fixtures parsery powstaną na podstawie dokumentacji społecznościowej — wyższe ryzyko błędów. |
| A-07 | Historia instrumentów: do 10+ lat dziennych danych; ≤ 2 000 śledzonych instrumentów. | Rewizja rozmiaru bazy i czasu batchy. |
| A-08 | Aplikacja nie składa zleceń i nie łączy się z rachunkami w trybie zapisu. | Zmiana statusu regulacyjnego ([`../11-zgodnosc-prawna.md`](../11-zgodnosc-prawna.md) § 8). |
| A-09 | Homelab nie wystawia usług do internetu; cały ruch, także wychodzący z VM, przechodzi przez tunel WireGuard i publiczny adres VPS; rejestrator i DNS domeny: home.pl (potwierdzone 2026-09-19). | Zmiana przepływów w [`../07-wdrozenie/infrastruktura.md`](../07-wdrozenie/infrastruktura.md) § 3 i ponowna ocena T-EDGE-02. |
