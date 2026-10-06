# M1-2 — stan bieżący

**Cel:** przekazać stan paczki danych rynkowych i SSE oraz decyzje potrzebne przed implementacją.

**2026-10-06**, gałąź `feat/m1-2-market`, baza `main` / `origin/main`: `101e952`. Zakres: BL-125 i BL-131–139. Stan: przegląd wstępny, implementacja zatrzymana zgodnie z [AGENTS.md](../../AGENTS.md) § 2.5 i § 6.1. Żadne zadanie paczki nie jest ukończone; statusy `todo` pozostają prawdziwe.

## Zrobione

Potwierdzono czysty checkout, pobrano aktualny `origin/main` i utworzono wskazaną gałąź. Przeczytano raport M1-1, reguły pracy, DoD, wiersze backlogu, kryteria M1, źródła danych, cache, SSE, licencje danych oraz odpowiednie fragmenty OpenAPI i ADR-005/014. BL-006/013 mają status `w toku`, lecz istniejące implementacje i raport M0-1 pozwalają traktować je jako zależności wykonane lokalnie zgodnie z AGENTS.md § 6.1. BL-121 pozostaje niewykonane.

## Rozbieżności i konkretne propozycje — do decyzji właściciela

1. **Kolejność UI.** [Backlog](backlog.md) wymaga BL-121 przed BL-137, następnie BL-137 przed BL-138. [Paczki sesji](prompty-codex.md) umieszczają BL-137/138 w M1-2, a BL-121 dopiero w M1-4. W `apps/web/src` nie ma jeszcze powłoki `(app)`, klienta SSE ani TanStack Query. Propozycja: przenieść BL-121 do M1-2 i wykonać przed BL-137, aktualizując podział paczek. Alternatywa: w M1-2 wykonać backend tych zadań, a kartę i wykres UI ukończyć w M1-4; BL-137/138 do tego czasu nie mogą mieć statusu `gotowe`.
2. **Ceny w kontrakcie wykresu.** Polecenie sesji wymaga Decimal/ciągów dla kwot i kursów. Tymczasem [konwencje API](../02-api/konwencje-api.md) § 3 jawnie dopuszczają liczby JSON w seriach prezentacyjnych, a `OhlcvSeries` w [OpenAPI](../02-api/openapi.yaml) używa `NumberSeries` dla `o/h/l/c/v`. Propozycja: dodać `DecimalSeries` (element `DecimalString` albo `null`) i użyć dla `o/h/l/c/v`, poprawić przykład, zawęzić wyjątek w konwencjach, zaktualizować changelog API i wygenerowany klient. `NumberSeries` dla wskaźników pozostaje bez zmian. Konwersję do liczb potrzebnych canvasowi ograniczyć do wrappera wykresu, po obliczeniach Decimal. Wymaga potwierdzenia zakresu wyjątku prezentacyjnego; nie zmieniono kontraktu ani ADR.

## Weryfikacja i dalszy krok

Zmiana obejmuje wyłącznie ten raport. Przed commitem: kontrole dokumentacji, repozytorium i białych znaków; wyniki w opisie roboczego PR. CI sprawdzane jeden raz na koniec sesji, bez oczekiwania i odpytywania w pętli. Nie uruchamiano testów aplikacji dla samego raportu.

Pominięte: kod, adaptery, migracje, nowe zależności i testy funkcji do rozstrzygnięcia powyższych punktów. Estymacje bez zmian, nakład niezmierzony. Bez nowych ADR, usług, kosztów i zmian statusu prawnego. Rozbieżności opisano tutaj; nie dodano spekulacyjnych ryzyk. Bramy M1 A/B pozostają otwarte; brak dowodów realizacji M1-2. Po decyzji: dokumentacja → testy bez sieci → kod, commity i push po etapach, weryfikacja tylko zmienionych obszarów.
