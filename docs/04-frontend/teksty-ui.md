# Teksty interfejsu (pl-PL)

**Cel:** dać jedno źródło prawdy dla polskich napisów w aplikacji — nawigacji, nagłówków ekranów, etykiet, przycisków, stanów pustych, komunikatów błędów i mikro-tekstów o danych — tak aby agent budujący ekrany przepisywał je do `packages/i18n`, zamiast wymyślać własne, i aby język był spójny oraz zgodny z zakazami z [`../11-zgodnosc-prawna.md`](../11-zgodnosc-prawna.md) § 4.1.

Powiązane: [`mapa-ekranow.md`](mapa-ekranow.md) (trasy i ekrany), [`system-projektowy.md`](system-projektowy.md) § 5 (formatowanie liczb i dat), [`dostepnosc.md`](dostepnosc.md), [`../02-api/konwencje-api.md`](../02-api/konwencje-api.md) § 4 (kody błędów), [`../11-zgodnosc-prawna.md`](../11-zgodnosc-prawna.md) § 4 (zakazy i disclaimery). Zadanie: BL-012.

## 1. Zasady języka

1. **Zwracamy się na „Ty”**, bez form grzecznościowych w nagłówkach („Twoje pozycje”, nie „Państwa pozycje”). Interfejs mówi o tym, co jest, a nie o tym, co „warto”.
2. **Przyciski w trybie rozkazującym** i zawsze o działaniu w aplikacji: „Zapisz”, „Zaimportuj plik”, „Uruchom analizę”. Nigdy o decyzji inwestycyjnej.
3. **Zakaz języka doradczego** (LAW § 4.1): `kup`, `sprzedaj`, `warto`, `polecamy`, `okazja`, `sygnał kupna`, `rekomendacja`, `pewny zysk`. Zamiast „Sygnał kupna” piszemy „Warunek, który ustawiłeś, został spełniony”.
4. **Liczby i daty tylko przez formatery** z `system-projektowy.md` § 5. W tekstach są miejsca na wartość (`{value}`, `{date}`, `{count}`), nigdy liczba wpisana na stałe.
5. **Bez wykrzykników, emoji i przepraszania.** Komunikat błędu mówi, co się stało i co zrobić dalej.
6. **Termin fachowy przy pierwszym użyciu na ekranie ma `<Explainer/>`** (TWR, XIRR, obsunięcie, FIFO, percentyl).
7. **Długości:** tytuł ekranu ≤ 32 znaki, etykieta kolumny ≤ 16, przycisk ≤ 20, stan pusty = jedno zdanie + jedna akcja.
8. **Klucze i18n:** `obszar.ekran.element` (np. `portfolio.positions.title`), pliki `packages/i18n/src/pl/<obszar>.json`. Liczba mnoga przez `Intl.PluralRules` (formy: 1 / 2–4 / 5+).

## 2. Nawigacja i powłoka

| Klucz | Tekst | Gdzie |
|---|---|---|
| `nav.start` | Start | dolny pasek, panel boczny |
| `nav.portfolio` | Portfel | jw. |
| `nav.market` | Rynek | jw. |
| `nav.alerts` | Alerty | jw. |
| `nav.more` | Więcej | dolny pasek (telefon) |
| `nav.analytics` | Analizy | panel boczny, „Więcej” |
| `nav.learn` | Nauka | jw. |
| `nav.settings` | Ustawienia | jw. |
| `nav.admin` | Administracja | tylko rola `admin` |
| `shell.skipLink` | Przejdź do treści | pierwszy element fokusowalny |
| `shell.accounts.all` | Wszystkie rachunki | przełącznik rachunków |
| `shell.search.placeholder` | Szukaj instrumentu — nazwa, ticker, ISIN | pole wyszukiwania |
| `shell.search.hint` | Naciśnij ukośnik, aby wyszukać | podpowiedź skrótu (komputer) |
| `shell.offline` | Brak połączenia. Pokazujemy ostatnie zapisane dane. | baner offline |
| `shell.stale` | Dane mogą być nieaktualne — ostatnia aktualizacja {time}. | baner nieaktualnych danych |

## 3. Nagłówki ekranów

