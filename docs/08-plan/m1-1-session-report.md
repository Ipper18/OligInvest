# M1-1 — stan bieżący

**Cel:** przekazać stan API/CLI uwierzytelniania; dowody etapów w [historii](m1-1-session-history.md).

**2026-10-05**, `feat/m1-1-auth`, [PR #7](https://github.com/Ipper18/OligInvest/pull/7). Zakres agentowy zakończony; kod `6cd13f4`, wszystkie wymagane kontrole CI zielone. BL-101/102/103/105/106/108/109/111/117 gotowe. BL-107 w toku wyłącznie do dowodów produkcyjnych właściciela. Ekrany należą do M1-4, zdarzenia e-mail bezpieczeństwa do BL-110. PR wymaga przeglądu właściciela.

## Implementacja

- Better Auth 1.7.5/Drizzle, rola auth, Argon2id, polityka haseł/HIBP z fallbackiem, limity; zamknięta lista tras, Origin, obowiązkowe MFA, blokada powtórek TOTP i 5/15 min, bramka regulaminu.
- Bootstrap wyłącznie w pustej bazie, ukryte hasło, zgody i audyt. Zaproszenia API/CLI z fragmentem URL, weryfikacją e-maila zaproszeniem i idempotencją 24 h per admin; token nie jest przechowywany jawnie.
- Sesje `__Host-`, 7/30 dni, odnowienie DB i ciasteczka najwyżej raz na 24 h, rotacja przy step-upie, lista z przybliżonym IP, odwołanie i Clear-Site-Data. Odzyskanie backup + hasło: jednorazowa wymiana TOTP przez 10 min, bez uprawnień step-up/admina; nowe backupy i usunięcie innych sesji.
- RBAC, audyt admina/CLI z pseudonimem, korelacją i bezpiecznym stanem. CLI zaproszeń, resetu 2FA, sesji/PAT, kolejek i flag; maintenance z rollbackiem Caddy. Flagi API/jobs: TTL 30 s, role/użytkownicy, 404, pomijanie zadań, pub/sub.
- SMTP: reset hasła, zaproszenia i reset 2FA przez jobs, STARTTLS Brevo, wygaszanie zadań. Import transportu i runtime DB leniwy, limit testu nadal 5 s. Naprawiono filtr DB/cache procesu jobs, konfigurację Mailpit i limit producenta na blokującym workerze. Diagnostyka: klasa/kod/nazwa zmiennej, bez wartości sekretów.

## Dowody i dalsze kroki

Przegląd bezpieczeństwa 2026-10-05: wdrożono cztery poprawki (sesje po `id` i `current`, porównanie wszystkich kodów zapasowych w stałym czasie, weryfikacja ciasteczek wszystkimi zachowanymi kluczami, zaproszenia bez fałszywego 409). Lokalnie API 92 testy PASS, DB/RLS i współbieżne zaproszenia PASS, schemat ZERO DIFFERENCES. Nowe CI weryfikowane po push. **R-31 otwarte:** globalna blokada `730101` pozostaje na życzenie właściciela; szereguje auth/admin/CLI i obejmuje koszt Argon2/Better Auth, więc może opóźniać inne konta. Blokada idempotencji per administrator/klucz czeka; nie usuwa globalnego ograniczenia przepustowości.

[CI unit/build](https://github.com/Ipper18/OligInvest/actions/runs/37326826438), [workers](https://github.com/Ipper18/OligInvest/actions/runs/37326826457), [DB/RLS](https://github.com/Ipper18/OligInvest/actions/runs/37326826371): PASS na `6cd13f4`. Workers potwierdza start czterech aplikacji, kolejkę → worker → Mailpit, współbieżne liczniki/TOTP i unieważnienie flag dwóch procesów. DB: bootstrap i współbieżność, fasada auth, odzyskanie/sesje/RBAC/audyt/CLI; schemat ZERO DIFFERENCES. Także contracts, klient, modules, web, e2e, images, deps-audit i CodeQL zielone. 21 operacji / 164 pending (początkowo 182).

Następnie: przegląd właściciela i scalenie PR; BL-107 — SPF/DKIM/DMARC oraz doręczenia Gmail/iCloud według ADR-010. Kalibracja Argon2id i instalacja skryptów na VM nadal po stronie właściciela. Bramy całego M1 otwarte; dowód backendowej części A.5 jest w CI, UI i testy docelowe pozostają w kolejnych paczkach. R-30 zamknięte testami bootstrapu. Bez nowych ryzyk, ADR, usług ani kosztów; estymacje bez zmian, nakład niezmierzony.
