# Zgodność prawna: doradztwo, rekomendacje, disclaimery, podatki, licencje danych

**Cel:** ustalić status prawny funkcji OligInvest wobec przepisów o doradztwie inwestycyjnym (MiFID II) i rekomendacjach inwestycyjnych (MAR), zdefiniować obowiązkowe disclaimery i checklistę języka dla interfejsu, opisać podstawy prawne widoku podatkowego oraz licencje i atrybucje źródeł danych — tak, aby aplikacja analizowała i uczyła, a nie doradzała (FR-04.01, FR-05.07, NFR-07.01–NFR-07.04).

> Dokument przygotowano bez udziału prawnika i doradcy podatkowego — nie jest opinią prawną ani podatkową. Opisuje przyjęte założenia projektowe i ich podstawy. Przed udostępnieniem aplikacji osobom spoza najbliższego kręgu warto skonsultować go z prawnikiem ([`10-ograniczenia.md`](10-ograniczenia.md), L-42).

Powiązane: [`00-przeglad/wizja-produktu.md`](00-przeglad/wizja-produktu.md) § 6 (poza zakresem), [`03-dane/obliczenia-finansowe.md`](03-dane/obliczenia-finansowe.md) § 2.2 i § 12–13, [`03-dane/zrodla-danych.md`](03-dane/zrodla-danych.md), [`04-frontend/system-projektowy.md`](04-frontend/system-projektowy.md) (`<Disclaimer/>`, `<AssumptionsBlock/>`), [`06-bezpieczenstwo/prywatnosc-rodo.md`](06-bezpieczenstwo/prywatnosc-rodo.md) (RODO), [`12-dla-uzytkownika/regulamin.md`](12-dla-uzytkownika/regulamin.md).

Stan prawny sprawdzony **2026-09-19**; źródła w § 9.

## 1. Wnioski

1. **OligInvest nie świadczy doradztwa inwestycyjnego**, dopóki nie przedstawia użytkownikowi zalecenia kupna, sprzedaży lub utrzymania konkretnego instrumentu jako odpowiedniego dla niego (§ 2). Doradztwo wymaga zezwolenia KNF — dlatego granica jest regułą projektową, nie kwestią stylu.
2. **OligInvest nie wytwarza rekomendacji inwestycyjnych w rozumieniu MAR**: nie proponuje konkretnych decyzji inwestycyjnych i nie wyraża opinii o przyszłej cenie instrumentów (§ 3). Dodatkowo treści nie są przeznaczone dla kanałów dystrybucyjnych ani publiczności (aplikacja prywatna, dostęp z zaproszenia), ale projekt **nie opiera się** na tym argumencie.
3. O statusie decyduje treść funkcji, nie jej nazwa. Najbliżej granicy są: optymalizacja portfela, kalkulator rebalancingu, screener, backtest i alerty — mają twarde reguły w § 2.2 i § 4.
4. Widok podatkowy liczy przychody i koszty według dnia rozliczenia transakcji i kursu NBP z dnia poprzedniego (§ 5); jest informacyjny i nie zastępuje PIT-8C ani zeznania.
5. Dane z darmowych źródeł wolno pokazywać wyłącznie zalogowanym użytkownikom, z atrybucją; pokazywanie ich kilku zaproszonym osobom jest szarą strefą licencyjną, świadomie zaakceptowaną (§ 6, R-06).
6. Ponowna ocena jest obowiązkowa przy zmianach z § 8 (np. składanie zleceń, płatności, publiczny dostęp, porady generowane przez LLM).

## 2. MiFID II — doradztwo inwestycyjne

### 2.1 Definicje