| Trasa | Tytuł | Zdanie pod tytułem (opcjonalne) |
|---|---|---|
| `/logowanie` | Zaloguj się | — |
| `/logowanie/2fa` | Kod z aplikacji | Wpisz sześciocyfrowy kod lub użyj kodu zapasowego. |
| `/rejestracja` | Załóż konto | Konto zakładasz z zaproszenia od administratora. |
| `/konfiguracja-2fa` | Włącz drugi składnik | Bez niego nie zobaczysz swoich danych. |
| `/akceptacja-regulaminu` | Zmienił się regulamin | Przeczytaj zmiany i potwierdź, aby korzystać dalej. |
| `/` | Start | — |
| `/portfel` | Portfel | — |
| `/portfel/operacje` | Operacje | — |
| `/portfel/operacje/nowa` | Nowa operacja | — |
| `/portfel/import` | Import z pliku | Obsługujemy eksporty z XTB i mBanku eMakler. |
| `/portfel/import/[id]` | Podgląd importu | Sprawdź wiersze i uzgodnij salda przed zatwierdzeniem. |
| `/portfel/wyniki` | Wyniki | — |
| `/portfel/ryzyko` | Ryzyko | — |
| `/portfel/alokacja` | Alokacja | — |
| `/portfel/dywidendy` | Dywidendy | — |
| `/portfel/partie` | Partie | Metoda FIFO, zgodnie z polskimi przepisami podatkowymi. |
| `/portfel/dziennik` | Dziennik decyzji | Ocena procesu, nie wyniku. |
| `/portfel/rachunki` | Rachunki | — |
| `/rynek` | Rynek | — |
| `/rynek/[id]` | nazwa instrumentu | ticker · giełda · waluta |
| `/rynek/heatmapa` | Heatmapa | — |
| `/rynek/screener` | Screener | Lista instrumentów spełniających Twoje kryteria. |
| `/rynek/kalendarz` | Kalendarz | — |
| `/rynek/watchlisty` | Watchlisty | — |
| `/rynek/waluty` | Waluty | Kursy średnie NBP, tabela A. |
| `/analizy` | Analizy | Wyniki to scenariusze i rozkłady, nie prognozy. |
| `/analizy/nowa/[typ]` | Nowa analiza | — |
| `/analizy/[id]` | nazwa analizy | typ · horyzont · data uruchomienia |
| `/alerty` | Alerty | Alert mówi, że spełnił się warunek, który ustawiłeś. |
| `/alerty/nowy` | Nowy alert | — |
| `/nauka` | Nauka | — |
| `/nauka/slownik` | Słownik pojęć | — |
| `/nauka/demo` | Tryb demo | Fikcyjny portfel. Operacje nie wpływają na Twoje dane. |
| `/ustawienia` | Ustawienia | — |
| `/ustawienia/bezpieczenstwo` | Bezpieczeństwo | — |
| `/ustawienia/tokeny` | Tokeny dostępu | Do Skrótów iOS i automatyzacji. |
| `/ustawienia/powiadomienia` | Powiadomienia | — |
| `/ustawienia/dane` | Twoje dane | Eksport, migawka offline, usunięcie konta. |
| `/ustawienia/prywatnosc` | Prywatność i zgody | — |
| `/admin` | Stan systemu | — |

## 4. Etykiety kolumn i pól

**Tabela pozycji i operacji**

| Klucz | Tekst | Uwaga |
|---|---|---|
| `col.instrument` | Instrument | — |
| `col.quantity` | Ilość | do 4 miejsc, bez zer końcowych |
| `col.price` | Kurs | precyzja notowania |
| `col.value` | Wartość | zawsze w walucie bazowej |
| `col.share` | Udział | procent portfela |
| `col.today` | Dziś | zmiana dnia |
| `col.result` | Wynik | P/L niezrealizowany |
| `col.account` | Rachunek | — |
| `col.date` | Data | data zawarcia; w widoku podatkowym data rozliczenia |
| `col.type` | Typ | patrz niżej |
| `col.fee` | Prowizja | — |
| `col.currency` | Waluta | kod ISO |
| `col.note` | Notatka | — |

**Typy operacji** (wartość z kontraktu → tekst): `BUY` Kupno · `SELL` Sprzedaż · `DIVIDEND` Dywidenda · `DEPOSIT` Wpłata · `WITHDRAWAL` Wypłata · `FEE` Opłata · `TAX` Podatek · `SPLIT` Split · `TRANSFER` Przeniesienie · `ADJUSTMENT` Korekta.

**Formularz operacji:** `Typ operacji`, `Instrument`, `Ilość`, `Cena`, `Waluta`, `Prowizja`, `Data i godzina`, `Rachunek`, `Notatka (opcjonalnie)`. Podpowiedzi: „Ilość może być ułamkowa”, „Cena za jedną sztukę, w walucie instrumentu”.

**Ustawienia (FR-07.08):** `Waluta bazowa`, `Metoda kosztu` (FIFO), `Dzień przychodu w widoku podatkowym` (Rozliczenie / Zawarcie), `Koszt przewalutowania` (Osobna pozycja / W koszcie nabycia), `Strefa czasowa`, `Motyw` (Ciemny / Jasny / Systemowy), `Paleta zysku i straty` (Domyślna / Dla daltonistów).

## 5. Przyciski i akcje

