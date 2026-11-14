# BL-114 — eksport RODO i usunięcie konta: stan sesji

**Cel:** przekazać stan implementacji praw z RODO (eksport, usunięcie konta, rejestr usunięć poza bazą) z wynikami weryfikacji i pytaniami do właściciela.

**2026-11-14**, gałąź `feat/bl-114-gdpr-export-erasure` (worktree sesji Claude Code), baza `origin/main` 16892d4, draft [PR #76](https://github.com/Ipper18/OligInvest/pull/76).
Status **w toku** do zielonego CI i wspólnego DoD. Decyzje właściciela z 2026-11-14 wdrożone; BL-160 i BL-161
dopisane do backlogu.

## 1. Zrobione

- **Eksport** (`POST /me/exports`, `GET /me/exports/{id}`, `GET /me/exports/{id}/download`): sesja z 2FA i step-up,
  bez bramki regulaminu; jeden aktywny eksport (`409`), 10 na 24 h (`429`), eksport zawieszony > 60 min oznaczany
  `failed`; `Idempotency-Key` z odtworzeniem odpowiedzi. Przy zleceniu `SecurityMonitor.exportRequested()` (BL-110);
  przy anomalii zapisywane `step_up_after`, a pobranie wymaga step-upu wykonanego później (`403 STEP_UP_REQUIRED`).
- **Archiwum** (kolejka `identity`, zadanie `identity.export`): JSON + CSV w ZIP przez `node:zlib` (bez nowej
  zależności, uzasadnienie w STACK § 5), README w języku użytkownika, kwoty jako ciągi dziesiętne, CSV z neutralizacją `= + - @`
  (także tab/CR na początku; liczby takie jak `-12.50` bez zmian), limit 64 MiB. Zbiór danych z katalogu: każda tabela z `user_id` w schematach
  użytkownika czytana pod RLS właściciela, dane Better Auth przez `identity.export_auth_data()` (bez sekretów,
  tokenów i haszy), własne wpisy audytu. Jedno pobranie — ta sama transakcja zeruje `content` i ustawia `expired`;
  zdarzenie SSE `identity.export.ready`.
- **Usunięcie konta** (`GET/POST/DELETE /me/deletion-request`): 14 dni karencji, e-maile bezpieczeństwa przy
  wniosku i anulowaniu, `GET /me` wypełnia `deletionScheduledFor`. Zadanie `identity.erasure` (03:30
  Europe/Warsaw + przy starcie jobs): kaskada po wszystkich tabelach z `user_id`, zerowanie kolumn `*_by`
  (flagi, limity ról, korekty, kalendarz, jakość danych, scenariusze) i reguł flag, audyt z pseudonimem
  HMAC (`actor_user_id`, `ip`, `user_agent` → NULL), wpis `identity.account_erased`, UUID w `platform.erasure_log`.
- **Plik poza bazą** (`ERASURE_LOG_FILE`, montowany z `infra/host/storage-compose.yaml`): dopisywanie brakujących
  UUID, czyszczenie > 40 dni, uszkodzone linie zostają; brak pliku = `ERASURE_FILE_MISSING` bez usuwania.
  Po odtworzeniu kopii konta z pliku, które znów istnieją, są usuwane ponownie przed kolejnymi krokami.
- **Migracja 0012**: tabele/kolumny eksportu i usuwania, `ON DELETE SET NULL` dla `invited_by`/`used_by`,
  funkcje `SECURITY DEFINER`, polityki RLS; `schema.sql`, `testy-rls.sql` zaktualizowane.
- **Retencja** (decyzje 2026-11-14): metadane eksportu 2 lata, e-mail w wykorzystanym zaproszeniu 30 dni po
  użyciu, `erasure_log` 40 dni, `idempotency_keys`, `bars_intraday` (90 dni), `news_items` (90 dni).
- **UI**: sekcja „Twoje dane (RODO)” w `/ustawienia`, ładowana leniwie (`next/dynamic`, bez SSR) — nic nie dochodzi do
  pierwszego ładowania `/` i `/portfel` (R-53). Teksty w `packages/i18n` PL+EN.
- **Dokumenty prawne EN**: zdanie o wiążącej wersji polskiej w generatorze i na trzech stronach.
- OpenAPI: 6 operacji zaimplementowanych, opisy i nagłówek `Idempotent-Replayed`, `QueueName` += `identity`
  ([CHANGELOG](../02-api/CHANGELOG.md)).

## 2. Weryfikacja (lokalnie)

| Zakres | Wynik |
|---|---|
| `pnpm db:test` (PostgreSQL 18, RLS, integracja API/jobs) z nowym testem RODO | PASS, „Schema comparison: ZERO DIFFERENCES” |
| Test katalogu: każda tabela z `user_id` ma kaskadę do `auth.users` (także złożone FK), brak blokujących FK, brak nieobsłużonych kolumn `*_by` / `*user_id*` | PASS |
| Eksport innej osoby → `404`; archiwum zawiera tylko dane właściciela, każdy zbiór i brak tokenów | PASS |
| Identity (15), jobs (18), `packages/db` (8), API build + `check:contracts`, web/i18n lint/typecheck/test | PASS |

Pełny przebieg `turbo` i CI — w PR.

## 3. Pytania do właściciela

1. Sekcja RODO jest tylko w `/ustawienia`; osoba, która nie zaakceptowała nowej wersji regulaminu, ma do niej
   dostęp przez API, ale bramka web przekierowuje ją na stronę akceptacji. Dodać przyciski na tej stronie?
2. Usunięcie zeruje IP i user agent we wpisach audytu usuniętej osoby (zostaje pseudonim). Zgoda?
3. Zaproszenia wystawione przez użytkownika nie trafiają do eksportu (to dane osób zapraszanych). Zgoda?
4. Limit archiwum 64 MiB i czas usunięcia ≤ 15 dni od wniosku (LIM § 7) — akceptowalne?
5. Na hoście: plik `/srv/backup/erasure-log.jsonl` z właścicielem `10003:10003`, 0600, i uaktualniony
   `/etc/oliginvest/storage-compose.yaml` przed wdrożeniem (runbook M0-3 krok 5).
6. CSV: przecinek, UTF-8 bez BOM. Dodać BOM dla Excela?
7. Pobranie jest jednorazowe także przy przerwanym transferze (trzeba zlecić nowy eksport). Zgoda?
8. BL-161: retencja `import_rows` (1 rok po zatwierdzeniu) dotyka `modules/portfolio` — zostawiona Codexowi.

## 4. Poprawki po pierwszym CI

- Teksty RODO trafiły do głównego wejścia `@oliginvest/i18n`, które jest częścią powłoki (30,75 / 30 KiB) — teraz
  osobne wejście `@oliginvest/i18n/privacy`, ładowane leniwie (29,82 KiB).
- Walidatory Zod komponentu RODO (`z.uuid()`, `z.iso.datetime()`) trafiły do wspólnego fragmentu Zod ładowanego na
  każdej trasie (`/nauka`: 196,3 / 190 KiB przy 189,2 na `main`). Komponent sprawdza odpowiedzi małymi funkcjami
  bez Zod; `/nauka` 189,1 KiB. Wniosek dla UI: nowe walidatory Zod po stronie klienta powiększają wspólny fragment,
  nawet w komponentach ładowanych leniwie.
- ACL Valkey produkcji (`infra/scripts/secret-files.py`) nie obejmował kolejki `identity` — dodane `~bull:identity:*`
  dla `api` i `jobs` z testem.