- **Dyrektywa 2014/65/UE (MiFID II), art. 4 ust. 1 pkt 4:** doradztwo inwestycyjne to świadczenie klientowi *rekomendacji osobistych* — na jego wniosek albo z inicjatywy firmy — dotyczących transakcji instrumentami finansowymi.
- **Rozporządzenie delegowane (UE) 2017/565, art. 9:** rekomendacja jest *osobista*, gdy trafia do osoby jako (potencjalnego) inwestora, jest przedstawiona jako odpowiednia dla tej osoby albo oparta na jej sytuacji i zaleca kupno, sprzedaż, subskrypcję, zamianę, umorzenie, utrzymanie lub gwarantowanie emisji konkretnego instrumentu (albo wykonanie lub niewykonanie wynikającego z niego prawa). Rekomendacja wydana wyłącznie publicznie nie jest osobista.
- **Ustawa o obrocie instrumentami finansowymi:** art. 69 ust. 1 — działalność maklerska wymaga zezwolenia Komisji Nadzoru Finansowego; art. 69 ust. 2 pkt 5 — obejmuje doradztwo inwestycyjne; art. 76 ust. 1 — doradztwo polega na przygotowaniu i przekazaniu klientowi rekomendacji z art. 9 rozporządzenia 2017/565, przygotowanej w oparciu o potrzeby i sytuację klienta, dotyczącej nabycia lub zbycia instrumentów finansowych.

### 2.2 Funkcje OligInvest wobec kryteriów

Rekomendacja osobista wymaga łącznie: (a) konkretnego instrumentu, (b) oparcia na sytuacji osoby lub przedstawienia jako odpowiedniej dla niej, (c) zalecenia działania. Projekt usuwa kryterium (c) z każdej funkcji, a tam, gdzie to możliwe, także (a).

| Funkcja | (a) konkretny instrument | (b) sytuacja użytkownika | (c) zalecenie działania | Reguły, które utrzymują funkcję poza doradztwem |
|---|---|---|---|---|
| Portfel, wyniki, ryzyko historyczne (FR-02, FR-03) | tak | tak | **nie** — opis przeszłości | brak ocen typu „dobra/zła pozycja” |
| Wskaźniki techniczne (FR-01.05) | tak | nie | **nie** | wartości i wyjaśnienia bez „sygnałów”: „RSI powyżej 70”, nie „sygnał sprzedaży” (§ 4.1) |
| Monte Carlo, kalkulator celu (FR-04.02, FR-04.09) | nie (klasy aktywów, proxy) | tak | **nie** — rozkład scenariuszy | przedziały, lewy ogon pierwszy, tabela wrażliwości ([`03-dane/obliczenia-finansowe.md`](03-dane/obliczenia-finansowe.md) § 12.1) |
| **Optymalizacja portfela** (FR-04.03) | tak | tak | **ryzyko** — wagi mogą wyglądać na zalecenie | wynik nazwany „wagi modelu przy założeniach…”, pokazany jako przedziały z resamplingu; domyślnie metody bez prognoz zwrotu; brak słów „optymalny dla Ciebie”; przejście do rebalancingu tylko świadomym kliknięciem; disclaimer `optimization` |
| **Kalkulator rebalancingu** (FR-04.06) | tak | tak | **ryzyko** — lista transakcji | liczy różnicę do alokacji docelowej **ustawionej przez użytkownika**: nagłówek „Transakcje potrzebne do osiągnięcia Twojej alokacji docelowej”, nie „zalecane transakcje”; koszty i podatek widoczne; blokada przy nieuzgodnionych danych |
| Testy skrajne, „co jeśli” (FR-04.04, FR-04.05) | tak | tak | **nie** — historia i hipoteza użytkownika | założenia i okres widoczne; brak wniosków typu „zmniejsz pozycję” |
| **Screener** (FR-01.11, FR-04.07) | tak | nie | **ryzyko** — lista może wyglądać na wybór | tylko kryteria użytkownika; brak rankingu „najlepszych” i domyślnego sortowania po „atrakcyjności”; lista spełnionych warunków przy każdym wyniku; disclaimer `screener` |
| **Backtest** (FR-04.08) | tak | nie | **ryzyko** — „strategia działa” | wyniki OOS obok IS, Deflated Sharpe Ratio, ostrzeżenia metodologiczne; disclaimer `backtest` |
| **Alerty** (FR-05) | tak | tak | **ryzyko** — powiadomienie jako „sygnał” | warunek ustawia użytkownik; treść: wartość, próg, czas, źródło, link — bez oceny i trybu rozkazującego |
| Edukacja, glosariusz, demo (FR-06) | czasem | nie | **nie** | treści ogólne, niepersonalizowane; przykłady na fikcyjnym portfelu |

