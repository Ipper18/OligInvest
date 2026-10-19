# M1-4b — stan bieżący

**Cel:** przekazać stan BL-147/148/157/158/154/155 i aplikacyjnej części BL-152 oraz warunki bramy A.

**2026-10-19**, `feat/m1-4b-mvp-screens`, [PR #14](https://github.com/Ipper18/OligInvest/pull/14).
Ekrany i odczyty REST są wdrożone; zatwierdzone kontrakty zaimplementowane. Zadania pozostają `w toku` do zielonego CI i wspólnego DoD. Nakład/odchylenie niezmierzone; brama A otwarta.

## Zrobione

- Start, Pozycje, Operacje, Rachunki, Partie, wynik zrealizowany, import XTB/mBank, karta instrumentu i leniwy wykres; szczegóły odbioru: [raport bramy A](m1-4b-gate-a.md).
- Wcześniejsze poprawki PR: SSRF proxy, metadane licencji MIT, szerokość filtrów WebKit, odczyt statusu importu po pominiętym SSE, konfiguracja testów obrazów, etykieta nieznanego kosztu i neutralne zero.
- Naprawa `returnTo` (BL-155): po rotacji ciasteczka przez Server Action strona TOTP renderowała się ponownie i wykonywała `redirect("/")`, konkurując z powrotem klienta. Strony logowania, TOTP, konfiguracji i regulaminu zachowują teraz cel między bramkami i po ich przejściu. Walidator `safeReturnTo` bez zmian; kody zapasowe nadal wymagają potwierdzenia zapisania.
- Oryginalny scenariusz `password challenge…` bez zmian. Dodane regresje stron serwerowych oraz E2E powrotu, bramki regulaminu i odrzucania zewnętrznego celu. Uzupełniona architektura UI.

## Weryfikacja tej poprawki

- Produkcyjny build, `webkit-shell`: przed poprawką **1/20 FAIL**, dokładnie `/` zamiast `/ustawienia`; po poprawce **20/20 PASS**. Trace błędu i logi w `.git/m1-4b-return-to-*`.
- Cały `shell-auth.spec.ts`: **36/36 PASS** w Chromium, WebKit i Firefox, łącznie z pierwotnym scenariuszem, nowymi regresjami, kodami zapasowymi i axe.
- Zmienione pakiety i zależne: lint/typecheck/test **88/88 zadań PASS**; web **34/34 PASS**. Nowe regresje serwerowe przed poprawką: 3 FAIL; po poprawce: **4/4 PASS**.
- Build produkcyjny, budżety JS (powłoka **29,45/30 KiB**), dokumentacja, kontrola repozytorium i diff PASS.
- Pełne `e2e` i `images` wymagają potwierdzenia CI po pushu; pojedynczy odczyt na koniec sesji, wynik w odpowiedzi końcowej.

## Pozostałe warunki

Nie ponawiano obrazów, pełnego importu przez API/bazę/worker, Lighthouse ani skanów — brak zmian w tych obszarach; uruchamia je CI. Bez nowych ADR, usług i ryzyk. BL-152: aktywacja/odbiór sond i SMTP u właściciela. Realny eksport XTB, telefon/SSE, VoiceOver, procedury serwerowe i ocena nakładu ADR-001 pozostają do odbioru według raportu bramy A. Etap nie jest zamykany.
