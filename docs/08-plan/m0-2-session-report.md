# M0-2 — stan bieżący

**Cel:** przekazać stan paczki i kryteria wyjścia; szczegóły etapów w [historii](m0-2-session-history.md).

**2026-10-01**, `feat/m0-2-release` z `main` (`25e8762`), [roboczy PR #5](https://github.com/Ipper18/OligInvest/pull/5). Zakres: BL-020–023, BL-030/031 i obrazowa część BL-018. Etapy wypchnięte; bez tagów, wydań, GHCR, działań na serwerach i zmian ustawień GitHub.

## Wykonane i dowody

- BL-020/022: dziewięć obrazów non-root z przypiętymi bazami, read-only FS, limity, dwa Valkey z ACL. Web/analytics bez egress; analytics nie czyta portfela. Generator i test czytają tę samą tabelę INF §8.1. Dokładne montowania własnych sekretów bez zapisu, idempotencja, atomowa rotacja i odrzucanie symlinków PASS. R-27 obsłużone zgodnie z zatwierdzeniem właściciela.
- BL-021: PR tylko buduje/testuje; wyłącznie job `release` po tagu ma zapis. Podpisy i poświadczenia poprzedzają paczkę. SBOM/OSV 9 obrazów lokalnie PASS według CI §5. Poprawiono pakiety bazowe i Caddy do 2.11.6; pozostałe znaleziska jawne (R-28). Próg lockfile bez zmian.
- BL-023: bootstrap, weryfikacja paczki/digestów/tożsamości/commita, kopia przed migracją, health gate, rollback aplikacji. 5 testów negatywnych/kolejności PASS; szyfrowana pełna kopia pgBackRest i check w Compose PASS. [Instrukcja właściciela](../07-wdrozenie/m0-2-owner-runbook.md).
- BL-018: **36/36 E2E** na obrazach, Chromium/WebKit/Firefox, axe, motywy, klawiatura, CSP/nagłówki. Artefakt CI ujawnił brak hostowego `i18n/dist`; build importu naprawiony. Wyścig natywnego close poprawiony, regresja bez osłabienia asercji.
- BL-030/031: trzy przeglądarki PASS dla `__Host-`, TOTP, szyfrowanych kodów i hashy PAT. Argon2id lokalnie ok. 4 ms — **nie jest to pomiar VM**. [Notatka do zatwierdzenia](bl-030-031-auth-spikes.md); produkcyjne auth pozostaje M1.

## Kryteria wyjścia M0

| Nr | Stan / dowód |
|---|---|
| 1–3 | Monorepo, sześć buildów, granice, RLS/schema i OpenAPI w kontrolach PR; końcowy przebieg po ostatnim commicie w toku |
| 4 | Skrypty i testy lokalne gotowe; wydanie, wdrożenie VM i publiczny TLS wykonuje właściciel |
| 5 | Hardening, tunel, CAA i migracja Immicha poza paczką; brak dowodu docelowego |
| 6 | Lokalny pgBackRest PASS; restic/VPS i Kuma pozostają BL-028/029 |
| 7 | Dodano images do pliku rulesetu; ustawień nie zmieniono; CodeQL sprawdzany w PR |
| 8 | Notatka BL-030/031 gotowa; decyzja właściciela i kalibracja VM otwarte; TS7 z M0-1, CAA poza paczką |

M0 pozostaje otwarty. Statusy w toku do zielonego CI i wspólnego DoD/przeglądu właściciela. Estymacje bez zmian, nakład niezmierzony. Nowe R-28: znaleziska obrazów bez poprawki. Bez nowego ADR i zmian OpenAPI, SQL, wzorów czy disclaimerów. Zależności dev spików uzasadniono w STACK; nie trafiają do obrazów aplikacji.