**Poza zakresem** (zmieniłoby ocenę — § 8): ankieta odpowiedniości i dobór instrumentów do profilu, sygnały „kup/sprzedaj”, rankingi, cele cenowe, składanie zleceń, porady generowane przez LLM ([`00-przeglad/wizja-produktu.md`](00-przeglad/wizja-produktu.md) § 6).

## 3. MAR — rekomendacje inwestycyjne

- **Rozporządzenie (UE) nr 596/2014 (MAR), art. 3 ust. 1 pkt 34:** „informacja rekomendująca lub sugerująca strategię inwestycyjną” to m.in. informacja sporządzona przez osobę inną niż analityk czy firma inwestycyjna, która *bezpośrednio proponuje konkretną decyzję inwestycyjną* w odniesieniu do instrumentu finansowego.
- **Art. 3 ust. 1 pkt 35:** „rekomendacja inwestycyjna” to taka informacja — w sposób wyraźny lub dorozumiany, także jako *opinia o obecnej lub przyszłej wartości albo cenie instrumentu* — przeznaczona dla kanałów dystrybucyjnych lub dla publiczności.
- **Art. 20 MAR i rozporządzenie delegowane (UE) 2016/958** nakładają na autorów rekomendacji obowiązki (obiektywna prezentacja, ujawnianie źródeł, konfliktów interesów). OligInvest ich nie wytwarza, więc tych obowiązków nie realizuje — w zamian ma zakazy z § 4.1, które nie dopuszczają powstania rekomendacji.

Skutek dla produktu: żadnych prognoz ceny instrumentu (także „przedziałów ceny instrumentu za N dni”), żadnych propozycji decyzji. Symulacje dotyczą wartości **portfela** i opierają się na proxy klas aktywów; wyniki są rozkładami z założeniami.

## 4. Zasady produktu, disclaimery i checklista

### 4.1 Zakazy (twarde)

| Kategoria | Przykłady zakazanych treści |
|---|---|
| Prognozy punktowe | „cena za 30 dni = X”, „portfel za rok = Y”, „oczekiwany kurs” |
| Tryb rozkazujący i sugestie działania wobec instrumentu | „kup”, „sprzedaj”, „trzymaj”, „dokup”, „zredukuj”, „warto kupić”, „zalecamy”, „rekomendujemy”, „powinieneś” |
| Oceny i sygnały | „sygnał kupna/sprzedaży”, „okazja”, „niedowartościowana”, „przewartościowana”, „cel cenowy”, oceny gwiazdkowe, kolory „kupuj/sprzedawaj” |
| Rankingi | „najlepsze spółki”, „top 10”, domyślne sortowanie po „atrakcyjności” |
| Obietnice | „gwarantowany zysk”, „bez ryzyka”, „pewne” |
| Personalizacja doradcza | „odpowiednie dla Ciebie”, dobór instrumentów do profilu ryzyka |

Egzekwowanie w kodzie: test CI przeszukuje komunikaty w `packages/i18n` i treści MDX pod kątem listy zakazanych zwrotów (plik `packages/i18n/src/compliance/forbidden-phrases.pl.json`, dopasowanie całych słów). Wyjątki — z uzasadnieniem w tym samym pliku — dotyczą wyłącznie tekstów disclaimerów i haseł glosariusza, które objaśniają pojęcia (np. hasło „Sygnał transakcyjny” w słowniku).

### 4.2 Wymogi dla ekranów analiz, screenera, alertów i eksportów

| Element | Treść | Komponent |
|---|---|---|
| Założenia | dane (źródło, zakres dat, opóźnienie), model, parametry, koszty i podatki, ziarno losowe, wersja algorytmu; podsumowanie w jednej linii widoczne zawsze, szczegóły po rozwinięciu | `<AssumptionsBlock/>` |
| Wynik | rozkład lub przedział (co najmniej P5–P95), lewy ogon pierwszy; mediana opisana „połowa scenariuszy poniżej” | komponenty wyników |
| Świeżość danych | źródło i czas danych, flaga „nieaktualne” z przyczyną | `<DataFreshness/>` |
| Disclaimer | tekst wg klucza i wersji z § 4.3 | `<Disclaimer/>` |
| Jak czytać | wyjaśnienie percentyli i ograniczeń (FR-06.06) | `<Explainer/>` |

