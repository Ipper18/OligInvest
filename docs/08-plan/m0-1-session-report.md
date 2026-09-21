# M0-1 — stan bieżący

**Cel:** przekazać krótki stan paczki i następny krok. Plik nadpisywany po sesji (ok. 3 KB); [historia](m0-1-session-history.md) uzupełniana najwyżej 10 liniami na zamknięty etap.

Stan: **2026-09-21**, `feat/m0-1-skeleton`, [roboczy PR #2](https://github.com/Ipper18/OligInvest/pull/2), bez scalania. Node 24.21.0, pnpm 12.4.2, Python 3.13.13, uv 0.12.16. Własne CI nieuruchomione; zadania lokalnie wykonane pozostają `w toku` do DoD.

| Zakres | Stan / brakujące prace |
|---|---|
| BL-001/002 | lokalnie 88/88; brak CI |
| BL-003/004 | granice warstw i generator: todo |
| BL-005/006 | konfiguracja i platforma wykonane lokalnie; brak CI |
| **BL-007 etap 1** | zamknięty, push `4b4d656`: 64 tabele, migracje, 40/40 |
| **BL-007 etap 2** | **zamknięty: zero różnic w pełnym schemacie** |
| BL-007 etapy 3–4 | RLS i uprawnienia do weryfikacji; pule/helper do implementacji |
| BL-008 | CI `db`: todo, po BL-007 |
| BL-009–016, BL-033 | todo; Lighthouse dopiero w BL-016 |
| BL-017/019 | szkice CI i ustawień; aktywacja nadal wymagana |
| BL-018 | lokalne E2E oraz obrazy w M0-2: todo |
| BL-032 | zamknięty [notatką](bl-032-typescript-7-spike.md) |
| BL-034/035 | Compose i kontrola dokumentacji działają; brak seedów, integracji i CI |

Etap 2: `pnpm db:test` PASS na PostgreSQL 18.6 z Compose: migracje od zera, powtórne wykonanie, pełne porównanie właścicieli, ACL, RLS, funkcji, triggerów i komentarzy — zero różnic. Test CHECK odrzuca `2026-09-19x1`, przyjmuje `2026-09-19.1`; przed poprawką był czerwony. Poprawiono błędy własnego odwzorowania: escapowanie ukośnika oraz osiem indeksów DESC (z jawnym NULLS FIRST). Lint/typecheck/test/build modułów i db: 40/40 PASS. Źródłowe SQL i polityki niezmienione. Logi i dumpy w `.git/`; tymczasowy projekt usuwany po teście.

Decyzje: BL-002 jest spełnioną zależnością; Turbo 2.10.13 (ADR-015); bullmq 6.3.6/3.2.2 i psycopg 3.3.5; karencja bez wyjątków; TS strict + skipLibCheck; sieć dev `internal: false`, porty na loopback; high/critical blokują deps-audit, wyjątek OSV esbuild do 2026-12-20 (R-24); ruleset bez wymaganych zatwierdzeń, przegląd właściciela obowiązkowy, CodeQL domyślny po scaleniu.

Następnie: etap 3 (role, uprawnienia, `testy-rls.sql`), etap 4 (pule i helper, izolacja także po błędzie), BL-008. Błędy własnego odwzorowania poprawiać bez pytania; zatrzymanie tylko przy podejrzeniu błędu `schema.sql` lub `testy-rls.sql`. Estymacja BL-007: 4 d, odchylenie niezmierzone. Brak nowego ADR/ryzyka. M0: kryterium 1 częściowo, 2 otwarte do RLS/CI, 3 niewykonane, 7 zależy od właściciela, 8 częściowo (BL-032).
