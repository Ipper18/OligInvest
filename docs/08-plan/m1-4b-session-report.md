# M1-4b — stan bieżący

**Cel:** przekazać stan BL-147/148/157/158/154/155 i aplikacyjnej części BL-152 oraz warunki bramy A.

**2026-10-19**, `feat/m1-4b-mvp-screens`, [PR #14](https://github.com/Ipper18/OligInvest/pull/14).
Ekrany i odczyty REST są wdrożone; zatwierdzone kontrakty zaimplementowane. Zadania pozostają `w toku` do zielonego CI i wspólnego DoD. Nakład/odchylenie niezmierzone; brama A otwarta.

## Stan po scaleniu main

- Scalono przez `git merge origin/main` backend M2 z PR #15 (`e98301c`), bez rebase i bez force push. Jedyny konflikt: `ryzyka.md`; wpisy obu stron zachowane.
- Ryzyka M2 pozostają R-37 (symbole Yahoo) i R-38 (odczyt jakości przez analytics). Ryzyka M1-4b otrzymały kolejne wolne numery: **R-39** — luki wyceny (dawne R-37), **R-40** — niepełny raport błędów/duplikat SMTP (dawne R-38). Treści i statusy ryzyk bez zmian; odwołanie w opisie PR poprawione.
- Lokalnie po merge: `pnpm turbo run lint typecheck test --filter=...[origin/main] --output-logs=new-only --concurrency=3` — **88/88 zadań PASS** (24 pakiety, w tym backend M2 i zależne); web **34/34 PASS**. `pnpm check:docs` — **107 dokumentów PASS**; kontrola diff PASS. Log: `.git/m1-4b-merge-main-checks.log`.
- CI: jeden odczyt po pushu na koniec sesji; wynik w odpowiedzi końcowej. Brak nowych decyzji ADR, usług i ryzyk; tylko usunięcie kolizji numeracji.

## Wdrożone wcześniej w paczce

- Start, Pozycje, Operacje, Rachunki, Partie, wynik zrealizowany, import XTB/mBank, karta instrumentu i leniwy wykres; szczegóły odbioru: [raport bramy A](m1-4b-gate-a.md).
- Poprawki SSRF proxy, metadanych licencji MIT, szerokości filtrów WebKit, odczytu statusu importu po pominiętym SSE, konfiguracji testów obrazów, nieznanego kosztu i neutralnego zera.
- BL-155: serwerowe przekierowania zachowują `returnTo` po rotacji ciasteczka MFA; `safeReturnTo` i pierwotny test bez zmian. Przed merge: błąd odtworzony na produkcyjnym WebKit (1/20 FAIL), po poprawce 20/20 PASS; `shell-auth.spec.ts` w trzech przeglądarkach 36/36 PASS. Trace i logi: `.git/m1-4b-return-to-*`. Budżety JS PASS, powłoka 29,45/30 KiB.

## Stabilizacja `webkit-shell` (2026-10-20, `fix/webkit-shell-readiness` → PR #14)

- Przyczyna: operacje sesji jako Server Actions. Zmiana ciasteczka wymuszała ponowne renderowanie trasy, a przekierowanie bramki uruchamiało drugą nawigację, konkurującą z `location.assign/replace`. WebKit anuluje fetch RSC na starcie nawigacji, a Next zamienia go w kolejną nawigację dokumentu (przerwane `goto`, w logu „The destination stream closed early”). Poprawka: przekaźnik `POST /auth/action` ([architektura UI § 4](../04-frontend/architektura-ui.md)), ryzyko R-41.
- Testy: podmiana sesji z `about:blank` (żywa powłoka po 401 SSE nawiguje do `/logowanie`); wykrycie przeładowania znacznikiem `window` zamiast `timeOrigin`; potwierdzenie uzgodnienia importu aktywne dopiero po mutacji i odświeżeniu trasy; trace przy błędzie. Bez `retries`, timeoutów i wyłączania WebKit.
- Dowody (Linux, Playwright 1.63, build produkcyjny, 4 vCPU + 8 pętli obciążenia, `webkit-shell --repeat-each=10`): przed 188/190 (`timeOrigin`, przerwane `goto`), 1× błąd strumienia, 34 zerwane ładowania dokumentu/RSC; po 190/190, 0 błędów strumienia, 0 zerwanych nawigacji. Pełna macierz trzech przeglądarek 93 PASS, 3 pominięte (`production.spec` bez Compose). Web lint/typecheck/test 34/34 PASS.
- Nieodtworzone lokalnie (≥ 115 powtórzeń): checkbox mBank i „internal error” w teście 212 z CI; rozstrzyga przebieg CI z trace.

## Pozostałe warunki

W sesji scalania nie ponawiano E2E, obrazów, integracji bazodanowych, Lighthouse ani skanów; pełną macierz uruchamia CI. BL-152: aktywacja/odbiór sond i SMTP u właściciela. Realny eksport XTB, telefon/SSE, VoiceOver, procedury serwerowe i ocena nakładu ADR-001 pozostają do odbioru według raportu bramy A. Etap nie jest zamykany.