### 4.3 Teksty disclaimerów (wersja `2026-09`)

Źródłem prawdy jest ta tabela; kod trzyma teksty w `packages/i18n/src/pl/disclaimers.json` (klucz, wersja, tekst), a test CI porównuje oba miejsca. Zmiana tekstu = nowa wersja.

| Klucz | Gdzie | Tekst |
|---|---|---|
| `general` | stopka aplikacji, strona „O aplikacji”, e-maile | OligInvest służy do analizy i nauki. Nie świadczy doradztwa inwestycyjnego ani nie formułuje rekomendacji inwestycyjnych. Decyzje inwestycyjne podejmujesz samodzielnie i na własne ryzyko. |
| `analysis` | każdy wynik FR-04 | To scenariusze obliczone na danych historycznych i przyjętych założeniach, a nie prognoza. Rzeczywisty wynik może znaleźć się poza pokazanym przedziałem. Wyniki z przeszłości nie gwarantują przyszłych. |
| `optimization` | optymalizacja portfela (razem z `analysis`) | Wagi są wynikiem modelu matematycznego wrażliwego na założenia i błędy oszacowania. Nie są zaleceniem zmiany portfela. |
| `rebalance` | kalkulator rebalancingu | Lista pokazuje transakcje potrzebne do osiągnięcia alokacji docelowej, którą ustawiłeś. Nie jest zaleceniem ich zawarcia; koszty i podatek są szacunkowe. |
| `backtest` | wyniki backtestu (razem z `analysis`) | Backtest pokazuje, jak reguła zachowałaby się w przeszłości przy przyjętych kosztach i uproszczeniach. Nie przewiduje przyszłości. Im więcej wariantów sprawdzono, tym większe ryzyko, że dobry wynik jest przypadkowy. |
| `screener` | screener i screening kandydatów | Lista zawiera instrumenty spełniające Twoje kryteria. Nie jest rankingiem ani zachętą do zakupu. |
| `alerts` | kreator alertu, stopka e-maila z alertem | Alert informuje, że spełnił się warunek ustawiony przez Ciebie. Nie jest sygnałem do zawarcia transakcji. |
| `tax_view` | widok podatkowy, eksport zestawień | Widok podatkowy ma charakter informacyjny i może różnić się od PIT-8C oraz zeznania podatkowego. Nie jest doradztwem podatkowym. |
| `data_delay` | karta instrumentu, rynek, Skróty | Notowania są opóźnione (zwykle ok. 15 min) albo pochodzą z zamknięcia sesji. Źródło i czas danych podajemy przy każdej wartości. |
| `export` | pierwsza linia plików CSV/JSON z wynikami | Dane wyeksportowane z OligInvest do użytku osobistego; zawierają dane objęte licencjami dostawców — nie publikuj ich. Analizy nie są rekomendacją ani doradztwem. |
| `education` | lekcje i glosariusz | Materiały edukacyjne mają charakter ogólny i nie uwzględniają Twojej sytuacji. |
| `demo` | baner trybu demo | Tryb demo: fikcyjny portfel na danych historycznych. Operacje nie wpływają na Twoje dane. |

Powiadomienia push i odpowiedzi Skrótów są zbyt krótkie na disclaimer — zawierają wyłącznie fakty (wartość, próg, czas i status danych), a disclaimer `alerts` jest w kreatorze alertu i w stopce e-maila.

### 4.4 Checklista zgodności (szablon PR i testy e2e)

