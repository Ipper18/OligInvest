# Instrukcja użytkownika OligInvest

**Cel:** poprowadzić użytkownika od zaproszenia do codziennej pracy z aplikacją — rejestracja z weryfikacją dwuetapową, import z XTB i mBank, czytanie portfela i analiz, alerty, instalacja na telefonie, Skróty i bezpieczeństwo konta — prostym językiem, bez żargonu bez wyjaśnienia (FR-09.05, FR-09.06, NFR-06.03).

Powiązane: [`samouczki.md`](samouczki.md) (nauka krok po kroku), [`regulamin.md`](regulamin.md), [`informacja-o-prywatnosci.md`](informacja-o-prywatnosci.md), [`../05-mobile/ios-integracje.md`](../05-mobile/ios-integracje.md) i [`../05-mobile/android-integracje.md`](../05-mobile/android-integracje.md) (szczegóły techniczne Skrótów), [`../00-przeglad/slownik-pojec.md`](../00-przeglad/slownik-pojec.md).

> OligInvest pomaga analizować i uczyć się — nie doradza. Wyniki analiz to scenariusze przy jawnych założeniach, a nie prognozy. Decyzje inwestycyjne podejmujesz samodzielnie.

**Dostępność funkcji:** aplikacja powstaje etapami ([`../08-plan/roadmapa.md`](../08-plan/roadmapa.md)). Rozdziały 1–5 i 10–12 dotyczą wersji MVP; wskaźniki i mBank pojawiają się w M2, wyniki historyczne i symulacje w M3, alerty, instalacja i Skróty w M4, pozostałe analizy w M5. Instrukcję aktualizujemy z każdym etapem (BL-611).

## 1. Pierwsze kroki

1. **Zaproszenie.** Dostajesz e-mail z linkiem ważnym 72 godziny. Link działa raz.
2. **Rejestracja.** Podaj nazwę i hasło (co najmniej 12 znaków; najlepiej fraza z kilku słów — menedżer haseł bardzo pomaga). Zaakceptuj regulamin i potwierdź zapoznanie się z informacją o danych. Zgoda na anonimowe pomiary wydajności jest dobrowolna.
3. **Weryfikacja dwuetapowa (obowiązkowa).** Zeskanuj kod QR w aplikacji do kodów jednorazowych (np. wbudowane Hasła w iOS, Google Authenticator, 2FAS, Aegis) i wpisz 6-cyfrowy kod.
4. **Kody zapasowe.** Zapisz 10 kodów zapasowych (plik TXT albo menedżer haseł). Każdy działa raz — przydadzą się, gdy stracisz telefon.
5. **Rachunek.** Utwórz rachunek odpowiadający rachunkowi u brokera, np. „XTB — zwykły”, „XTB — IKE”. Rodzaj (zwykły, IKE, IKZE) wpływa na widok podatkowy.

## 2. Import z XTB

1. W xStation 5: **Historia konta → Eksport**. Dostaniesz plik ZIP z osobnym plikiem XLSX dla każdego rachunku i waluty (PLN, USD, EUR).
2. Rozpakuj ZIP. W OligInvest: **Portfel → Import**, wybierz rachunek docelowy i plik XLSX (na iPhonie z aplikacji Pliki).
3. **Podgląd.** Każdy wiersz ma status:
   - *nowy* — zostanie zapisany;
   - *duplikat* — już był zaimportowany (ponowny import tego samego pliku niczego nie podwaja);
   - *do przypisania* — nie rozpoznaliśmy instrumentu: wskaż go w wyszukiwarce, a wybór zostanie zapamiętany;
   - *nieobsługiwany* — np. CFD. Nie liczymy go w portfelu, ale jego wpływ na gotówkę zostaje, żeby saldo się zgadzało;
   - *błąd* — z opisem i numerem wiersza w pliku.
4. **Uzgodnienie.** Aplikacja porównuje saldo gotówki i liczbę sztuk z plikiem. Różnica 0,00 oznacza zgodność; inna wartość — sprawdź wiersze „do przypisania” i „błąd”.
5. **Zatwierdź.** Portfel przelicza się w kilka sekund.

Importuj regularnie, np. raz w miesiącu — cały plik historii, bez wycinania fragmentów. Pliki importu przechowujemy 90 dni.

## 3. Import z mBank eMakler i z innych źródeł

- **mBank:** bankowość internetowa → **Inwestycje → eMakler → Historia** → „Pobierz CSV” — pobierz **historię transakcji** i **historię finansową** i zaimportuj oba pliki na ten sam rachunek. mBank podaje nazwy papierów zamiast kodów ISIN, więc przy pierwszym imporcie część instrumentów przypiszesz ręcznie.
- **Inny broker lub arkusz:** przygotuj plik CSV w szablonie OligInvest (UTF-8, przecinek jako separator, kropka dziesiętna):

