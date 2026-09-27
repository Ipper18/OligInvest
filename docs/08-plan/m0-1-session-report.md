# M0-1 — stan bieżący

**Cel:** przekazać stan i następny krok. Nadpisywany po sesji; [historia](m0-1-session-history.md) najwyżej 5 linii na sesję.

**2026-09-27**, gałąź `feat/m0-1-skeleton`, [roboczy PR #2](https://github.com/Ipper18/OligInvest/pull/2), bez scalania. Node 24.21.0, pnpm 12.4.2; lokalny uv: `.git/tools/uv-0.12.16/uv.exe` (katalog w PATH). `packages/core` bez zmian; rozwijany osobno w PR #3.

| Poprawka przeglądu | Commit (wypchnięty) | Wynik |
|---|---|---|
| P-01 / BL-009 | `e736f0e` | Jedno wykonanie sond ready naraz; cache sukcesu i awarii 3 s od zakończenia, osobny kontekst każdego żądania |
| P-02 / BL-005/009 | `877bb9a` | NODE_ENV wymagane; `.env.example` i instrukcja przyszłego Compose/jobs/analytics; test produkcji: pliki sekretów i HTTPS |
| P-03 / BL-007/008 | `cb730c6` | schema.sql i model danych; app/auth 5/10/2 s, analytics 60/60/2 s; migracja administracyjna, test realnych timeoutów |
| P-06 / BL-007 | `51e13d4` | RESET ALL przed zwrotem do puli; izolacja ustawień kolejnego użytkownika na tym samym połączeniu |
| P-04 / BL-017/019 | `733d87c` | Nieaktywny ruleset wymaga db i modules; dokumentacja dodawania przyszłych kontekstów w BL-017 |
| P-05 / BL-003 | `7a4f24c` | Skanowanie źródeł całego pakietu, także components/lib i nowych katalogów; jawne wyłączenia narzędzi/testów/generatów |
| BL-010 (korekta źródła) | `1e98c21` | Bez 429 dla live/ready/openapi.json; HealthStatus `additionalProperties: false`; trzy punktowe wyjątki Redocly |
| BL-010 | `bcc5e39` | Zod → OpenAPI dla 3 operacji, 182 pending ze skryptu, pending tylko maleje względem bazy Git; 25 testów kontraktowych |
| BL-010 CI | `a9bab03` | Workflow API contracts (`contracts`) z SHA gałęzi bazowej; ruleset (disabled) wymaga db, modules, contracts |

Dowody lokalne: API **42 testy PASS** i lint/typecheck/test/build; db lint/typecheck/test/build PASS; PostgreSQL **18.6**, **12 testów integracyjnych PASS**, niezmienione testy RLS i audyt katalogu PASS, **porównanie schematu ZERO DIFFERENCES**. Ustawienia ról porównywane osobno przed/po wzorcu (role są globalne). Testy regresji najpierw odtwarzały błędy. Wszystkie **74 testy skryptów PASS**, w tym 33 granic; check:deps/docs/repository PASS. Pełne monorepo **88/88 PASS z cache**. Logi wyłącznie w `.git/`.

CI commita `a9bab03`: **PASS** — [API contracts](https://github.com/Ipper18/OligInvest/actions/runs/36348963637), [Database](https://github.com/Ipper18/OligInvest/actions/runs/36348963611), [Module boundaries](https://github.com/Ipper18/OligInvest/actions/runs/36348963645). API **67 testów PASS**.

Stan paczki: BL-001–010 i BL-015 wykonane lokalnie; BL-032 spike zamknięty technicznie. BL-017/019 częściowe (aktywne db/modules, pozostałe CI i ustawienia do realizacji). BL-034/035: Compose i dokumentacja, brak seedów/integracji/pełnego CI. BL-011–014, BL-016/018/033 pozostają otwarte. Statusy `w toku` do wspólnego DoD; nie oznaczają braku lokalnej implementacji zależności. Integracja API z rzeczywistymi usługami 13/13 z 2026-09-22 w historii, stałego testu w CI nadal brak.

Dalej: **BL-013/014/034** (sesja B w prompty-codex § 3.3), pozostałe zadania M0-1 i pełne CI w BL-017. P-07 poza zakresem; P-08/P-09 przy Caddy w M0-2. M0 otwarty: kryterium 1 lokalnie PASS, 2 PASS, 3 PASS (CI contracts), 4–7 dalsze prace/właściciel, 8 częściowo. Estymacje bez zmian; odchylenie nakładu niezmierzone. Brak nowych ryzyk i ADR. Bootstrap ról → `packages/db/admin-migrations/0001-role-timeouts.sql` jako administrator → migracje właściciela → odnowienie pul (instrukcja w model-danych § 5.3).

Decyzje bez zmian: Turbo 2.10.13 (ADR-015), TypeScript 7 strict + skipLibCheck, karencja bez wyjątków, sieć dev internal:false/loopback, OSV esbuild do 2026-12-20 (R-24), 0 zatwierdzeń i przegląd właściciela. Repozytorium i serwery nie były konfigurowane; ruleset pozostaje disabled.