- [ ] Brak zwrotów z listy § 4.1 (test CI słownika i MDX przechodzi).
- [ ] Każda wartość dotycząca przyszłości jest przedziałem lub rozkładem z opisem założeń.
- [ ] `<AssumptionsBlock/>`, `<DataFreshness/>` i `<Disclaimer/>` z właściwym kluczem są na ekranie (test e2e sprawdza ich obecność na każdej trasie z tabeli [`04-frontend/mapa-ekranow.md`](04-frontend/mapa-ekranow.md) oznaczonej Z/D).
- [ ] Brak rankingów i domyślnego sortowania po „atrakcyjności”.
- [ ] Treść alertów i Skrótów: tylko fakty, bez oceny.
- [ ] Eksport zawiera linię `export` i atrybucje źródeł.
- [ ] Nowa funkcja predykcyjna lub backtestowa ma przegląd metodologiczny (checklisty w [`../AGENTS.md`](../AGENTS.md), [`03-dane/obliczenia-finansowe.md`](03-dane/obliczenia-finansowe.md) § 13).

## 5. Podatki — podstawy widoku podatkowego

### 5.1 Przepisy i interpretacje

| Zagadnienie | Podstawa | Zastosowanie w OligInvest |
|---|---|---|
| Stawka | ustawa o PIT, art. 30b ust. 1 — 19 % dochodu m.in. z odpłatnego zbycia papierów wartościowych | szacunki w widoku podatkowym i w modelach (podatek Belki) |
| Moment przychodu | art. 17 ust. 1ab pkt 1 — przychód z odpłatnego zbycia papierów wartościowych powstaje w momencie **przeniesienia własności** na nabywcę | dzień przychodu i kosztu = **dzień rozliczenia transakcji** (`settle_date`) |
| Przeliczenie walut | art. 11a ust. 1 i 2 — przychody i koszty w walutach obcych po kursie średnim NBP z **ostatniego dnia roboczego poprzedzającego** dzień przychodu lub kosztu | kurs NBP (tabela A) z dnia poprzedzającego `settle_date` |
| Kolejność zbycia | art. 24 ust. 10 — przy braku możliwości ustalenia ceny nabycia zbywanych papierów stosuje się FIFO, **odrębnie dla każdego rachunku** papierów wartościowych | FIFO per rachunek; IKE/IKZE — „nie dotyczy” |
| Interpretacja | Dyrektor KIS, 29.03.2024, sygn. 0114-KDIP3-1.4011.1149.2023.1.AK — przy sprzedaży akcji z rynku USA przychód i koszt powstają w dniu przeniesienia własności, kurs NBP z dnia roboczego poprzedzającego | potwierdza wybór `settle_date` |
| Praktyka brokera | XTB przelicza przychody i koszty kursem NBP z dnia roboczego poprzedzającego rozliczenie (T+1 dla USA, T+2 dla pozostałych rynków) | ułatwia uzgodnienie z PIT-8C |

**Cykle rozliczeń** (do wyliczenia `settle_date`, gdy import go nie podaje): USA — T+1 od 28.05.2024 (wcześniej T+2); GPW i pozostałe rynki UE — T+2, a od **11.10.2027 T+1** (rozporządzenie (UE) 2025/2075, opublikowane 14.10.2025). Wzory: [`03-dane/obliczenia-finansowe.md`](03-dane/obliczenia-finansowe.md) § 2.2.

### 5.2 Decyzje projektowe

- `tax_date_basis = settlement` (domyślnie); `trade` tylko do porównań. Oba parametry widoku podatkowego są ustawieniami użytkownika (`identity.user_preferences`), a ich zmiana przelicza tylko widok podatkowy.
- Marża przewalutowania brokera: poza kosztem podatkowym, jako osobna pozycja (`tax_include_fx_fee = false`) — § 5.3.
- Widok podatkowy jest drugim widokiem obok ekonomicznego (Z-16, [ADR-014](09-decyzje/ADR-014-pieniadze-waluty-czas.md)) i zawsze ma disclaimer `tax_view`.
- Dywidendy zagraniczne: kwota brutto, podatek u źródła i szacowana dopłata do 19 % — informacyjnie ([`03-dane/obliczenia-finansowe.md`](03-dane/obliczenia-finansowe.md) § 4.3).

### 5.3 Kwestie nierozstrzygnięte (❓)