| Kolumna | Znaczenie | Przykład |
|---|---|---|
| `date` | data operacji (RRRR-MM-DD) | `2025-03-03` |
| `type` | rodzaj: `BUY`, `SELL`, `DIVIDEND`, `INTEREST`, `FEE`, `TAX`, `DEPOSIT`, `WITHDRAWAL`, `FX_CONVERSION`, `SPLIT` … | `BUY` |
| `isin`, `ticker`, `mic` | instrument (wystarczy ISIN albo ticker z giełdą) | `US0378331005`, `AAPL`, `XNAS` |
| `quantity`, `price`, `price_currency` | liczba sztuk, cena, waluta ceny | `10`, `240.00`, `USD` |
| `amount`, `amount_currency` | wpływ na gotówkę rachunku ze znakiem (minus = wydatek) | `-9599.76`, `PLN` |
| `fee`, `tax` (+ waluty) | prowizja, podatek (np. u źródła) | `0`, `2.14` |
| `fx_rate` | kurs przeliczenia ceny na walutę rachunku | `3.9999` |
| `external_id`, `note` | Twój identyfikator (chroni przed duplikatami), notatka | `ext-1` |

  Jeśli Twój plik ma inne nagłówki, w podglądzie importu przypisz kolumny ręcznie i zapisz **szablon mapowania** — przy kolejnym imporcie zostanie użyty automatycznie (od M5).
- **Ręcznie:** **Portfel → Operacje → +**. Formularz pokazuje tylko pola potrzebne dla wybranego rodzaju operacji.

## 4. Jak czytać portfel

- **Wartość portfela** — suma pozycji i gotówki w PLN; obok czas i źródło danych. Etykieta „opóźnione ~15 min” albo „zamknięcie z DD.MM” mówi, jak świeże są notowania.
- **Wynik dnia** — zmiana wartości od wczorajszego zamknięcia, bez wpłat i wypłat z dzisiaj.
- **Zysk/strata niezrealizowany** — dla pozycji, które nadal masz: wartość dziś minus koszt zakupu.
- **Zysk/strata zrealizowany** — z zamkniętych sprzedaży; koszt liczymy metodą FIFO (najpierw sprzedają się najstarsze zakupy), tak jak wymagają przepisy podatkowe.
- **Widok ekonomiczny** (domyślny) — po kursach, po których broker faktycznie przeliczył waluty, z jego kosztami przewalutowania.
- **Widok podatkowy** (informacyjny) — po kursach NBP z dnia roboczego poprzedzającego rozliczenie transakcji; może różnić się od PIT-8C i nie zastępuje zeznania.
- Zysk i strata mają zawsze znak (+/−) i strzałkę ▲▼, a nie tylko kolor. W Ustawieniach możesz wybrać paletę przyjazną dla daltonistów i tryb ciemny.
- Przy każdej metryce jest „?” z wyjaśnieniem (od M2).

## 5. Rynek i wykresy

- **Wyszukiwarka** — wpisz ticker, nazwę albo ISIN (np. „PKO”, „PKO BP”, „PLPKO0000016”).
- **Karta instrumentu** — kurs, zmiana, wolumen, zakres 52 tygodni, źródło i czas danych.
- **Wykres świecowy** — przesuwaj palcem, przybliżaj dwoma palcami; interwały dzień, tydzień, miesiąc. Pod wykresem jest tabela z tymi samymi danymi (także dla czytników ekranu).
- **Wskaźniki** (od M2) — SMA, EMA, wstęgi Bollingera, RSI, MACD, ATR. To opis przeszłych cen, nie sygnały kupna ani sprzedaży — przeczytaj wyjaśnienie przy każdym z nich.

## 6. Analizy (od M3)

- Każda analiza pokazuje **założenia** (dane, okres, model, koszty, podatki) i wynik jako **rozkład** — np. wachlarz wartości portfela z przedziałami 5–95 %.
- Najpierw widzisz **słabszy scenariusz** (lewy ogon), potem medianę („połowa scenariuszy poniżej”). To nie jest prognoza: rzeczywisty wynik może wypaść poza przedział.
- **Rebalancing** liczy transakcje potrzebne do osiągnięcia **Twojej** alokacji docelowej, z kosztami i szacowanym podatkiem. Nie działa, gdy dane nie są uzgodnione z brokerem — najpierw zaimportuj aktualny plik.
- Analizy ciężkie (np. symulacja Monte Carlo) są dostępne dla roli „pro” — o rolę poproś administratora.

## 7. Alerty i powiadomienia (od M4)

1. **Alerty → Nowy:** wybierz instrument, warunek (np. „kurs poniżej 50 zł” albo „zmiana dzienna ±5 %”), kanały i podejrzyj treść powiadomienia.
2. **Powiadomienia push** włączysz w **Ustawienia → Powiadomienia** (przycisk „Włącz” i „Wyślij test”). Na iPhonie działają tylko w aplikacji dodanej do ekranu początkowego (§ 8).
3. Alert przychodzi raz po przekroczeniu progu (potem odczekuje, żeby nie zasypywać). Gdy push nie działa, ważne alerty przychodzą e-mailem.
4. Powiadomienia nie zawierają kwot Twojego portfela — kwoty widzisz dopiero w aplikacji.

