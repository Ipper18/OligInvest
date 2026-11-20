# BL-308 — średnia ważona w widoku portfela

**Cel:** potwierdzić przeliczenie po zmianie metody kosztu i izolację podatkowego FIFO (FR-03.05).

Przełącznik i preferencję dostarczył BL-211. Kolejny odczyt widoku ekonomicznego korzysta z `buildAverageCostView` z `packages/core`. BL-308 sprawdza istniejącą ścieżkę odczytu. Po uzgodnieniu z właścicielem opis `listLots` w OpenAPI brzmi „Partie FIFO z historią zużycia”. Generator przeniósł go do komentarza w typach klienta.

| Etap wektora po zakupach 1,5 × 10 PLN i 0,5 × 30 PLN oraz sprzedaży 0,5 × 40 PLN | Koszt pozostałej pozycji | Zrealizowany wynik |
| --- | ---: | ---: |
| FIFO | 25,00 PLN | 15,00 PLN |
| Średnia ważona | 22,50 PLN | 12,50 PLN |
| Powrót do FIFO | 25,00 PLN | 15,00 PLN |

Test PostgreSQL porównuje kwoty i waluty z odpowiedzi API przy każdym ustawieniu. Sprawdza także koszt podatkowy 25 PLN, zrealizowany wynik podatkowy 15 PLN, koszt zużytej partii FIFO 5 PLN i izolację odczytów drugiego użytkownika przez RLS. Test ujawnił HTTP 422 przy odczycie zapisanych partii. Przyczyną była skala kolumny `split_factor` (12 miejsc) i granica 10 miejsc w `DecimalString`. API formatuje współczynnik w Decimal przy serializacji.

Lokalnie przeszły testy wektora A i projekcji portfela (5 + 10), porównanie OpenAPI (109 operacji zaimplementowanych, 78 oczekujących) i test przełącznika w Chromium, Firefox i WebKit (3/3). Wynik pełnej weryfikacji PostgreSQL i kontroli CI jest w PR.

Kod aplikacji zmienił się wyłącznie po stronie serwera. Estymata 1 dzień, odchylenie niezmierzone. M3 pozostaje otwarty. Zadanie czeka na przegląd właściciela. Brak nowych ryzyk i decyzji do ADR.
