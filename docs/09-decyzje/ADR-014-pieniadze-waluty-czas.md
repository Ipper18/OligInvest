# ADR-014: Reprezentacja pieniędzy, walut i czasu

**Cel:** ustalić reprezentację pieniędzy, walut, kursów i czasu w kodzie, bazie i API tak, aby wyniki zgadzały się z wyciągami co do grosza.

- **Status:** zaakceptowana
- **Data:** 2026-09-18
- **Decydent:** właściciel projektu
- **Powiązane wymagania:** FR-01.14, FR-02.02, FR-02.06, FR-02.07, FR-03.05, FR-03.06, NFR-08.01, NFR-08.02, Z-15, Z-16

## Kontekst

OligInvest liczy wartości w wielu walutach (PLN, USD, EUR), dla ułamkowych ilości (akcje ułamkowe oferowane przez niektórych brokerów), z prowizjami i kosztami przewalutowania. Wynik w PLN ma dwa sensowne znaczenia: **ekonomiczny** (ile faktycznie zarobiłem po kursach brokera) i **podatkowy** (przeliczenie po kursie średnim NBP z ostatniego dnia roboczego przed dniem przychodu/kosztu). Liczby muszą zgadzać się z wyciągiem brokera co do grosza (NFR-08.03). Arytmetyka zmiennoprzecinkowa (`float`) tego nie gwarantuje.

## Rozważane opcje

| Opcja | Zalety | Wady |
|---|---|---|
| **Decimal (decimal.js / `Decimal` / `NUMERIC`) + jawna waluta** | Dokładność dziesiętna, dowolna skala, funkcje potrzebne w XIRR (potęgi ułamkowe) | Wolniejsze niż `number` (nieistotne przy naszej skali) |
| Liczby całkowite w jednostkach minimalnych (grosze/centy) | Szybkie, proste | Różne skale walut i cen (ceny z 4+ miejscami, ilości ułamkowe) komplikują kod |
| `number` / `float64` | Najprostsze | Błędy zaokrągleń w sumach i przeliczeniach — niezgodność z brokerem |
| Dinero.js | Typ Money z walutą | Dodatkowa warstwa nad biblioteką dziesiętną; mniej elastyczny dla ilości i kursów |

## Decyzja

1. **Typy:** w TypeScript typy markowane `Money { amount: Decimal; currency: CurrencyCode }`, `Quantity` (Decimal), `Price` (Decimal + waluta), `FxRate { base; quote; rate: Decimal; date; source }`; w Pythonie `decimal.Decimal` na granicy wejścia/wyjścia (wewnątrz symulacji `float64` numpy jest dopuszczalny, bo wyniki są rozkładami, nie księgowością).
2. **Precyzja i zaokrąglenia:** `decimal.js` z precyzją 34 cyfr znaczących i `ROUND_HALF_EVEN` w obliczeniach pośrednich; zaokrąglenie do jednostki waluty (PLN, USD, EUR: 2 miejsca) wyłącznie na granicy prezentacji i zapisu kwot rozliczeniowych, trybem `ROUND_HALF_UP`. Reguły zaokrągleń podatkowych opisuje `obliczenia-finansowe.md` (Krok 4).
3. **Baza danych:** kwoty i ceny `NUMERIC(20,8)`, ilości `NUMERIC(24,10)`, kursy walut `NUMERIC(18,8)`, waluta `CHAR(3)` (ISO 4217) obok każdej kwoty. Brak typu `money` PostgreSQL (zależny od locale).
4. **Kontrakty API:** kwoty jako **ciągi znaków** z liczbą dziesiętną (`"1234.56"`) + pole `currency` — nigdy JSON `number` dla pieniędzy.
5. **Waluty i kursy:**
   - *Widok ekonomiczny (domyślny):* przepływy w walucie rachunku po kursach faktycznie zastosowanych przez brokera (z eksportu); gdy eksport nie zawiera kursu — wyliczenie z kwot w obu walutach; ostatecznie kurs NBP z dnia transakcji, z oznaczeniem.
   - *Widok podatkowy:* przychody i koszty w walucie obcej przeliczane po kursie średnim NBP (tabela A) z ostatniego dnia roboczego poprzedzającego dzień przychodu/kosztu (kurs „D-1”) — metoda FIFO. Dzień przychodu i kosztu to dzień rozliczenia transakcji (przeniesienie własności); podstawa prawna i interpretacja: [`../11-zgodnosc-prawna.md`](../11-zgodnosc-prawna.md) § 5 (uzupełnienie z Kroku 6). Marża przewalutowania brokera nie wchodzi do kosztu podatkowego — widok pokazuje ją osobno; ustawienie użytkownika pozwala to zmienić (decyzja właściciela 2026-09-19).
   - *Wycena bieżąca pozycji zagranicznych:* ostatni dostępny kurs (NBP tabela A z dnia; w trakcie dnia przed publikacją — kurs z dnia poprzedniego, oznaczony).
6. **Czas:** znaczniki czasu jako `timestamptz` w UTC; daty sesyjne jako `date` w kalendarzu giełdy (XWAR — Europe/Warsaw, XNYS/XNAS — America/New_York); prezentacja w strefie użytkownika (domyślnie Europe/Warsaw). „Dzień” wyniku dnia i wycen dziennych to dzień kalendarzowy w strefie Europe/Warsaw; zamknięcie USA przypisujemy do daty sesji nowojorskiej.
7. **Identyfikatory:** UUIDv7 (`uuidv7()` w PostgreSQL 18) — sortowalne w czasie, bez ujawniania liczby rekordów.

## Konsekwencje

- Pozytywne: zgodność z wyciągami co do grosza; jawne rozróżnienie wyniku ekonomicznego i podatkowego; brak klas błędów zaokrągleń.
- Negatywne: więcej kodu typów i konwersji; konieczność utrzymania dwóch widoków P/L.
- Zadania: typy `Money` i konwersje w `packages/core` (M1), wektory testowe walutowe (M1), kolumny i ograniczenia w `schema.sql` (Krok 4).

## Weryfikacja

Test CI: żadna kolumna kwotowa w schemacie nie ma typu `double precision`/`real`; typy kontraktów API dla pól kwotowych są ciągami; wektory testowe walutowe (kupno USD na rachunku PLN, dywidenda z podatkiem u źródła, sprzedaż częściowa FIFO) dają wyniki zgodne co do 0,01 PLN.
