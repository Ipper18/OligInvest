# M1-4b — stan bieżący

**Cel:** przekazać stan BL-147/148/157/158/154/155 i aplikacyjnej części BL-152 oraz warunki bramy A.

**2026-10-19**, `feat/m1-4b-mvp-screens`, [PR #14](https://github.com/Ipper18/OligInvest/pull/14).
Ekrany i odczyty REST są wdrożone; dawne propozycje kontraktów zostały zatwierdzone i zaimplementowane. Zadania pozostają `w toku` do zielonego CI i wspólnego DoD. Nakład/odchylenie niezmierzone; brama A otwarta.

## Zrobione

- Start, Pozycje, Operacje, Rachunki, Partie, wynik zrealizowany, import XTB/mBank, karta instrumentu i leniwy wykres; luki wycen jako `null`. Szczegóły paczki i odbioru: [raport bramy A](m1-4b-gate-a.md).
- Poprawka SSRF: cel proxy powstaje z `E2E_REAL_API`; kopiowane są tylko ścieżka i zapytanie, origin musi pozostać równy bazowemu. Odrzucane są schematy, `//` i niejednoznaczne separatory. Negatywne testy regresji.
- Licencje `trim-lines@3.0.1`, `tsx@4.23.13`, `unist-util-position-from-estree@2.0.0`: MIT potwierdzone w zainstalowanych `package.json`. Uzupełnienia npm tylko dla tych wersji i brakujących metadanych, bez wyjątków i nadpisywania jawnych licencji.
- E2E: ograniczona szerokość filtrów usuwa przepełnienie Operacji w WebKit. Import `uploaded`/`parsing` odczytuje status co 5 s także przy aktywnym SSE; `parsed` odświeża wiersze. Regresja symuluje zakończenie przed subskrypcją.
- Images: testy przez bramę produkcyjną nie uruchamiają dodatkowego lokalnego serwera importu wymagającego seedów. Usunięto przyczynę timeoutu TLS; weryfikacja certyfikatów bez zmian.
- Nieznany koszt: „Koszt nieznany”; zero i ujemne zero bez koloru zysku/straty. i18n, tekst źródłowy i regresje zaktualizowane.

## Weryfikacja lokalna

- Zmienione pakiety i zależne: lint/typecheck/test **88/88 zadań PASS**; po dodaniu regresji web **30/30 PASS**, audyt polityki **10/10 PASS**.
- WebKit shell + rzeczywisty import/API/PostgreSQL/worker: **18/18 PASS**.
- `ci-images`: dziewięć obrazów, Compose, pgBackRest, izolacja i E2E w trzech przeglądarkach **PASS (90/90)**, także regresje pominiętego SSE i kosztu.
- Ponowna kontrola licencji i pokrycia pobranego SBOM z czerwonego CI: **727 pakietów PASS**. To nie jest ponowienie skanu podatności.
- Budżety JS PASS; powłoka **29,45/30 KiB**. Dokumentacja, granice zależności, kontrola repozytorium i diff PASS. Logi w `.git/`.
- CI po pushu: jeden odczyt kontroli w odpowiedzi końcowej sesji; raport nie deklaruje zielonego CI nowego commitu.

## Pozostałe warunki

Nie ponawiano pełnego E2E rzeczywistego importu w pozostałych przeglądarkach, Lighthouse ani skanów obrazów — uruchamia je CI. Brak zmian ADR, nowych usług i nowych ryzyk. BL-152: aktywacja/odbiór sond i SMTP u właściciela. Realny eksport XTB, telefon/SSE, VoiceOver, procedury serwerowe i ocena nakładu ADR-001 pozostają do odbioru według raportu bramy A. Etap nie jest zamykany.
