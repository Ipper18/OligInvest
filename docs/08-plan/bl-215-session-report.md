# BL-215 — limity ról: stan sesji

**Cel:** przekazać stan backendu limitów ról po decyzji właściciela R-52.

**2026-11-06** (zamknięcie sesji), `feat/bl-215-role-limits`, worktree `OligInvest-bl-215`,
baza `origin/main` 7b0a841, [draft PR #56](https://github.com/Ipper18/OligInvest/pull/56).
Status **w toku** do zielonego CI i wspólnego DoD; R-52 zamknięte decyzją
właściciela z 2026-11-05. BL-131 wykonane lokalnie (AGENTS.md § 6.1).

## Zrobione

- Polityka user/pro/admin w platform, ścisły kontrakt migawki w contracts;
  429 problem+json z Retry-After do północy Europe/Warsaw, także przy zmianie czasu.
- Migracja **0010_role-quota-usage** i Drizzle: trwały rejestr
  `platform.role_quota_usage` (operation_id, user_id, quota_key, consumed_at).
  Brak FK do analizy; FK do konta z kaskadą. FORCE RLS właściciela, brak UPDATE;
  DELETE tylko własnych wpisów starszych niż 7 × 24 h.
- Każda przyjęta ciężka analiza zużywa kwotę, również po anulowaniu, błędzie
  lub usunięciu. INSERT zużycia i analizy w tej samej transakcji i pod istniejącą
  blokadą użytkownika. Replay idempotencji nie dopisuje zużycia; rollback je cofa.
  Licznik czyta wyłącznie rejestr. Konfiguracja role_limits bez cache.
- Retencja dopisana do **BL-115**; bez nowego zadania i bez implementacji sprzątania.
  Zaktualizowane MOD/KONW, schema.sql, testy-rls.sql, model danych, RODO i ryzyka.

## Weryfikacja

- Lint/typecheck/test zmienionego backendu i zależnych pakietów: **57/57 PASS**.
- `pnpm db:test`: PostgreSQL 18.6, RLS/katalog bezpieczeństwa PASS;
  schema.sql vs migracje **ZERO DIFFERENCES**. Test upgrade jako rola migracji:
  backfill ciężkich analiz z ostatnich 7 dni, niezależność od usunięcia wyniku,
  kaskada usunięcia konta. RLS: izolacja user/admin/system, obcy INSERT/DELETE,
  zakaz UPDATE, granica 7 dni.
- Integracja API: utwórz → usuń → zużycie bez zmian → 429; trzy równoległe
  żądania na ostatnie miejsce → **202/429/429**, jeden wpis i jedno zadanie.
  Ponadto idempotencja, zmiana budżetu bez restartu, DST 23/25 h i rollback.
- OpenAPI **98 wdrożonych / 88 pending PASS**; format HTTP bez zmian.
  Kontrole dokumentacji, repozytorium, zależności i diff PASS. Skan sekretów:
  4 istniejące syntetyczne fixtures jak w origin/main, zero nowych trafień.

## Ograniczenia i odchylenia

- Wdrożenie: zatrzymać stare API przed migracją, potem uruchomić nową wersję.
  Backfill obejmuje zachowane analizy; wcześniej usuniętych nie można odtworzyć.
- CLI drizzle-kit nie ładuje eksportów ESM core; metadane nowej tabeli i SQL
  wygenerowano istniejącym API drizzle-kit z kompilowanego schematu. FK/RLS/backfill
  dopisane jak pozostałe rozszerzenia PostgreSQL; zgodność sprawdzona na bazie.
- Bez zmian apps/web/packages/ui, nowych zależności, retry i zmian progów/timeoutów.
  UI/Python/obrazy w CI; zgodnie z poleceniem właściciela z 2026-11-06 CI nie
  odczytywano w tej sesji — wynik sprawdza właściciel.
- Pozostałe limity i panel BL-503 poza zakresem. Estymata 1,5 d bez zmian;
  nakład i odchylenie niezmierzone. Bez nowego ADR, kosztu, usługi i nowych ryzyk.
  M2 nie jest zamykane; pozostałe kryteria roadmapy poza sesją. Bez zmian wzorów
  i metodologii analiz FR-04. PR pozostaje draftem, bez scalania.
