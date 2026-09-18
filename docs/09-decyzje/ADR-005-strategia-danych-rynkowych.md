# ADR-005: Strategia danych rynkowych — archiwum GPW (EOD), Yahoo (intraday best effort), NBP (FX), bez płatnych źródeł

- **Status:** zaakceptowana
- **Data:** 2026-09-18
- **Decydent:** właściciel projektu
- **Powiązane wymagania:** FR-01.02–FR-01.04, FR-01.14, FR-01.15, FR-02.03, NFR-02.04, NFR-05.02, NFR-07.04, NFR-09.02

## Kontekst

Specyfikacja zakłada „analizę rynku w czasie rzeczywistym” i wymienia Stooq jako źródło dla GPW. Research ([`../03-dane/zrodla-danych.md`](../03-dane/zrodla-danych.md)) wykazał:
- darmowe oficjalne API (Finnhub, Twelve Data, Massive/Polygon, FMP, Tiingo, EODHD) nie obejmują GPW w planach darmowych;
- Stooq zabrania automatów (`robots.txt`: `Disallow: /` dla wszystkich poza Googlebot/Bingbot) i stosuje wyzwanie JS;
- oficjalne archiwum GPW udostępnia jednym żądaniem plik XLS z notowaniami całego rynku akcji za dany dzień; `robots.txt` GPW nie zabrania tej ścieżki, a klient z identyfikującym `User-Agent` otrzymuje plik (HTTP 200);
- Yahoo Finance (nieoficjalne) zwraca notowania GPW (`PKO.WA`, `WIG20.WA`) i USA, ale jest przeznaczone „do użytku osobistego” i bywa blokowane;
- NBP udostępnia kursy (tabela A) bez klucza, maks. 93 dni na zapytanie.

## Rozważane opcje

| Opcja | Zalety | Wady | Koszt |
|---|---|---|---|
| **A. Archiwum GPW (EOD) + Yahoo (intraday) + NBP/Frankfurter (FX) + darmowe API USA jako zapas** | 0 zł; cały rynek GPW dziennie; intraday dla GPW i USA | Yahoo nieoficjalne; brak licencji na redystrybucję | 0 zł |
| B. Płatne EODHD „All World” | Oficjalne API, GPW + USA, stabilność | Koszt | 19,99 USD/mies. |
| C. Automatyczny Stooq | Długa historia GPW | Zabronione przez `robots.txt` i wyzwanie JS — odrzucone | — |
| D. Tylko EOD (bez intraday) | Najprostsze, najstabilniejsze | Sprzeczne z decyzją Kroku 0 (opóźnione ~15 min w MVP) | 0 zł |

## Decyzja

Wariant **A**, z zasadami:

1. **Historia EOD jest trwała w naszej bazie** (`market_bars`) — dostawcy uzupełniają luki; raz pobrane dane nie są pobierane ponownie (poza oknem korekt 5 sesji).
2. **GPW EOD:** archiwum GPW, 1 żądanie na dzień sesyjny ok. 18:30, klient identyfikuje się uczciwie (`User-Agent: OligInvest/<wersja> (+kontakt)`), **żadnego obchodzenia blokad** — jeśli GPW zacznie odrzucać automat, przechodzimy na import ręczny pliku przez admina (FR-08.09) i rozważamy wariant B. Parser XLS (SheetJS CE) z testem kontraktowym na zapisanej próbce.
3. **Intraday (opóźnione):** Yahoo przez `yahoo-finance2` jako *best effort* dla GPW i USA; dla USA zapasowo Finnhub (60/min) i Twelve Data (800/dobę); brak zapasu dla GPW → degradacja do trybu „tylko EOD” z komunikatem.
4. **FX:** NBP tabela A (primary; także kurs D-1 do widoku podatkowego), Frankfurter/ECB jako zapas oznaczany w UI.
5. **Stooq:** wyłącznie ręczny import CSV pobranego przez użytkownika w przeglądarce.
6. **Każda wartość niesie metadane** `source`, `asOf`, `delayMinutes`, `stale`; UI zawsze je pokazuje (FR-01.15).
7. **Kwoty jako zasób planowany:** token bucket per dostawca, harmonogram dobowy, rezerwy (szczegóły w [`../03-dane/strategia-cache.md`](../03-dane/strategia-cache.md)).
8. **Licencje:** dane tylko dla zalogowanych użytkowników (brak publicznych stron i API z danymi — NFR-07.04); atrybucje źródeł w UI (NFR-07.03).

## Konsekwencje

- Pozytywne: 0 zł; pełny rynek GPW do screenera i heatmapy; odporność na awarię intraday (EOD pozostaje).
- Negatywne: zależność od nieoficjalnego Yahoo (ryzyko w rejestrze ryzyk); brak gwarancji dalszej dostępności archiwum GPW dla klientów automatycznych; odpowiedzialność za jakość danych po naszej stronie (kontrola jakości, korekty splitów).
- Koszt alternatywy (wariant B) i to, co tracimy bez niej — w `10-ograniczenia.md`.
- Zadania: adaptery `gpw`, `yahoo`, `nbp`, `frankfurter` (M1–M2), `finnhub`, `twelvedata`, `alphavantage`, `fred`, `gdelt`, `marketaux` (M2–M5), testy kontraktowe z zapisanymi odpowiedziami (fixtures bez danych objętych licencją poza minimalną próbką testową).

## Weryfikacja

Przez 20 kolejnych dni sesyjnych po M2: ≥ 95 % dni z kompletem danych EOD GPW pobranych automatycznie; każda awaria dostawcy intraday skutkuje flagą `stale` zamiast błędu (test chaos).
