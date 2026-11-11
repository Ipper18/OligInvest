# BL-115 — zadania retencji: stan sesji

**Cel:** przekazać stan zadań retencji NFR-11.02 przejętych od Codexa, z wynikami weryfikacji i pytaniami do właściciela.

**2026-11-10**, gałąź zdalna `feat/bl-115-retention` (lokalnie worktree sesji Claude Code
`claude/bl-115-retention-tasks-79b7db` — harness nie pozwolił edytować folderu `OligInvest-bl-115`),
baza `origin/main` 797fd4a, draft PR: __PR__. Status **w toku** do zielonego CI, wspólnego DoD
i odpowiedzi na pytania z § 4. Zależność BL-114 (eksport RODO) nadal `todo` — retencja eksportów
działa na istniejącej tabeli i nie przesądza implementacji BL-114.

## 1. Weryfikacja ustaleń Codexa

| Ustalenie | Wynik |
|---|---|
| Pliki importu i rejestr kwot istnieją; proste sprzątanie plików w workerze | potwierdzone: `DELETE … expires_at <= now()` w `enqueueAll("recompute")`, `expires_at` = upload + 90 dni (`modules/portfolio/src/server/imports.ts`) — przeniesione do `retention.run` |
| Polityka RLS kwot z granicą 7 × 24 h gotowa | potwierdzone: `quota_retention` (`consumed_at < now() - interval '168 hours'`), brak `UPDATE` |
| Tabela eksportów trzyma ZIP w bazie, BL-114 bez eksportu | potwierdzone: `identity.data_exports.content bytea`, status `expired` w CHECK |
| Okres retencji eksportów nieokreślony | **częściowo**: archiwum — „24 h lub do pierwszego pobrania” jest w dokumentacji; nieokreślony jest tylko okres przechowywania **wiersza metadanych** → pytanie 1 |
| Audyt to zwykła tabela; partycjonowanie po 1 mln wierszy; rola aplikacji bez `DELETE` (ADR-004) | potwierdzone; zrobiony tylko punkt rozszerzenia (raport progu) |
| Podpięcie do istniejącego zadania nocnego | zrobione: `portfolio.recompute-all` (03:00 Europe/Warsaw) dodaje `retention.run` |
| (nowe) zaproszenia | tylko `admin` miał politykę RLS — kontekst `system` nie mógł ich sprzątać; dodana wąska polityka (migracja 0011) |

## 2. Zrobione

- `packages/db/src/retention.ts`: lista celów z okresami wyłącznie z `prywatnosc-rodo.md` § 6 —
  pliki importu (90 dni przez `expires_at`), archiwa eksportu (24 h lub pobranie: zerowanie `content`,
  status `expired`, metadane zostają), zaproszenia niewykorzystane (30 dni po wygaśnięciu), dziennik
  doręczeń (180 dni), RUM (90 dni), `platform.role_quota_usage` (> 7 × 24 h, R-52).
  Partie po 500 wierszy w osobnych krótkich transakcjach; dane użytkowników w kontekście RLS
  właściciela (`role: user`), dane globalne w kontekście `system`. Bez superusera i bez ról z BYPASSRLS.
- Blokada przed równoległym uruchomieniem: deduplikacja BullMQ `retention.run` (najwyżej jedno
  zadanie oczekujące lub aktywne do zakończenia/błędu) oraz `pg_try_advisory_xact_lock` per cel i
  właściciel w każdej partii — drugi przebieg pomija zajęty zakres zamiast czekać; posiadacz blokady
  dokańcza. Idempotencja: ponowny przebieg nie znajduje kwalifikujących się wierszy.
- Migracja **0011_retention-invitations**: polityki `retention_read`/`retention_delete` na
  `identity.invitations` dla `system`, ograniczone do `used_at IS NULL AND expires_at < now() - 30 dni`.
  `schema.sql`, `sql/rls.sql`, `testy-rls.sql` zaktualizowane.
- Audyt: `auditPartitioningDue` czyta szacunek `pg_class.reltuples`, metryka
  `audit_log_rows_estimate`, ostrzeżenie `retention.audit_partitioning_due` powyżej 1 mln wierszy.
  Nigdy nie usuwa wpisów audytu.
- `apps/jobs`: `retention-runtime.ts` (kolejkowanie i obsługa), metryki `retention_rows_total` /
  `retention_skipped_total` (etykieta: tabela), log `retention.completed` z `duration_ms` — bez
  identyfikatorów. Kod błędu `RETENTION_FAILED` w raporcie monitoringu. Bez retry (`attempts` domyślne).
- Dokumentacja: `prywatnosc-rodo.md` § 6, `model-danych.md` § 1 i § 4, `moduly.md`, `monitoring.md`.

## 3. Weryfikacja

Lokalnie (Windows, Node 24.21, Docker), 2026-11-10:

| Kontrola | Wynik |
|---|---|
| `ci:lint` (całe repo) | **PASS** 22/22; 4 ostrzeżenia `noNonNullAssertion` w `apps/jobs` sprzed zmiany |
| `ci:typecheck` | **PASS** dla TS 39/39; `apps/analytics` (mypy) — znany błąd tylko na Windows (`os.killpg`), plik nietknięty |
| `ci:unit` | **PASS** 44/44 zadań; nowe: `packages/db/test/retention.test.mjs` (okresy = tabela RODO, konteksty RLS, partie, blokada) 3/3, `apps/jobs/test/retention-runtime.test.mjs` (deduplikacja, metryki bez identyfikatorów, próg audytu) 3/3 |
| `pnpm db:test` (PostgreSQL 18.6) | **PASS**: migracje ×2 idempotentne, `testy-rls.sql` z nowym scenariuszem zaproszeń (`system`: odczyt/usuwanie tylko kwalifikujących się, brak INSERT/UPDATE, granica 30 dni ± 1 min, użyte zostają), katalog bezpieczeństwa, **schema.sql vs migracje: ZERO DIFFERENCES** |
| Integracja retencji (`packages/db/integration/retention.test.mjs`, rola `oliginvest_app`, FORCE RLS) | **PASS** 3/3: granice wszystkich okresów (kwoty 7 × 24 h ± minuty, doręczenia 180 dni, RUM 90 dni, zaproszenia 30 dni, pliki `expires_at`), eksport: archiwum wyczyszczone, metadane zostają; partie po 2; drugi przebieg = 0 wierszy; dwa równoległe przebiegi usuwają łącznie dokładnie tyle, ile się kwalifikuje; trzymana blokada pomija tylko zakres jednego właściciela; audyt: brak `DELETE` dla roli aplikacji |
| `pnpm queues:test` (Valkey) | **PASS**, w tym `test-retention-queue.mjs`: powtórne wyzwolenie → 1 oczekujące, brak drugiego przebiegu w trakcie aktywnego, kolejny po zakończeniu |
| `check:docs`, `check:repository`, `check:deps`, `test:scripts` | **PASS** (125 dokumentów; 115/115 testów skryptów) |
| Skan sekretów z CLAUDE.md | 4 trafienia identyczne z `origin/main` (istniejące syntetyczne fixtures), **0 w zmianie** |

CI (GitHub Actions) — do sprawdzenia przez właściciela w PR.

## 4. Pytania do właściciela

1. **Metadane eksportu RODO:** jak długo trzymać wiersz `identity.data_exports` po wyczyszczeniu
   archiwum (status, rozmiar, daty)? Obecnie do usunięcia konta (kaskada). Brak liczby w dokumentacji.
2. **Wykorzystane zaproszenia:** retencja nieokreślona (zawierają e-mail i `used_by`). Zostają bez zmian.
3. **Usunięcie konta a zaproszenia (dla BL-114):** `identity.invitations.invited_by` i `used_by`
   wskazują `auth.users` bez akcji `ON DELETE` — usunięcie konta, które zaprosiło kogoś lub użyło
   zaproszenia, kończy się błędem FK (wykryte testem integracyjnym). Rozwiązanie (kaskada, `SET NULL`,
   pseudonimizacja) należy do BL-114 i wymaga decyzji.
4. **Audyt 2 lata przed progiem 1 mln wierszy:** przy małym ruchu wpisy starsze niż 2 lata mogą
   powstać przed progiem partycjonowania, a rola aplikacji nie może ich usunąć (ADR-004). Czy
   akceptujemy to do progu, czy potrzebna jest okresowa procedura roli migracji (runbook/ADR)?
5. **Retencje bez zadania w backlogu:** wiersze importu (1 rok po zatwierdzeniu), `idempotency_keys`
   (24 h), `bars_intraday` i `news_items` (90 dni) — do którego zadania je przypisać?

## 5. Ograniczenia i odchylenia

- Folder z polecenia (`C:\Users\Igor\Desktop\OligInvest-bl-115`) pozostał nietknięty; praca w worktree
  sesji z tą samą bazą, wypchnięta jako `feat/bl-115-retention`.
- drizzle-kit `generate --custom` nie ładuje eksportów workspace (jak w BL-215) — migracja 0011,
  wpis dziennika i migawka (kopia 0010, polityk RLS Drizzle nie modeluje) dopisane ręcznie;
  zgodność potwierdza porównanie `schema.sql` z migracjami.
- Rozmiar partii 500 to parametr implementacji, nie okres retencji. Bez nowych zależności, zmian
  progów, retry i timeoutów. Bez zmian w `apps/web`, `packages/i18n`, `packages/core`,
  `apps/api/src/auth/*`, `.github/workflows/*`, `infra/caddy`.
- Estymata 1 d bez zmian; nakład niezmierzony. Bez nowego ADR, ryzyka i kosztu. PR pozostaje draftem.
