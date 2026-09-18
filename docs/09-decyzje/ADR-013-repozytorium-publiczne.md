# ADR-013: Publiczne repozytorium GitHub — higiena, CI i skanowanie

- **Status:** zaakceptowana (licencja projektu — decyzja otwarta, Q-03)
- **Data:** 2026-09-18
- **Decydent:** właściciel projektu (repozytorium publiczne — Krok 2)
- **Powiązane wymagania:** NFR-03.09, NFR-03.12, NFR-10.03, Z-23

## Kontekst

Właściciel wybrał publiczne repozytorium (m.in. darmowe minuty GitHub Actions). Publiczność repozytorium ujawnia architekturę, zależności i dokumentację bezpieczeństwa; zwiększa też skutki przypadkowego commitu sekretu, danych infrastruktury lub rzeczywistych danych finansowych (np. w fixtures importu). Jednocześnie daje bezpłatne narzędzia: GitHub Actions na standardowych runnerach (bez limitu dla repozytoriów publicznych — dokumentacja rozliczeń GitHub, 2026-09-18), CodeQL, skanowanie sekretów z push protection, alerty Dependabot, prywatne zgłaszanie podatności.

## Decyzja

1. **Bezpieczeństwo nie opiera się na ukryciu** — dokumentacja bezpieczeństwa może być publiczna, bo sama nie osłabia kontroli.
2. **Zakazane w repozytorium:** sekrety i klucze (także testowe produkcyjne), adresy IP, wewnętrzne nazwy hostów, numery portów usług domowych, konfiguracje WireGuard/SSH, rzeczywiste wyciągi brokerskie i dane osobowe. Dopuszczalne: nazwa domeny publicznej, ogólna topologia (VPS + dom + VM).
3. **Fixtures importu** tworzone z plików właściciela wyłącznie po anonimizacji (skrypt anonimizujący w repo; losowe kwoty, przesunięte daty, fikcyjne numery rachunków) i przeglądzie przed commitem.
4. **Włączone mechanizmy GitHub:** secret scanning + push protection, CodeQL (JS/TS, Python), alerty Dependabot, Renovate do aktualizacji, prywatne zgłaszanie podatności (`SECURITY.md`), ochrona gałęzi `main` (wymagane zielone CI, zakaz force-push), podpisane commity zalecane.
5. **Issues i dyskusje** nie mogą zawierać szczegółów incydentów bezpieczeństwa — te trafiają do prywatnych security advisories.
6. **Obrazy kontenerów** w GHCR (publiczne, bez sekretów w warstwach) podpisywane cosign; alternatywnie budowa lokalna na serwerze.
7. **Licencja projektu — otwarte (Q-03).** Do czasu decyzji repozytorium nie ma pliku `LICENSE`, co oznacza „wszelkie prawa zastrzeżone” (decyzja odwracalna — nadanie licencji otwartej później jest możliwe, cofnięcie już udzielonej nie). Skille i kod zewnętrzny zachowują swoje licencje (`.claude/skills/THIRD_PARTY_NOTICES.md`). Uwaga: vectorbt (Commons Clause) nie ogranicza publikacji kodu, tylko sprzedaż.

## Konsekwencje

- Pozytywne: darmowe CI i narzędzia bezpieczeństwa; przejrzystość.
- Negatywne: dyscyplina przy każdym commicie (skanowanie pomaga, ale nie zastępuje przeglądu); rekonesans architektury dla potencjalnego atakującego — akceptowane.
- Zadania: `SECURITY.md`, ochrona gałęzi i ustawienia bezpieczeństwa repo (M0), skrypt anonimizacji fixtures (M1), reguła CI blokująca pliki `.xlsx/.csv` spoza `**/fixtures/anonymized/**` (M0).

## Weryfikacja

Push testowego fałszywego klucza zostaje zablokowany przez push protection; CodeQL i osv-scanner działają w CI; przegląd historii repo przed upublicznieniem (`git log -p` + skaner sekretów) nie znajduje sekretów.
