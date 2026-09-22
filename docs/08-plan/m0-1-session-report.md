# M0-1 — stan bieżący

**Cel:** przekazać stan i następny krok. Nadpisywany po sesji; [historia](m0-1-session-history.md) najwyżej 10 linii na sesję.

**2026-09-22**, gałąź `feat/m0-1-skeleton`, [roboczy PR #2](https://github.com/Ipper18/OligInvest/pull/2), bez scalania. Node 24.21.0, pnpm 12.4.2, Python 3.13.13, uv 0.12.16. Zadania wykonane lokalnie spełniają zależności; status `w toku` do wspólnego DoD.

| Zakres | Stan |
|---|---|
| BL-001/002, BL-005/006 | wykonane lokalnie |
| BL-003 | commit `6d733ca`: graf, cykle, eksporty/importy, 28 testów z negatywnym CLI; [CI modules PASS](https://github.com/Ipper18/OligInvest/actions/runs/35688610340) |
| BL-004 | generator feature, definicje API/jobs/UI, wyłączona flaga, testy i README; CI rozszerzone o generator |
| BL-007/008 | 64 tabele, migracje bez różnic, role/RLS, 9 testów pul; [CI db PASS](https://github.com/Ipper18/OligInvest/actions/runs/35687884119) |
| BL-009–016, BL-033 | todo; Lighthouse dopiero w BL-016 |
| BL-017/019 | szkice pozostałego CI i ustawień; aktywne db i modules |
| BL-018 | lokalne E2E i obrazy M0-2: todo |
| BL-032 | zamknięty technicznie [spike](bl-032-typescript-7-spike.md) |
| BL-034/035 | Compose i dokumentacja PASS; brak seedów/integracji/pełnego CI |

Dowody: **69 testów skryptów PASS** (28 granic, 21 generatora, 20 wcześniejszych), lint skryptów i check:deps PASS. Generator w izolacji: instalacja frozen, check:deps i lint/typecheck/test/build **5/5 PASS**, w tym 3 testy modułu. Monorepo **88/88 PASS z cache**; build z fizycznie wyjętym education **21/21 PASS bez cache**, moduł przywrócony. **Kryterium M0 nr 1 spełnione lokalnie**; pełna macierz CI w BL-017. Logi `.git/bl003-*` i `.git/bl004-*`, bez nowych raportów JSON.

Generator tworzy tylko pakiet. Pozostałe kroki § 8.1 (kontrakty domenowe, migracje/RLS, router, rejestracja, UI) dotyczą konkretnej funkcji; opisuje je README. Po generacji: `pnpm install --lockfile-only`, instalacja frozen i kontrole z README. Przy pustym cache aktualizacja lockfile potrzebuje metadanych rejestru; usunięto błędne założenie offline z testu CI, bez zmiany polityki karencji.

Decyzje bez zmian: Turbo 2.10.13 (ADR-015); TypeScript 7 strict + skipLibCheck; karencja bez wyjątków; sieć dev internal:false/loopback; wyjątek OSV esbuild do 2026-12-20 (R-24); ruleset 0 zatwierdzeń i przegląd właściciela. Brak nowych zależności zewnętrznych, ADR i ryzyk. Estymacje BL-003/004 po 1 d bez zmian; odchylenie niezmierzone.

Dalej: BL-009/010 i reszta paczki, pełne CI w BL-017. M0 nadal otwarty: 1 lokalnie PASS, 2 CI PASS, 3 otwarte, 4–7 dalsze prace/działania właściciela, 8 częściowo. Lokalny uv: `.git/tools/uv-0.12.16/uv.exe` (dopisz katalog do PATH).
