# Samouczki i warstwa edukacyjna — treści

**Cel:** określić treść interaktywnego onboardingu i samouczków OligInvest — kroki, teksty, ćwiczenia na danych demo i to, czego z wyników nie wolno wnioskować — tak, aby aplikacja uczyła czytania liczb i myślenia o ryzyku, a nie podpowiadała transakcji (FR-06.01–FR-06.06, NFR-06.03).

Powiązane: [`instrukcja.md`](instrukcja.md), [`../00-przeglad/slownik-pojec.md`](../00-przeglad/slownik-pojec.md) (źródło haseł glosariusza), [`../03-dane/obliczenia-finansowe.md`](../03-dane/obliczenia-finansowe.md) (definicje), [`../11-zgodnosc-prawna.md`](../11-zgodnosc-prawna.md) § 4 (zakazy języka, disclaimer `education`), [`../04-frontend/dostepnosc.md`](../04-frontend/dostepnosc.md) (onboarding dostępny z klawiatury).

## 1. Zasady treści

- **Prosty język:** zdania do ok. 20 słów; każde pojęcie specjalistyczne ma link do glosariusza; liczby w formacie pl-PL.
- **Uczymy czytać, nie decydować:** zamiast „kiedy kupić” — „co mierzy wskaźnik, jak go czytać, jakie są pułapki”. Zakazy z [`../11-zgodnosc-prawna.md`](../11-zgodnosc-prawna.md) § 4.1 obowiązują także w lekcjach; każda lekcja ma disclaimer `education`.
- **Ćwiczenia wyłącznie na trybie demo** (fikcyjny portfel na danych historycznych, FR-06.04) albo na własnych danych w trybie tylko do odczytu.
- **Struktura lekcji:** cel → treść (3–6 krótkich akapitów lub kroków) → ćwiczenie → podsumowanie → „czego nie wnioskować”.
- Treści są plikami MDX w module `education`; klucze wyjaśnień (`<Explainer/>`) mają test pokrycia (FR-06.02).

## 2. Onboarding przy pierwszym logowaniu (FR-06.01)

Przewodnik driver.js ładowany leniwie; „Pomiń” zawsze widoczne, `Esc` kończy; stan ukończenia zapisany per użytkownik; do powtórzenia w **Nauka → Onboarding**.

| Krok | Element | Tekst |
|---|---|---|
| 1 | nagłówek | Witaj w OligInvest. Pokażemy w minutę, gdzie co jest. Możesz pominąć przewodnik i wrócić do niego w zakładce Nauka. |
| 2 | Portfel → Rachunki | Zacznij od rachunku — takiego samego jak u brokera, np. „XTB — zwykły” albo „XTB — IKE”. |
| 3 | Portfel → Import | Zaimportuj historię z XTB albo mBank. Najpierw zobaczysz podgląd i uzgodnienie z saldem brokera — nic nie zapisze się bez Twojego potwierdzenia. |
| 4 | Nauka → Demo | Nie masz jeszcze danych? Tryb demo pokazuje fikcyjny portfel, na którym możesz wszystko sprawdzić. |
| 5 | kafelek „Wartość portfela” | Wartość w złotych, z czasem i źródłem danych. „Opóźnione ~15 min” oznacza, że notowania nie są bieżące. |
| 6 | kafelek „Wynik dnia” | Zmiana od wczorajszego zamknięcia, bez dzisiejszych wpłat i wypłat. |
| 7 | ikona „?” | Przy każdej liczbie znajdziesz wyjaśnienie: co mierzy, jak ją czytać i na co uważać. |
| 8 | stopka | OligInvest pomaga analizować i uczyć się — nie doradza. Decyzje podejmujesz samodzielnie. |

Po pierwszym imporcie (zdarzenie `portfolio.import.parsed`) aplikacja jednorazowo proponuje samouczek S1.

## 3. Samouczki tematyczne

### S1. Pierwszy import i uzgodnienie z brokerem