| Klucz | Tekst | Uwaga |
|---|---|---|
| `action.save` | Zapisz | — |
| `action.cancel` | Anuluj | — |
| `action.retry` | Spróbuj ponownie | przy błędzie |
| `action.addTransaction` | Dodaj operację | przycisk „+” na telefonie ma `aria-label` z tym tekstem |
| `action.import` | Zaimportuj plik | — |
| `action.commitImport` | Zatwierdź import | aktywny dopiero po uzgodnieniu sald |
| `action.discardImport` | Odrzuć import | potwierdzenie |
| `action.runAnalysis` | Uruchom analizę | przed uruchomieniem pokazujemy założenia |
| `action.cancelAnalysis` | Przerwij | — |
| `action.showTable` | Pokaż tabelę | alternatywa dla każdego wykresu |
| `action.export` | Eksportuj | plik z disclaimerem w pierwszej linii |
| `action.createAlert` | Utwórz alert | — |
| `action.revokeSession` | Zakończ sesję | — |
| `action.deleteAccount` | Usuń konto | akcja nieodwracalna, wymaga potwierdzenia kodem z aplikacji |

Akcje nieodwracalne: tytuł okna to pytanie („Usunąć rachunek {name}?”), treść mówi o skutku („Usuniemy też {count} operacji. Tej operacji nie można cofnąć.”), przycisk powtarza czasownik („Usuń rachunek”), a nie „OK”.

## 6. Stany ekranu

| Sytuacja | Tekst | Akcja |
|---|---|---|
| Portfel pusty | Nie masz jeszcze żadnych pozycji. | Zaimportuj plik / Wypróbuj tryb demo |
| Operacje puste | Brak operacji w wybranym zakresie. | Zmień filtr / Dodaj operację |
| Watchlista pusta | Ta watchlista jest pusta. | Dodaj instrument |
| Alerty puste | Nie masz aktywnych alertów. | Utwórz alert |
| Analizy puste | Nie uruchomiłeś jeszcze żadnej analizy. | Wybierz typ analizy |
| Brak wyników wyszukiwania | Nie znaleźliśmy instrumentu „{query}”. | Sprawdź pisownię lub wpisz ISIN |
| Ładowanie | (bez tekstu — szkielet o wymiarach treści, `aria-busy`) | — |
| Moduł wyłączony | Nie znaleziono strony. | Wróć na start |
| Brak uprawnień | Nie masz dostępu do tej sekcji. | Wróć na start |

## 7. Błędy — tekst według kodu kontraktu

Kod (`code`) jest stabilny i angielski, tytuł i treść — polskie ([`../02-api/konwencje-api.md`](../02-api/konwencje-api.md) § 4). Ekran pokazuje tytuł, zdanie pomocnicze i — przy błędzie serwera — identyfikator żądania.

| `code` | Tytuł | Zdanie pomocnicze |
|---|---|---|
| `BAD_REQUEST` | Nieprawidłowe żądanie | Odśwież stronę i spróbuj ponownie. |
| `UNAUTHENTICATED` | Sesja wygasła | Zaloguj się ponownie. |
| `FORBIDDEN` | Brak dostępu | Ta sekcja nie jest dostępna dla Twojego konta. |
| `MFA_REQUIRED` | Potwierdź logowanie | Wpisz kod z aplikacji uwierzytelniającej. |
| `MFA_ENROLLMENT_REQUIRED` | Włącz drugi składnik | Bez niego nie zobaczysz swoich danych. |
| `TERMS_ACCEPTANCE_REQUIRED` | Zmienił się regulamin | Przeczytaj zmiany i potwierdź, aby korzystać dalej. |
| `STEP_UP_REQUIRED` | Potwierdź tę operację | Wpisz kod z aplikacji uwierzytelniającej. |
| `PAT_SCOPE_MISSING` | Token nie ma uprawnień | Utwórz token z zakresem wymaganym przez tę operację. |
| `NOT_FOUND` | Nie znaleziono | Element nie istnieje albo nie masz do niego dostępu. |
| `CONFLICT` | Dane się zmieniły | Odśwież widok i powtórz zmianę. |
| `IDEMPOTENCY_CONFLICT` | Powtórzone żądanie | To żądanie zostało już wysłane z inną treścią. |
| `INSTRUMENT_AMBIGUOUS` | Więcej niż jeden instrument | Wybierz właściwy z listy. |
| `DUPLICATE_IMPORT` | Ten plik już zaimportowano | Otwórz poprzedni import albo wybierz inny plik. |
| `RECONCILIATION_REQUIRED` | Najpierw uzgodnij dane | Salda rachunku nie zgadzają się z operacjami. |
| `FILE_TOO_LARGE` | Plik jest za duży | Maksymalny rozmiar to 10 MB. |
| `UNSUPPORTED_MEDIA_TYPE` | Nieobsługiwany typ pliku | Wgraj plik XLSX lub CSV. |
| `IMPORT_FORMAT_UNKNOWN` | Nie rozpoznaliśmy formatu | Sprawdź, czy to pełny eksport z XTB lub mBanku. |
| `VALIDATION_FAILED` | Popraw zaznaczone pola | Szczegóły znajdziesz przy polach formularza. |
| `PARAMETERS_OUT_OF_BOUNDS` | Parametry poza dopuszczalnym zakresem | Zmniejsz zakres albo liczbę wariantów. |
| `RATE_LIMITED` | Za dużo żądań | Spróbuj ponownie za {seconds} s. |
| `QUOTA_EXCEEDED` | Wyczerpany dzienny limit | Kolejne analizy będą dostępne jutro. |
| `INTERNAL` | Coś poszło nie tak | Spróbuj ponownie. Jeśli błąd wróci, podaj identyfikator {requestId}. |
| `SERVICE_UNAVAILABLE` | Usługa chwilowo niedostępna | Spróbuj ponownie za {seconds} s. |

