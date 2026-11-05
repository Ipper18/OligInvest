# BL-215 — limity ról: stan sesji

**Cel:** przekazać zakres backendu, dowody i nierozstrzygnięte wymagania limitów ról.

**2026-11-05**, gałąź `feat/bl-215-role-limits`, osobny worktree
`OligInvest-bl-215`, baza `origin/main` **7b0a841**. Status **w toku** do CI,
przeglądu właściciela, DoD i rozstrzygnięcia R-52. BL-131 wykonane lokalnie;
zależność spełniona według AGENTS.md § 6.1 i raportu M1-2.

## Zrobione

- `platform`: rozstrzygnięcie limitu user/pro/admin i odmowa `QUOTA_EXCEEDED`.
  Pro/admin domyślnie 20 (istniejące MOD § 5.2.1), zero blokuje; błędna
  konfiguracja nie uruchamia wartości domyślnej. `contracts`: ścisły schemat
  migawki limitu, zużycia, chwili oceny i odnowienia.
- PostgreSQL: konfiguracja z `platform.role_limits` odczytywana bez cache;
  zużycie z `analytics_runs` w RLS. Sprawdzenie i zapis pod istniejącą blokadą
  użytkownika, odtworzenie idempotencji przed limitem. Zegar bazy po blokadzie,
  doba Europe/Warsaw; ten sam czas oceny i `created_at`.
- `429`, `application/problem+json`, `QUOTA_EXCEEDED`, `no-store`, `Retry-After`
  do następnej północy, także w dni zmiany czasu. Bez zmiany formatu HTTP Problem.

## Weryfikacja

- Node 24.21.0, pnpm 12.4.2, instalacja frozen; bez zmiany manifestów i lockfile.
- Lint/typecheck/test zmienionego backendu i zależnych pakietów: 54/54 zadań PASS.
- `pnpm db:test`: PostgreSQL 18.6, RLS i katalog bezpieczeństwa PASS, schemat
  ZERO DIFFERENCES. Nowe przypadki: współbieżność ostatniego miejsca (202/429/429),
  idempotencja przy wyczerpaniu, izolacja, zmiana konfiguracji bez restartu,
  zero/błędna/brakująca wartość, granice północy, doby 23/25 h i rollback.
- Kontrakty OpenAPI: 98 wdrożonych, 88 pending, PASS; HTTP i schemat DB bez zmian.
- Kontrole dokumentacji, repozytorium i granic zależności PASS. Kontrola sekretów
  poleceniem `git grep` z CONTRIBUTING.md § 6: 4 istniejące syntetyczne fixtures,
  identyczne jak w origin/main; zero nowych trafień.
- Pierwszy test DB ujawnił własny błąd odwzorowania timestamp z Drizzle (tekst);
  adapter poprawiony, pełny test DB po poprawce PASS. Bez osłabiania asercji,
  retry, zmian timeoutów lub progów. `pnpm -s` odrzucone przez przypięte pnpm;
  użyto `pnpm exec turbo` i logów w katalogu Git.

## Pominięte, rozbieżności i ryzyka

- **R-52:** istniejące fizyczne usuwanie analizy zmniejsza policzone zużycie.
  Brak zasad trwałości kwoty po usunięciu; nie zgadywano. Propozycja do decyzji:
  określić w KONW/MOD, czy usunięcie zwraca kwotę; jeśli nie, zaprojektować
  trwały rejestr zużycia i jego retencję w schema.sql/RLS przed implementacją.
- Pozostałe pola `RoleLimitValues` nie mają kompletnych zasad naliczania/defaultów;
  bez nowych limitów importów, alertów, watchlist i bez panelu BL-503.
- Bez zmian apps/web i packages/ui; bez lokalnego UI/E2E, Pythona i obrazów.
  CI sprawdzane jednokrotnie po pushu; wynik w PR/chat. Draft bez scalania.
- Estymata 1,5 d bez zmian; brak ewidencji nakładu, odchylenie niezmierzone.
  Bez nowego ADR, usługi, kosztu i zmiany statusu prawnego; bez zmian metodologii
  analiz FR-04. M2 nie jest zamykane — pozostałe kryteria roadmapy poza sesją.
