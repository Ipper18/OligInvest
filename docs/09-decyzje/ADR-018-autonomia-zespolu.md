# ADR-018: Autonomia zespołu OligInvest

**Cel:** określić, kto może rozpocząć paczkę, ocenić PR i zdecydować o scaleniu.

- **Status:** proponowana do przyjęcia przez scalenie przez właściciela
- **Data:** 2026-11-21
- **Decydent:** właściciel projektu
- **Powiązane ryzyka:** R-11, R-23, R-42

## Kontekst

W pilotażu właściciel osobno potwierdzał start paczki i przeglądał PR. Role mogą korzystać z tej samej tożsamości GitHub. Sam podpis komentarza ani liczba zatwierdzeń nie dowodzą niezależnego przeglądu.

## Rozważane opcje

Osobna zgoda na każdy BL pozwala ręcznie ustalać kolejność, lecz zatrzymuje gotowe prace. Delegowanie wyboru Dyspozytorowi pozwala prowadzić kolejkę według zależności. Natychmiastowe włączenie auto-merge pozostawiłoby możliwość scalenia na podstawie samego CI.

## Decyzja

Dyspozytor sam wybiera gotowe BL w zatwierdzonym zakresie i prowadzi jeden aktywny PR implementacyjny. Budowniczy implementuje i testuje. Recenzent korzysta z innego dostawcy niż autor. Weryfikator sprawdza bezpieczeństwo, obliczenia i zgodność w zakresie PR. Obie oceny odnoszą się do aktualnego SHA. Po dwóch nieskutecznych rundach poprawek Dyspozytor przekazuje STOP właścicielowi. Kolejny BL może rozpocząć po potwierdzeniu stanu MERGED w GitHubie.

Dzisiaj każdy PR przegląda i scala właściciel. Auto-merge pozostaje wyłączone. W przyszłości właściciel może osobno dopuścić automatyczne scalanie wyłącznie PR niskiego ryzyka po wdrożeniu i przetestowaniu niezależnej bramki jakości. Autor PR nie może wystawić ani zmienić jej wyniku. Bramka musi wiązać klasyfikację ryzyka, wymagane zielone CI i niezależne werdykty z tym samym aktualnym SHA. Nowy commit unieważnia poprzednie wyniki. Brak dowodu blokuje scalenie.

Zmiany ADR, zakresu biznesowego, zabezpieczeń, sekretów, workflow, serwerów, ustawień GitHub i ochrony main wymagają decyzji właściciela i pozostają poza przyszłą ścieżką niskiego ryzyka.

## Konsekwencje

Ta decyzja zastępuje zasady startu i WIP z pilotażu. Dotychczasowe ADR dotyczą innych decyzji. Nadal obowiązują zabezpieczenia [ADR-013](ADR-013-repozytorium-publiczne.md), wymagany PR i ruleset bez obejść. Zespół kończy pracę na gotowym PR. Zasady przekazania i wznowienia opisuje [przepływ paczki](../08-plan/orkiestracja-agentow.md).

## Weryfikacja

Dla paczki sprawdź unikalną kartę, jeden aktywny PR, dostawców autora i Recenzenta, SHA obu ocen i liczbę rund. Przed ewentualną aktywacją przyszłej bramki właściciel sprawdzi przypadek dopuszczony oraz odmowy dla starego SHA, braku niezależnej oceny, czerwonego CI i zmiany krytycznej. Dowody i decyzję o aktywacji zapisze osobno.