| Kwestia | Stan | Decyzja tymczasowa |
|---|---|---|
| Marża przewalutowania brokera przy zakupie instrumentu w USD z rachunku PLN | brak jednolitej praktyki: przy przeliczeniu ceny kursem NBP marża nie trafia do kosztu, część praktyków przyjmuje faktycznie zapłaconą kwotę w PLN | decyzja właściciela (2026-09-19): marża poza kosztem podatkowym, pokazywana jako osobny koszt (`fxCosts`); ustawienie `tax_include_fx_fee` (domyślnie `false`) pozwala ją wliczyć, np. po interpretacji lub porównaniu z PIT-8C |
| Dni, w których giełda działa, a system rozliczeń nie (np. niektóre święta federalne w USA) | kalendarz rozliczeń różni się od kalendarza sesji | wpisy admina w `market.trading_calendar`; sprawdzenie przed M1 |
| Straty z lat ubiegłych, rozliczenie PIT-38 | poza zakresem ([`00-przeglad/wizja-produktu.md`](00-przeglad/wizja-produktu.md) § 6) | ewentualne „zestawienie pomocnicze” w przyszłości, z disclaimerem |

## 6. Licencje danych i atrybucje (NFR-07.03, NFR-07.04)

Zasady: dane rynkowe tylko dla zalogowanych użytkowników (sesja lub PAT); brak publicznych stron i API z danymi; atrybucja źródła przy komponentach z danymi i na stronie **„Źródła danych i licencje”** (`/zrodla-danych` — treść statyczna, bez danych rynkowych).

| Źródło | Warunki (skrót) | Atrybucja w UI | Uwagi |
|---|---|---|---|
| GPW — archiwum notowań | ❓ regulamin archiwum nieodnaleziony; przyjmujemy użytek prywatny bez redystrybucji ([`03-dane/zrodla-danych.md`](03-dane/zrodla-danych.md)) | „Źródło: GPW” | uczciwa identyfikacja klienta, 1 żądanie na sesję, bez obchodzenia blokad |
| Yahoo Finance | nieoficjalne API „intended for personal use only” (README yfinance) | „Dane: Yahoo Finance” | szara strefa przy kilku użytkownikach (R-06); adapter wyłączalny flagą |
| NBP | dane publiczne, „© NBP” | „Kursy: NBP” | kurs podatkowy D-1 |
| Frankfurter (dane EBC) | darmowe, z podaniem źródła | „Kursy: EBC (Frankfurter)” | tylko zapas dla NBP, oznaczany w UI |
| FRED | obowiązkowa nota | „This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.” | nota na stronie źródeł i przy wykresach makro |
| GDELT | otwarte dane, atrybucja | „Dane: The GDELT Project” | „ton artykułów”, nie sentyment |
| Alpha Vantage, Finnhub, Twelve Data, Marketaux | darmowe plany do użytku osobistego/niekomercyjnego; ❓ pełne warunki atrybucji do sprawdzenia przy włączaniu adaptera | nazwa dostawcy przy danych | szara strefa jak Yahoo (R-06) |
| Stooq | ❓ regulamin; tylko ręczny import pliku pobranego przez użytkownika | „Źródło: Stooq (import ręczny)” | bez automatycznego pobierania (`robots.txt`) |
| TradingView Lightweight Charts | Apache-2.0 z wymogiem atrybucji z pliku NOTICE i linku do tradingview.com | logo atrybucji na wykresie (opcja `layout.attributionLogo`, domyślnie włączona) + wpis na stronie źródeł | spełnia wymóg linku ([dokumentacja](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/LayoutOptions)) |
| Eksporty XTB i mBank | dane własne użytkownika | — | pliki usuwane po 90 dniach |

Biblioteki open source: licencje w SBOM każdego wydania ([`07-wdrozenie/ci-cd.md`](07-wdrozenie/ci-cd.md) § 5) i w `.claude/skills/THIRD_PARTY_NOTICES.md` (skille). Ograniczenie vectorbt (Commons Clause): [`10-ograniczenia.md`](10-ograniczenia.md), L-41.

## 7. Regulamin i dokumenty użytkownika