- **Cel:** zaimportować historię i upewnić się, że liczby zgadzają się z brokerem.
- **Kroki:** eksport z xStation (Historia konta → Eksport) → Portfel → Import → wiersze „do przypisania” → uzgodnienie → zatwierdzenie.
- **Ćwiczenie:** w trybie demo zaimportuj plik przykładowy i znajdź wiersz „nieobsługiwany” (CFD). Sprawdź, dlaczego saldo gotówki nadal się zgadza.
- **Podsumowanie:** różnica 0,00 w uzgodnieniu oznacza zgodność z wyciągiem; każdy wiersz ma status — nic nie ginie po cichu.
- **Czego nie wnioskować:** zgodność z wyciągiem nie oznacza zgodności z zeznaniem podatkowym — widok podatkowy jest informacyjny.

### S2. Zysk, strata i koszt FIFO

- **Cel:** odróżnić wynik zrealizowany od niezrealizowanego i zrozumieć FIFO.
- **Treść:** zakupy tworzą partie; sprzedaż zużywa najpierw najstarsze partie (FIFO — wymóg przepisów podatkowych dla papierów wartościowych); koszt obejmuje prowizję i — w widoku ekonomicznym — koszt przewalutowania.
- **Ćwiczenie:** w demo sprzedaj część pozycji kupionej dwa razy po różnych cenach i porównaj koszt FIFO z kosztem średnim (**Portfel → Partie**).
- **Czego nie wnioskować:** strata niezrealizowana nie jest „stratą na papierze, która się nie liczy” — to bieżąca wartość; decyzja o sprzedaży nie powinna zależeć od tego, czy strata jest zrealizowana.

### S3. Waluty w portfelu

- **Cel:** zobaczyć, ile wyniku zrobił kurs dolara, a ile cena akcji.
- **Treść:** wynik pozycji zagranicznej w PLN = efekt ceny + efekt kursu (FR-02.06); widok ekonomiczny (kursy brokera) a podatkowy (kurs NBP z dnia przed rozliczeniem).
- **Ćwiczenie:** w demo porównaj wynik pozycji w USD w walucie i w PLN.
- **Czego nie wnioskować:** przeszły efekt kursowy nie mówi nic o przyszłym kierunku kursu.

### S4. Stopa zwrotu: TWR a XIRR (od M3)

- **Cel:** zrozumieć, dlaczego dwie „stopy zwrotu” różnią się przy wpłatach i wypłatach.
- **Treść:** TWR mierzy wynik strategii niezależnie od momentu wpłat (do porównań z indeksem); XIRR — wynik Twoich pieniędzy z uwzględnieniem terminów wpłat.
- **Ćwiczenie:** w demo dodaj dużą wpłatę tuż przed spadkiem i porównaj obie miary.
- **Czego nie wnioskować:** wyższy wynik od benchmarku w krótkim okresie nie dowodzi umiejętności — sprawdź długość okresu i ryzyko.

### S5. Ryzyko: zmienność i obsunięcie (od M3)

- **Cel:** czytać wykres „underwater” i maksymalne obsunięcie.
- **Treść:** obsunięcie to spadek od szczytu; ważne są głębokość i czas odrabiania; zmienność mierzy rozrzut zwrotów.
- **Ćwiczenie:** w demo znajdź największe obsunięcie i czas powrotu do szczytu.
- **Czego nie wnioskować:** historyczne obsunięcie nie jest najgorszym możliwym scenariuszem.

### S6. Wykres świecowy i wskaźniki techniczne (od M2)

- **Cel:** odczytać świecę i wiedzieć, co mierzy każdy wskaźnik.
- **Treść:** świeca = otwarcie, maksimum, minimum, zamknięcie; SMA/EMA wygładzają cenę; RSI mierzy tempo zmian w skali 0–100; wstęgi Bollingera — rozrzut ceny wokół średniej; ATR — typowy zakres dziennych ruchów.
- **Ćwiczenie:** w demo włącz RSI i znajdź okresy, w których był powyżej 70, a cena dalej rosła.
- **Czego nie wnioskować:** progi „wykupienia” i „wyprzedania” nie są sygnałami — wskaźnik opisuje przeszłe ceny, a jego skuteczność w przewidywaniu nie jest gwarantowana.

