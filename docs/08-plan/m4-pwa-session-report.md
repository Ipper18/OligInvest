# M4-PWA — stan 2026-10-29

**Cel:** stan BL-401/402/411 na gałęzi `feat/m4-pwa-push`, osobny worktree z `origin/main` 22c4b96 (#38 i #42).

## Zrobione

Manifest, ikony i skróty, publiczne `/offline`, własny worker: wyłącznie statyczne zasoby, push, bezpieczny `notificationclick`, komunikat aktualizacji uruchamianej gestem. Rejestracja po `load`, osobny moduł. Prywatne API/HTML nigdy nie trafiają do cache; wylogowanie/401 czyszczą stan prywatny. CSP i nagłówki bez poluzowania.

`web-push` 3.6.7 (MPL-2.0) i typy 3.6.4 (MIT), dokładne wersje po karencji, weryfikacja w stosie. VAPID przez `*_FILE`, przykłady puste. Subskrypcje z RLS, idempotencja, test w kolejce, TTL/Urgency, 404/410, fallback i cisza według istniejącej polityki; obowiązkowy e-mail bezpieczeństwa zachowany. Minimalny UI zgody/testu w ustawieniach. Link alertu do instrumentu i wspólny `safeReturnTo` także dla powrotu po logowaniu.

Właściciel zatwierdził `device_label`/`expires_at` oraz `GET /notifications/push-config`: [decyzja](m4-pwa-contract-proposal.md), OpenAPI i migracja 0009 w tej paczce. Nowy ADR nie jest potrzebny.

## Dowody lokalne

- Zmienione pakiety i zależne: lint/typecheck/unit; po korekcie list operacji API oba dotknięte pliki 39/39 PASS. Jednostkowe obejmują subskrypcje, wygaśnięcie, TTL/Urgency, endpointy, linki i worker.
- PostgreSQL 18: pełne `pnpm db:test` PASS, schemat ZERO DIFFERENCES, RLS/katalog/pule. Po korekcie obowiązkowego e-maila bezpieczeństwa tylko integracja M4 na świeżej bazie: PASS.
- OpenAPI: 98 operacji zaimplementowanych / 88 oczekujących; kontrakty i generacja klienta PASS. Build web/api/jobs PASS.
- Powłoka **29,77/30 KiB**, onboarding **188,68/190 KiB**, driver **7,12/8 KiB**. Wszystkie dostępne budżety tras PASS. Bez podnoszenia limitów.
- Lighthouse `--assert`: cztery trasy × trzy pomiary; mediany LCP 1353–1803 ms (<2000), TBT 45–50 ms (<200), CLS 0 (<0,1): PASS.
- Pełne E2E trzech silników: 105 PASS / 22 FAIL / 5 SKIP. Korekty budżetu, przejmowania auth przez SW i ścieżek zrzutów sprawdzone tylko w dotkniętych scenariuszach; 14 wcześniejszych błędów usuniętych. Pozostaje **8 timeoutów WebKit w shell-auth** (axe, preferencje, logout, returnTo), zgłoszone przy R-41, bez retry/podnoszenia timeoutów; pełnego zestawu nie powtarzano. Nie potwierdzono, że każdy timeout ma tę samą przyczynę co R-41.
- Realny SW/offline i syntetyczny click w zainstalowanym workerze Chromium PASS; natywnego powiadomienia systemowego nie symulujemy jako dowodu urządzenia. Firefox/WebKit sprawdzają publiczne zasoby, click pomijany z ograniczenia Playwright.

Zrzuty używają `testInfo.outputPath`, logi/TLS rozwiązują ścieżki przez Git. Zweryfikowano uploady `e2e.yml` i `release.yml` (`images`): raport, `test-results` (trace/zrzuty) i dotychczasowe globy logów nadal objęte; w CI `.git/` jest katalogiem. Nie archiwizujemy tymczasowych kluczy TLS.

## Otwarte

BL-401/402/411: `w toku` do CI i DoD; wynik jednego końcowego odczytu CI w PR/rozmowie. M4 nie jest zamykany. Odbiór fizycznego push i instalacji należy do BL-412/właściciela; bez sekretów i dostępu do urządzeń. BL-406, ekran PAT i BL-409 czekają na redesign, BL-565 poza zakresem. Estymata 6 dni, rzeczywisty nakład niezmierzony. R-51: akceptacja przez usługę ≠ wyświetlenie, częściowa dostawa/duplikat. R-41 pozostaje otwarte.