Błędy pól formularza: „Podaj wartość”, „Wartość musi być większa od zera”, „Podaj datę nie późniejszą niż dziś”, „Nieprawidłowy format liczby — użyj przecinka”, „Ten rachunek już istnieje”.

## 8. Mikro-teksty o danych i analizach

| Sytuacja | Tekst |
|---|---|
| Notowanie opóźnione | {time} · opóźnione ok. 15 min · {source} |
| Dane z zamknięcia sesji | zamknięcie {date} · {source} |
| Kurs walutowy | kurs średni NBP z {date} (tabela A) |
| Dane nieaktualne | ostatnia aktualizacja {time} — {reason} |
| Powód: dostawca niedostępny | dostawca danych nie odpowiada |
| Powód: poza sesją | giełda zamknięta |
| Wycena portfela | wycena {time} · notowania opóźnione, kursy NBP |
| Analiza: w kolejce | W kolejce — pozycja {position} |
| Analiza: liczy się | Liczymy — {progress}% |
| Analiza: zakończona | Zakończona {time} · {paths} ścieżek · {duration} |
| Analiza: przerwana | Przerwana przez Ciebie {time} |
| Nagłówek założeń | Założenia tej analizy |
| Nagłówek objaśnienia wyniku | Jak czytać ten wynik |
| Widok podatkowy | Widok podatkowy — dzień przychodu: {basis}; koszt przewalutowania: {fxMode} |
| Uzgodnienie po imporcie | Salda zgadzają się co do grosza. / Różnica {value} — sprawdź wiersze oznaczone do rozstrzygnięcia. |

Wyniki analiz zawsze podajemy jako przedział albo rozkład („od {low} do {high}, mediana {median}”), nigdy jako jedną liczbę opisującą przyszłość (LAW § 4.1).

## 9. Zamiast tego — napisz to

| Nie pisz | Napisz |
|---|---|
| Sygnał kupna / sprzedaży | Warunek, który ustawiłeś, został spełniony |
| Rekomendujemy zwiększenie udziału ETF | Twoja alokacja docelowa różni się od obecnej o {value} |
| Prognozowana wartość za 10 lat: {value} | W połowie scenariuszy wartość po 10 latach była wyższa niż {value} |
| Okazja inwestycyjna | Instrument spełnia Twoje kryteria screenera |
| Optymalny portfel | Wynik optymalizacji przy przyjętych założeniach |
| Bezpieczna inwestycja | Zmienność historyczna: {value} |
| Powinieneś zrównoważyć portfel | Lista transakcji potrzebnych do osiągnięcia Twojej alokacji docelowej |

Pełna lista zakazanych zwrotów i ich test w CI: [`../11-zgodnosc-prawna.md`](../11-zgodnosc-prawna.md) § 4.1 oraz `packages/i18n/src/compliance/forbidden-phrases.pl.json`.

## 10. Gdzie to żyje w kodzie

- Teksty z tego dokumentu trafiają do `packages/i18n/src/pl/<obszar>.json`; komponenty nie zawierają literałów (lint sprawdza to w BL-012).
- Disclaimery mają osobne, wersjonowane źródło ([`../11-zgodnosc-prawna.md`](../11-zgodnosc-prawna.md) § 4.3 → `packages/i18n/src/pl/disclaimers.json`) i własny test zgodności — nie powtarzamy ich tutaj.
- Zmiana tekstu w aplikacji zaczyna się od zmiany w tym dokumencie (zasada „dokumentacja przed kodem”, [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) § 1).
- Tekstów interfejsu nie tłumaczymy na inne języki w M0–M6; struktura kluczy jest jednak przygotowana na dodanie kolejnego języka bez zmian w komponentach.
