# Konta lokalne — stan bieżący

**Cel:** przekazać wynik BL-034 oraz powiązanych poprawek BL-102/122 i pozostałe kroki właściciela.

**2026-10-23**, gałąź `feat/dev-local-accounts` z aktualnego przy starcie `origin/main`, [roboczy PR #22](https://github.com/Ipper18/OligInvest/pull/22). Commit i push po etapach; bez scalania PR. PR #18 pozostaje otwarty w ostatnim odczycie — merge `origin/main` ma nastąpić po jego scaleniu.

## Wykonane

- Trwałe `DEV_AUTH_SECRET` i `DEV_AUDIT_KEY` generowane raz w ignorowanym `.env`; walidacja konfliktu zamiast cichej rotacji. Hasła ról DB nadal losowe.
- Opcjonalne hasło demo: istniejąca polityka API/HIBP i Argon2id, także dla dawnego seeda bez hasła; idempotencja, brak resetowania MFA i zgód. Profile demo/owner mają oddzielne projekty Compose, bazy i kolejki. Owner pomija seed, interaktywne CLI dziedziczy właściwe role i wymaga TTY.
- Guardy development + developerska DB; testy odmowy produkcji i braku przekazywania lokalnych flag/hasła usługom. Konfiguracja Next: lokalny routing API/SSE i HMR tylko w development, bez logowania argumentów Server Functions.
- **Osobny commit formularza `13f8194`:** gotowość obsługi JavaScript przed wysłaniem + POST, regresja SSR wszystkich formularzy. Kolejna poprawka zachowuje jednorazowe kody zapasowe, gdy po TOTP oczekuje bramka regulaminu; dostępu do danych nie otwiera.
- Instrukcja demo/owner i mapowania XTB. Pusty katalog nie zgaduje instrumentów; wyszukiwanie Yahoo w tle wymaga ponowienia, GPW uzupełnia zadanie harmonogramu. Bez automatycznego seedowania fikcyjnych instrumentów owner.

## Dowody i ograniczenia

- PASS: 72 testy skryptów; kontrola dokumentacji/repozytorium/granic; 37 zadań lint/typecheck/test zmienionych pakietów i zależnych. Po poprawkach web: 16 zadań, 36 testów web.
- PASS PostgreSQL: seed, rollback, polityka hasła, pusty owner/bootstrap, katalog Yahoo bez sieci; odtworzenie runtime z nowymi hasłami ról zachowuje sesję, TOTP i kod zapasowy. MFA oraz regulamin nadal blokują dane. Regresja kont uruchamiana w CI workers.
- PASS `pnpm dev:test`: API/web/jobs/analytics, Mailpit i Valkey. Lokalną `.venv` uzupełniono z istniejącego lockfile po wykryciu braku jsonschema; bez zmian zależności.
- PASS Chromium przez lokalny HTTP: demo → TOTP → zapis kodów → regulamin → portfel z dwoma rachunkami; ciasteczko Secure/HttpOnly, brak hasła w logach. Diagnostyka lokalna w `.git/dev-browser-*.log`; nie jest testem realnego pliku właściciela.
- Nie wykonywano rzeczywistego importu (plik pozostaje u właściciela), testów wszystkich przeglądarek ani produkcyjnych obrazów. CI sprawdzane jeden raz na końcu; bieżący wynik w Checks PR i podsumowaniu sesji. DoD i etap M0/M1 nie są zamknięte.

Odchylenie: dodatkowe poprawki formularza i konfiguracji Next wykryte przez test przeglądarkowy; nakład niezmierzony. Bez nowego ADR, usług, kosztów, zmian SQL/OpenAPI i osłabiania zabezpieczeń. Ryzyko utraty `.env` doprecyzowane w R-19; realne uzgodnienie importu pozostaje kryterium bramy M1-A.
