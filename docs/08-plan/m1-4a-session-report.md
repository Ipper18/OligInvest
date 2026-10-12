# M1-4a — stan bieżący

**Cel:** przekazać stan BL-121/122/113/116 i warunki PR #11.

**2026-10-12**, feat/m1-4a-ui-shell, [PR #11](https://github.com/Ipper18/OligInvest/pull/11), roboczy, niescalony.
Statusy nadal „w toku” do zielonego CI i wspólnego DoD. Nakład/odchylenie niezmierzone.

## Zrobione

Powłoka, auth/MFA i regulamin, SSE, preferencje i dokumenty prawne wykonane lokalnie.
Wcześniejsze dowody DB/RLS, zgodności schematu i Lighthouse pozostają w opisie PR.

- 76b6d03: zastane zmiany dokumentacji zapisane przed scaleniem.
- 0ae4d68: merge origin/main, bez rebase/force. Konflikty: lockfile oraz dwa
  niezależne dopiski backlogu (zachowano oba). Lockfile z main + pnpm install;
  dodatki identyczne z poprzednią gałęzią: web i trzy linki workspace do platformy.
  Brak innych zmian grafu; frozen install PASS.
- fe459ef: własny komunikat BroadcastChannel uruchamiał nawigację i anulował
  POST wylogowania przed usunięciem ciasteczek (potwierdzone śladem WebKit).
  Nadawca ignoruje własny komunikat; inne karty powiadamiane po odpowiedzi API.
  Powłoka/cache znikają od razu; zatrzymany także spóźniony start SSE.
  Jawne wylogowanie → /logowanie; returnTo pozostaje przy wejściu bez sesji.
- Bramka regulaminu: stan fixture był współdzielony między przeglądarkami.
  Osobne identyfikatory eliminują przenoszenie akceptacji i preferencji.
  Regresje sprawdzają brak HTML powłoki przy bramkach oraz brak/błędną sesję.
- Images: artefakty pokazywały logowanie, bo sztuczne ciasteczka trafiały do
  prawdziwego API/innego origin. Projekty *-shell mają lokalny build produkcyjny
  i fixture API; integracyjne nadal kierują się do obrazów za Caddy.
  Job images buduje web także na hoście; brak obejścia auth w aplikacji.
- Preferencje: aktualizacja DOM/cache profilu bez zbędnego router.refresh,
  który kolidował z reload w Firefox. Zapis i ponowny SSR sprawdzone.

## Weryfikacja tej sesji

- Build produkcyjny PASS; web lint/typecheck/test: 9 zadań, 20 testów PASS.
- Zmienione E2E Chromium/WebKit/Firefox: **33 PASS**, 3 istniejące próby
  gotowości API pominięte bez Compose. Opóźnione wylogowanie i druga karta PASS.
- Konfiguracja z E2E_BASE_URL/E2E_API_URL jak images: **30/30 PASS** na lokalnym
  buildzie produkcyjnym. Pełny przebieg obrazów wykonuje CI.
- Powłoka **22,11/30 KiB**, Start 149,28/190, ustawienia 150,05/185,
  logowanie 138,63/160; budżety tras PASS. Dokumentacja/repo/check-ci PASS.
- Jednorazowy timeout SSE WebKit nie powtórzył się w 10 próbach tego przypadku
  ani końcowej macierzy 30 testów. Przyczyna niepotwierdzona: R-36.

## Pozostałe warunki

CI: końcowy odczyt po pushu, bez oczekiwania/pętli; wynik w odpowiedzi sesji.
Brak potwierdzenia zielonego CI dla tej wersji w chwili zapisu raportu.
BL-147/148/152/154/155/157/158 oraz reszta BL-104 pozostają poza paczką.
Bramy M1 A/B otwarte: przegląd właściciela, pełne E2E/import, VoiceOver/telefon,
wdrożenie i LEGAL_*. Bez nowego ADR, usługi, kosztu ani osłabienia kontroli.
