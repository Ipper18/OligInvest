# Konta lokalne — stan bieżący

**Cel:** przekazać wynik BL-034 oraz powiązanych poprawek BL-102/122 i pozostałe kroki właściciela.

**2026-10-26**, gałąź `feat/dev-local-accounts`, [roboczy PR #22](https://github.com/Ipper18/OligInvest/pull/22). W osobnym worktree włączono `origin/main` (`f6adccd`) przez merge: Zod 4.6.7, poprawki Caddy, pgBackRest 2.59.3 i dokumentację. Konflikt `ryzyka.md`: R-42, R-43 i podsumowanie 43 ryzyk z main, dodatkowo nasze doprecyzowanie R-19. Bez zmian cudzej pracy i bez scalania PR.

## Wykonane

- Trwałe `DEV_AUTH_SECRET` i `DEV_AUDIT_KEY` generowane raz w ignorowanym `.env`; walidacja konfliktu zamiast cichej rotacji. Hasła ról DB nadal losowe.
- Opcjonalne hasło demo: istniejąca polityka API/HIBP i Argon2id, także dla dawnego seeda bez hasła; idempotencja, brak resetowania MFA i zgód. Profile demo/owner mają oddzielne projekty Compose, bazy i kolejki. Owner pomija seed, interaktywne CLI dziedziczy właściwe role i wymaga TTY.
- Guardy development + developerska DB; testy odmowy produkcji i braku przekazywania lokalnych flag/hasła usługom. Konfiguracja Next: lokalny routing API/SSE i HMR tylko w development, bez logowania argumentów Server Functions.
- **Osobny commit formularza `13f8194`:** gotowość obsługi JavaScript przed wysłaniem + POST, regresja SSR wszystkich formularzy. Kolejna poprawka zachowuje jednorazowe kody zapasowe, gdy po TOTP oczekuje bramka regulaminu; dostępu do danych nie otwiera.
- Instrukcja demo/owner i mapowania XTB. Pusty katalog nie zgaduje instrumentów; wyszukiwanie Yahoo w tle wymaga ponowienia, GPW uzupełnia zadanie harmonogramu. Bez automatycznego seedowania fikcyjnych instrumentów owner.

## Dowody i ograniczenia

- PASS po merge 26.10: frozen lockfile; 57 zadań lint/typecheck/test z wymaganymi buildami (25 z cache), w tym 36 testów web; 112 testów skryptów, 4 polityki audytu obrazów; kontrole 112 dokumentów/repozytorium/granic. `13f8194` pozostaje osobnym przodkiem gałęzi, zabezpieczenia i timeouty bez zmian.
- PASS PostgreSQL: seed, rollback, polityka hasła, pusty owner/bootstrap, katalog Yahoo bez sieci; odtworzenie runtime z nowymi hasłami ról zachowuje sesję, TOTP i kod zapasowy. MFA oraz regulamin nadal blokują dane. Regresja kont uruchamiana w CI workers.
- Wcześniejszy PASS `pnpm dev:test`: API/web/jobs/analytics, Mailpit i Valkey; `.venv` uzupełniona z lockfile.
- PASS Chromium przez lokalny HTTP: demo → TOTP → zapis kodów → regulamin → portfel z dwoma rachunkami; ciasteczko Secure/HttpOnly, brak hasła w logach. Diagnostyka lokalna w `.git/dev-browser-*.log`; nie jest testem realnego pliku właściciela.
- E2E, integracji DB i obrazów nie powtarzano lokalnie; dowody DB i Chromium wyżej pochodzą sprzed merge. Rzeczywisty import pozostaje u właściciela. CI: jeden odczyt po push, wynik w Checks PR i podsumowaniu sesji. Według właściciela poprzednie E2E anulowano po 20 min instalacji Playwright/apt; przy powtórzeniu zgłosić, nie podnosić timeoutów. Automatyzacja oczekiwania na PR #18 usunięta 23.10. DoD i etap M0/M1 pozostają otwarte.

Odchylenie: dodatkowe poprawki formularza i konfiguracji Next wykryte przez test przeglądarkowy; nakład niezmierzony. Bez nowego ADR, usług, kosztów, zmian SQL/OpenAPI i osłabiania zabezpieczeń. Ryzyko utraty `.env` doprecyzowane w R-19; realne uzgodnienie importu pozostaje kryterium bramy M1-A.
