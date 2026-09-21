# M0-1 — stan bieżący

**Cel:** przekazać bieżący stan i następny krok. Plik nadpisywany po sesji (ok. 3 KB); [historia](m0-1-session-history.md) najwyżej 10 linii na zamknięty etap.

**2026-09-21**, gałąź `feat/m0-1-skeleton`, [roboczy PR #2](https://github.com/Ipper18/OligInvest/pull/2), bez scalania. Node 24.21.0, pnpm 12.4.2, Python 3.13.13, uv 0.12.16. Własne CI nadal nieaktywne; zadania pozostają `w toku` do wspólnego DoD.

| Zakres | Stan |
|---|---|
| BL-001/002, BL-005/006 | wykonane lokalnie, brak CI |
| BL-003/004 | granice warstw i generator: todo |
| **BL-007** | **lokalnie 4/4 etapów zamknięte**; brak CI/DoD |
| BL-008 | następny: CI `db` |
| BL-009–016, BL-033 | todo; Lighthouse dopiero w BL-016 |
| BL-017/019 | szkice workflow i ustawień, aktywacja wymagana |
| BL-018 | lokalne E2E i obrazy M0-2: todo |
| BL-032 | zamknięty [notatką](bl-032-typescript-7-spike.md) |
| BL-034/035 | Compose i dokumentacja PASS; brak seedów/integracji/CI |

BL-007: etap 1 `4b4d656` (64 tabele, migracje); etap 2 `8528402` (PostgreSQL 18.6, migracje od zera/powtórnie, pełny pg_dump — zero różnic); etap 3 `fbff68e` (niezmieniony testy-rls.sql i audyt ról/uprawnień/całego RLS PASS). Etap 4: osobne pule app/auth/analytics, Zod strict, parametryzowane SET LOCAL, weryfikacja roli, savepointy, czyszczenie kontekstu i usuwanie uszkodzonych połączeń.

Dowody etapu 4: 9 testów integracyjnych PASS (równoległość, ten sam PID po COMMIT/ROLLBACK i błędzie SQL, przechwycony błąd, zmiany sesyjne, savepoint, zerwane połączenie, brak kontekstu, izolacja ról); pełne lint/typecheck/test/build 88/88 PASS. `pnpm db:test` nadal daje zero różnic i PASS RLS. Test CHECK odrzuca 2026-09-19x1, przyjmuje 2026-09-19.1. Poprawiono własne błędy escapowania CHECK i ośmiu indeksów DESC/NULLS FIRST. Źródła SQL i polityki bez zmian; logi wyłącznie w .git, kontenery testowe usuwane.

Decyzje: BL-002 spełnione; Turbo 2.10.13 (ADR-015); bullmq 6.3.6/3.2.2, psycopg 3.3.5; karencja bez wyjątków; strict + skipLibCheck; sieć dev internal:false/loopback; high/critical blokują deps-audit, wyjątek OSV esbuild do 2026-12-20 (R-24); ruleset 0 zatwierdzeń i obowiązkowy przegląd właściciela, domyślny CodeQL po scaleniu. Zatrzymanie tylko przy podejrzeniu błędu schema.sql/testy-rls.sql; własne błędy poprawiać samodzielnie.

Dalej: BL-008, commit/push po zamknięciu. BL-007: 4 d bez zmiany, odchylenie niezmierzone, brak nowego ADR/ryzyka. M0: 1 częściowo, 2 lokalnie PASS/brak CI, 3 otwarte, 7 działania właściciela, 8 częściowo.
