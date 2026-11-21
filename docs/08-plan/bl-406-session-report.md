# BL-406 i BL-563 — alerty i cele alokacji

**Cel:** udostępnić reguły cenowe i portfelowe, podgląd komunikatu oraz historię doręczeń w UI PL/EN.

Cztery operacje celów używają kontekstu użytkownika i RLS. Wagi i tolerancja są ciągami dziesiętnymi. API wymaga sumy dokładnie 1. Alert odchylenia wskazuje cel przez identyfikator. Zmiana lub usunięcie celu wyłącza regułę w transakcji i zapisuje przyczynę dla UI. BL-315 obejmuje dalsze prace nad kalkulatorem.

Test bazy na PostgreSQL 18 przeszedł razem z RLS, izolacją celów, zmianą i usunięciem celu oraz porównaniem migracji ze schematem (zero różnic). Kontrola OpenAPI: 113 wdrożonych operacji i 74 oczekujące. Testy progów, histerezy, deduplikacji, cooldownu i braku danych przeszły lokalnie.

## Kontynuacja PR #92

Po połączeniu z main (`9bddabb`) sprawdzono cztery trasy alertów na produkcyjnym buildzie web. Syntetyczna sesja pomiarowa otwiera listę, historię, kreator i szczegóły tej samej reguły, którą zwraca testowe API. Dla zewnętrznego BASE_URL identyfikatory i sesja pochodzą z konfiguracji pomiaru.

| Kontrola lokalna | Wynik |
|---|---|
| Lint, typy i testy zmienionych pakietów i ich zależnych | 75/75 zadań Turbo. W pierwszym przebiegu równoległym test gotowości API przekroczył limit 3500 ms (3620 ms). Cały zakres przeszedł przy jednym zadaniu Turbo naraz. |
| PostgreSQL 18, migracje i RLS | PASS. Końcowe porównanie schematów bez różnic. Test wykonano po zbudowaniu zależności API. |
| Kontrakty | PASS. 25 testów OpenAPI, 113 operacji wdrożonych i 74 oczekujące. |
| Granice zależności, dokumentacja, repozytorium i teksty UI | PASS. |
| Budżety JS | Każda z czterech tras alertów zajmuje 157,82 z 190 KiB, powłoka 29,85 z 30 KiB. |

Wyniki E2E, CodeQL i pozostałych kontroli końcowego SHA publikuje [PR #92](https://github.com/Ipper18/OligInvest/pull/92). Estymaty BL-406 i BL-563 wynoszą odpowiednio 2 i 1,5 dnia, nakład pozostał niezmierzony. Zadania pozostają w toku do spełnienia DoD. M4 jest otwarty.

## Runda poprawek 1

Test integracyjny na PostgreSQL uruchamia zadanie wyceny dla dwóch użytkowników. Dwie pozycje tej samej klasy dają odchylenie 0,5 dla klasy oraz 0,8 dla pierwszego instrumentu. Test sprawdza pominięcie niepełnej wyceny, ponowne uzbrojenie reguły, brak drugiego zdarzenia w czasie cooldownu oraz wyzwolenie po jego upływie. Drugi użytkownik nie wyzwala ani nie odczytuje tych zdarzeń.

Kontrakt i klient uwzględniają konflikt nazwy (409) i niedostępny rachunek (404). Klasa celu może pochodzić z instrumentu albo z nadpisania użytkownika. Test porównuje listę z obiema definicjami i sprawdza maksymalną długość 11 znaków. Test HTTP obejmuje m.in. przyjęcie `fx` i `mixed` oraz odrzucenie nieznanej wartości.

Lokalnie przeszły 75/75 zadań Turbo, testy bazy z porównaniem schematów, 26 testów kontraktu, kontrola klienta API i dokumentacji.
