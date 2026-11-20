# BL-110b — stan części aplikacyjnej

**Cel:** przekazać wynik wdrożenia i pozostałe zależności NFR-03.10.

Monitor BL-110 zapisuje wynik step-upu i wysyła e-mail po pięciu błędnych kodach w ciągu 15 minut. API i jobs rejestrują naruszenie RLS po wycofaniu transakcji. Zgodnie z decyzją właściciela e-maile SEV1 oraz informacje o zmianach administracyjnych otrzymują wszyscy aktywni administratorzy. CLI obsługuje zmianę flagi i reset 2FA. Treści PL/EN zawierają wyłącznie fakty o zdarzeniu.

Lokalnie przeszły testy granic, współbieżności, regresji BL-110, integracja PostgreSQL 18/RLS i jobs z Valkey/Mailpit. Porównanie schematu nie wykazało różnic. Projekt nie wymaga migracji, nowych bibliotek ani nowej operacji API.

BL-151 pozostaje zależnością dla korelacji wielu kont z jednego adresu, alertu administratora oraz blokad CrowdSec, w tym po skanowaniu API. Podłączenie zmian ról i limitów czeka na ich operacje administracyjne. Brama B pozostaje otwarta. Estymata 1,5 dnia bez zmian, nakład niezmierzony. Bez nowego ADR. Ryzyko przerwy między zapisem audytu a zleceniem e-maila opisuje SEC § 5.3.