- Regulamin (art. 8 ustawy o świadczeniu usług drogą elektroniczną) i informacja o przetwarzaniu danych (art. 13 RODO): [`12-dla-uzytkownika/regulamin.md`](12-dla-uzytkownika/regulamin.md), [`12-dla-uzytkownika/informacja-o-prywatnosci.md`](12-dla-uzytkownika/informacja-o-prywatnosci.md); mechanika akceptacji i wersji: [`06-bezpieczenstwo/prywatnosc-rodo.md`](06-bezpieczenstwo/prywatnosc-rodo.md) § 5.
- Usługodawcą jest osoba fizyczna, która nie prowadzi działalności gospodarczej w zakresie tej usługi; usługa jest nieodpłatna i prywatna. ❓ Zakres zastosowania przepisów konsumenckich do takiej usługi nie był badany — regulamin nie wyłącza praw, których prawo nie pozwala wyłączyć.
- Aplikacja nie składa zleceń i nie łączy się z rachunkami maklerskimi w trybie zapisu (założenie A-08); nie przechowuje haseł do rachunków (NFR-03.08).

## 8. Kiedy ponownie ocenić status

Każda z poniższych zmian wymaga aktualizacji tego dokumentu i ADR **przed** implementacją:

- składanie zleceń lub połączenie z rachunkiem w trybie zapisu (np. xAPI z hasłem użytkownika);
- sugestie działań wobec instrumentów, rankingi, cele cenowe, dobór instrumentów do profilu ryzyka;
- treści generowane przez modele językowe;
- płatności, reklamy, publiczna rejestracja lub publiczne strony z danymi rynkowymi;
- zmiana dostawcy danych na płatnego (nowe warunki licencji);
- zmiany prawa: MiFID II, MAR, ustawa o PIT, RODO — przegląd raz w roku (styczeń).

## 9. Źródła (sprawdzone 2026-09-19)

- [Dyrektywa 2014/65/UE (MiFID II)](https://eur-lex.europa.eu/eli/dir/2014/65/oj) · [Rozporządzenie delegowane (UE) 2017/565](https://eur-lex.europa.eu/eli/reg_del/2017/565/oj) · [Rozporządzenie (UE) nr 596/2014 (MAR)](https://eur-lex.europa.eu/eli/reg/2014/596/oj) · [Rozporządzenie delegowane (UE) 2016/958](https://eur-lex.europa.eu/eli/reg_del/2016/958/oj) · [Rozporządzenie (UE) 2025/2075 (T+1 w UE)](https://eur-lex.europa.eu/eli/reg/2025/2075/oj)
- Ustawa o obrocie instrumentami finansowymi: [art. 69](https://lexlege.pb.pl/ustawa-o-obrocie-instrumentami-finansowymi/art-69/), [art. 76](https://lexlege.pb.pl/ustawa-o-obrocie-instrumentami-finansowymi/art-76/)
- Ustawa o PIT: [art. 11a](https://lexlege.pb.pl/ustawa-o-podatku-dochodowym-od-osob-fizycznych/art-11a/), [art. 17](https://lexlege.pb.pl/ustawa-o-podatku-dochodowym-od-osob-fizycznych/art-17/), [art. 24](https://lexlege.pb.pl/ustawa-o-podatku-dochodowym-od-osob-fizycznych/art-24/), [art. 30b](https://lexlege.pb.pl/ustawa-o-podatku-dochodowym-od-osob-fizycznych/art-30b/)
- [Interpretacja Dyrektora KIS z 29.03.2024, 0114-KDIP3-1.4011.1149.2023.1.AK](https://www.inforlex.pl/dok/tresc,FOB0000000000006577324,Interpretacja-indywidualna-z-dnia-29-marca-2024-r-Dyrektor-Krajowej-Informacji-Skarbowej-sygn-0114-KDIP3-1-4011-1149-2023-1-AK.html) · [XTB: jak przeliczamy przychody i koszty na PLN](https://www.xtb.com/pl/centrum-pomocy/rozliczenie-podatkowe-5/jak-przeliczamy-przychody-i-koszty-na-pln) · [Podatek Giełdy: data rozliczenia akcji zagranicznych](https://podatekgieldy.pl/pl/pomoc/obliczenia-podatkowe/data-rozliczenia-akcje-zagraniczne) (aktualizacja 23.03.2026)
- Warunki dostawców danych: [`03-dane/zrodla-danych.md`](03-dane/zrodla-danych.md) (linki do regulaminów, sprawdzone 2026-09-18)
