# BL-567 — backend edycji scenariuszy testów skrajnych

**Cel:** przekazać zakres, dowody i otwarte bramki backendu BL-567 bez zmian redesignowanego UI.

**2026-11-05**, `feat/bl-567-stress-admin`, osobny worktree od `origin/main` (`7b0a841`). Zależność BL-556: backend obecny na main; brak ekranu nie blokuje tego zakresu.

## Zrobione

- Wspólny kontrakt Zod w `packages/contracts`; PUT `adminUpsertStressScenario` w API i zapis w module admin. Istniejący OpenAPI pozostaje zgodny; usunięta jedna operacja z pending.
- Ścisła walidacja klucza, dat i okna ≤ 1096 dni oraz 1–10 szoków (indeks, USD/EUR, korelacja); brak obcych pól i mieszania dat ze scenariuszem hipotetycznym.
- Sesja, MFA, regulamin, step-up TOTP i `admin:system`; PAT i obcy Origin odrzucane. Wyłączona analityka daje 404. Parsowanie wewnątrz granicy audytu obejmuje także odmowy i uszkodzony/za duży JSON.
- Zapis i audyt sukcesu przed/po w jednej transakcji `oliginvest_app`, z aktorem, IP, UA i request ID. Błąd audytu wycofuje zapis. Blokada klucza obejmuje pierwsze utworzenie; zapisuje się `updated_by` i `updated_at`.
- Istniejące RLS i uprawnienia wystarczają: bez migracji i rozszerzania praw auth. Manifesty łączą istniejące pakiety workspace i już przypięty Drizzle; bez nowej biblioteki ani wersji.

## Dowody i granice

Korekta po przeglądzie PR #55 (2026-11-05): `name` używa `trim().min(1).max(80)`; test odrzuca pusty ciąg i same spacje dla obu rodzajów scenariusza oraz sprawdza przycinanie nazwy. OpenAPI uzupełnione o `minLength: 1`, wygenerowany klient pozostaje aktualny bez zmian web/UI. Contracts: **126/126 PASS**. API: **92/93 PASS** — `test/server.test.mjs:82` zmierzył 3869 ms przy istniejącym limicie 3500 ms. Bez retry i zmiany progu; pozostałe testy, w tym zgodność OpenAPI, przeszły. Build API i kontrola formatowania zmienionych plików: PASS. PR pozostaje draftem, CI odczytuje właściciel. Poniższe pełne dowody dotyczą pierwotnej implementacji.

- `pnpm exec turbo run lint typecheck test --filter='...[origin/main]' --output-logs=new-only`: PASS (60 zadań; API 93 testy).
- PostgreSQL 18.6: testy integracyjne, RLS i audyt katalogu uprawnień; porównanie migracji z `schema.sql`: ZERO DIFFERENCES. BL-567 sprawdza odmowy, zmianę rodzaju, wyłączenie scenariusza, idempotentny PUT, równoległe utworzenie i rollback po błędzie audytu.
- Kontrakt OpenAPI: 99 operacji zaimplementowanych, 87 pending. `check:api-client`, `check:deps`, kontrola dokumentacji i repozytorium: PASS.
- Kontrola sekretów `git grep` według CONTRIBUTING § 6: cztery istniejące wartości syntetyczne w testach, brak nowych trafień ani sekretów w zmianie.
- Właściciel przejrzał kod i zgłosił powyższą korektę; CI i wspólne DoD pozostają otwarte, status zadania **w toku**. Bez odczytu CI przez agenta.

## Pominięte, odchylenia i ryzyka

Bez zmian w `apps/web` i `packages/ui`; ekran edycji osobno po scaleniu PR #53. E2E UI/axe nie dotyczy tego zakresu. Bez retry i zmian timeoutów/progów. Nakład niezmierzony, odchylenie od 1 d nieoszacowane. Bez decyzji do ADR i nowych ryzyk; R-49 ma mitygację, zamknięcie po wdrożeniu. Etap M5b nie jest zamykany.

Przegląd metodologiczny: PASS dla zarządzania konfiguracją; nie zmienia wzorów, okien estymacji, proxy, pokrycia ani prezentacji wyników. Ryzyko LOW dla tej zmiany; istniejące R-46/R-47 nadal dotyczą interpretacji analiz. Szczegółowa ocena AGENTS § 7 w PR.