## 8. Aplikacja na telefonie i komputerze (od M4)

- **iPhone (Safari):** otwórz OligInvest → przycisk **Udostępnij** → **Do ekranu początkowego** → Dodaj. Zaloguj się w nowej ikonie (to osobne logowanie niż w Safari).
- **Android (Chrome):** menu ⋮ → **Zainstaluj aplikację**. Przytrzymanie ikony pokazuje skróty: Dodaj transakcję, Wynik dnia, Alerty, Szukaj.
- **Komputer:** Chrome lub Edge — ikona instalacji w pasku adresu; Safari na macOS — **Plik → Dodaj do Docka**.

## 9. Skróty iOS i szybkie akcje Android (od M4)

1. **Token:** **Ustawienia → Tokeny → Nowy token**, potwierdź kodem. Dla odczytu wybierz zakresy `portfolio:read`, `alerts:read`, `market:read`; dla „Dodaj transakcję” utwórz osobny token z `transactions:write`. Token widzisz tylko raz.
2. **iPhone:** w **Ustawienia → Integracje** otwórz link do gotowego skrótu („Pokaż mój portfel”, „Ile dziś zarobiłem”, „Dodaj transakcję”, „Moje alerty”), dodaj go w aplikacji Skróty i wklej token w pytaniu przy imporcie.
3. **Uruchamianie:** „Hej Siri, ile dziś zarobiłem”; **Ustawienia → Dostępność → Dotyk → Stuknięcie w tył**; Centrum sterowania i ekran blokady (iOS 18); Przycisk czynności (iPhone 15 Pro i nowsze); automatyzacja, np. codziennie o 17:15.
4. **Android:** zainstaluj darmową aplikację **HTTP Shortcuts** i zaimportuj konfigurację z **Ustawienia → Integracje**; token wklej do zmiennej oznaczonej jako sekret. Skrót „Wynik dnia” możesz przypiąć jako kafelek Szybkich ustawień albo widżet.
5. Pełna instrukcja budowy skrótów ręcznie i tabela komunikatów błędów: [`../05-mobile/ios-integracje.md`](../05-mobile/ios-integracje.md), [`../05-mobile/android-integracje.md`](../05-mobile/android-integracje.md).

## 10. Bezpieczeństwo konta

- **Sesje:** **Ustawienia → Bezpieczeństwo** pokazuje zalogowane urządzenia; możesz wylogować jedno albo wszystkie inne.
- **Nowe urządzenie:** po logowaniu z nowego urządzenia dostajesz e-mail. Jeśli to nie Ty — zmień hasło, wyloguj wszystkie urządzenia i napisz do administratora.
- **Zgubiony telefon:** zaloguj się kodem zapasowym, wygeneruj nowe kody, skonfiguruj TOTP na nowym telefonie i **odwołaj tokeny** Skrótów (wylogowanie nie odwołuje tokenów).
- **Utracone kody i telefon:** poproś administratora o reset weryfikacji dwuetapowej — potwierdzi Twoją tożsamość poza aplikacją.
- Nigdy nie podawaj kodów jednorazowych ani tokenów przez telefon czy e-mail — administrator nigdy o nie nie prosi.

## 11. Twoje dane

- **Eksport:** **Ustawienia → Dane → Eksportuj moje dane** (ZIP z JSON i CSV, 24 godziny na pobranie).
- **Usunięcie konta:** **Ustawienia → Dane → Usuń konto**; masz 14 dni na anulowanie.
- **Zgody:** **Ustawienia → Prywatność** — tu wycofasz zgodę na pomiary wydajności i zobaczysz historię zaakceptowanych dokumentów.
- Szczegóły: [`informacja-o-prywatnosci.md`](informacja-o-prywatnosci.md).

## 12. Rozwiązywanie problemów

| Objaw | Co zrobić |
|---|---|
| Kod z aplikacji nie działa | sprawdź automatyczną godzinę w telefonie; po 5 błędnych kodach logowanie blokuje się na 15 minut |
| Etykieta „nieaktualne” przy danych | dostawca danych chwilowo nie odpowiada — pokazujemy ostatnie znane wartości; nic nie musisz robić |
| Różnica w uzgodnieniu importu | sprawdź wiersze „do przypisania” i „błąd”; zaimportuj pełną historię konta, nie fragment |
| Brak powiadomień na iPhonie | aplikacja musi być dodana do ekranu początkowego, a powiadomienia włączone w niej (nie w Safari) |
| Link z e-maila otwiera Safari zamiast aplikacji | to ograniczenie iOS — otwórz aplikację z ekranu początkowego |
| Komunikat o nowej wersji regulaminu | przeczytaj streszczenie zmian i zaakceptuj; bez akceptacji możesz nadal wyeksportować dane lub usunąć konto |
| Coś innego | napisz do administratora; podaj godzinę i identyfikator żądania z komunikatu błędu (bez haseł i kodów) |
