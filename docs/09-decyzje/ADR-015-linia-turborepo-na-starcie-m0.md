# ADR-015: Linia Turborepo na starcie M0

**Cel:** wybrać początkową wersję Turborepo dla M0 bez wyjątków od karencji i określić przejście na linię 2.11.

- **Status:** zaakceptowana
- **Data:** 2026-09-21
- **Decydent:** właściciel projektu
- **Powiązane wymagania:** NFR-02.01, NFR-03.09, NFR-10.05

## Kontekst

[ADR-002](ADR-002-monorepo.md) wybiera Turborepo i pnpm. Wersja Turborepo 2.11.0 i jej binaria nie spełniają jeszcze 4320 minut karencji podczas porannego startu M0. Właściciel zdecydował rozpocząć na opublikowanej 2026-09-14 wersji 2.10.13. Decyzja dotyczy wyłącznie linii Turborepo; nie zwalnia pozostałych pakietów z kontroli wieku.

## Rozważane opcje

| Opcja | Zalety | Wady | Koszt / licencja |
|---|---|---|---|
| Czekać na 2.11 | Od razu docelowa linia | Opóźnienie startu | 0 zł / MIT |
| Start 2.10.13, aktualizacja osobnym PR | Turborepo i wszystkie jego binaria spełniają karencję | Dodatkowy PR i ponowne testy | 0 zł / MIT |

## Decyzja

Startujemy na **Turborepo 2.10.13**; Renovate proponuje przejście na **linię 2.11 w osobnym PR po upływie karencji**, z przeglądem właściciela i bez automerge. ADR-002 pozostaje w mocy; niniejszy ADR doprecyzowuje tylko początkową wersję i kolejność aktualizacji. `minimumReleaseAge: 4320`, `trustPolicy: no-downgrade`, `strictDepBuilds`, `blockExoticSubdeps` i przegląd `allowBuilds` pozostają bez zmian i wyjątków.

## Konsekwencje

- Aktualizacja STACK, manifestu, inwentarza audytu, reguły Renovate i R-22 w BL-001.
- Przed instalacją należy nadal sprawdzić cały graf, również opcjonalne binaria; inne niespełnione karencje zatrzymują instalację. Ta decyzja nie upoważnia do zmiany innych przypięć.
- Aktualizacja 2.11 wymaga zielonych kontroli monorepo oraz buildów bez modułów funkcjonalnych; Renovate zadziała po aktywacji przez właściciela (BL-019).

## Weryfikacja

Odczyt [npm turbo](https://registry.npmjs.org/turbo) i sześciu pakietów `@turbo/*` z 2026-09-21 05:24:55 UTC: wszystkie wersje 2.10.13 opublikowano 2026-09-14, a ostatnia karencja upłynęła 2026-09-17 16:53:35.063 UTC. Dokładne daty i SHA-512: [inwentarz](../08-plan/audits/m0-1-release-age.json). Pozostałe blokady grafu: [raport sesji § 7](../08-plan/m0-1-session-report.md#7-adr-015-i-ponowna-kontrola-całego-inwentarza). Przegląd decyzji przy PR aktualizacji do 2.11; zgodność działania narzędzia potwierdzi dopiero instalacja i testy, nie sam wiek publikacji.