### S7. Dywersyfikacja i alokacja (od M2)

- **Cel:** zobaczyć koncentrację portfela według klasy aktywów, sektora, kraju i waluty.
- **Ćwiczenie:** w demo sprawdź udział największej pozycji i walut; porównaj z alokacją docelową, którą sam ustawisz.
- **Czego nie wnioskować:** nie ma jednej „właściwej” alokacji — zależy od Twoich celów, horyzontu i tolerancji ryzyka.

### S8. Koszty i podatki w Polsce

- **Cel:** zrozumieć wpływ prowizji, przewalutowania i podatku od zysków kapitałowych (19 %) na wynik.
- **Treść:** koszty obniżają wynik niezależnie od rynku; podatek płaci się od dochodu zrealizowanego na rachunkach zwykłych; IKE i IKZE mają inne zasady.
- **Ćwiczenie:** w demo porównaj wynik ekonomiczny i podatkowy tej samej sprzedaży.
- **Czego nie wnioskować:** widok podatkowy nie jest rozliczeniem — w razie wątpliwości skonsultuj się z doradcą podatkowym.

### S9. Jak czytać symulację Monte Carlo (od M3)

- **Cel:** czytać wachlarz scenariuszy zamiast jednej liczby (FR-06.06).
- **Treść:** każda ścieżka to jeden możliwy przebieg przy założeniach z bloku założeń; percentyl 5 % oznacza, że w 5 % scenariuszy wynik był niższy; mediana — połowa scenariuszy poniżej; tabela wrażliwości pokazuje, jak wynik zmienia się przy innych założeniach.
- **Ćwiczenie:** w demo uruchom symulację dwa razy z innym oknem historii i porównaj lewy ogon.
- **Czego nie wnioskować:** przedział nie jest obietnicą; historia nie musi się powtórzyć; model upraszcza rzeczywistość.

### S10. Pułapki behawioralne i dziennik decyzji (od M3)

- **Cel:** oddzielić jakość decyzji od wyniku.
- **Treść:** efekt dyspozycji (zbyt szybka sprzedaż zysków), nadmierna pewność siebie, zakotwiczenie na cenie zakupu, zbyt częsty handel; dziennik z tezą i postmortem pomaga je zauważyć.
- **Ćwiczenie:** zapisz tezę dla pozycji w demo, a po jej zamknięciu — postmortem oceniający proces niezależnie od wyniku.
- **Czego nie wnioskować:** statystyki z mniej niż 20 transakcji są oznaczone jako „mało danych” — łatwo o przypadek.

## 4. Glosariusz (FR-06.03)

- Źródło haseł: [`../00-przeglad/slownik-pojec.md`](../00-przeglad/slownik-pojec.md), przepisane prostym językiem; każde hasło ma definicję (1–3 zdania), przykład, powiązane hasła i link do miejsca w aplikacji.
- Wyszukiwanie po fragmencie i synonimie (np. „drawdown” → „obsunięcie”); co najmniej 30 haseł w M2 i 60 na koniec M5a.
- Hasła o pojęciach z obszaru zakazów (np. „sygnał transakcyjny”, „rekomendacja inwestycyjna”) objaśniają pojęcie i wyjaśniają, dlaczego aplikacja go nie stosuje — są wyjątkiem w teście języka ([`../11-zgodnosc-prawna.md`](../11-zgodnosc-prawna.md) § 4.1).

## 5. Tryb demo (FR-06.04)

- Fikcyjny portfel „Demo” na rachunku typu `demo`: kilka spółek z GPW i USA, ETF, gotówka w PLN i USD, dywidenda, sprzedaż częściowa — historia z danych rynkowych, bez danych żadnej osoby.
- Operacje w demo nie wpływają na dane realne (test izolacji); stały baner z tekstem disclaimera `demo`.
- Demo można zresetować w **Nauka → Demo**.
