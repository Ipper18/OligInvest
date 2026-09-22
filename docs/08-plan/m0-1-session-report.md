# M0-1 — stan bieżący

**Cel:** przekazać stan i następny krok. Nadpisywany po sesji; [historia](m0-1-session-history.md) najwyżej 5 linii na sesję.

**2026-09-22**, gałąź `feat/m0-1-skeleton`, [roboczy PR #2](https://github.com/Ipper18/OligInvest/pull/2), bez scalania. Node 24.21.0, pnpm 12.4.2, Python 3.13.13, uv 0.12.16. Zadania wykonane lokalnie: status `w toku` do wspólnego DoD/CI.

| Zakres | Stan |
|---|---|
| BL-001/002, BL-005/006 | wykonane lokalnie |
| BL-003 | `6d733ca`: granice modułów, 28 testów; [CI PASS](https://github.com/Ipper18/OligInvest/actions/runs/35688610340) |
| BL-004 | `6003611` + `042540c`: generator, 21 testów; [CI PASS](https://github.com/Ipper18/OligInvest/actions/runs/35689454452) |
| BL-007/008 | 64 tabele, migracje, RLS i pule; [CI PASS](https://github.com/Ipper18/OligInvest/actions/runs/35687884119) |
| BL-009 | wykonane lokalnie; `74b4dd8`, `4b23266`, `cbce8b8`, `929dae5`, wszystkie wypchnięte; 37 testów API PASS |
| BL-015 | wykonane lokalnie: loadery TS i Python, test zgodności A–H, 7 Vitest + 6 pytest PASS |
| BL-010–014, BL-016, BL-033 | todo; BL-014 nie realizowano, Lighthouse dopiero BL-016 |
| BL-017/019 | szkice pozostałego CI i ustawień; aktywne db i modules |
| BL-018 | lokalne E2E i obrazy M0-2: todo |
| BL-032 | zamknięty technicznie [spike](bl-032-typescript-7-spike.md) |
| BL-034/035 | Compose i dokumentacja PASS; brak seedów/integracji/pełnego CI |

BL-009: Hono i `@hono/zod-openapi`, kontekst BL-006, `X-Request-Id`, bezpieczne RFC 9457 dla wyjątków i 404. Live zawsze 200 bez zależności. Ready równolegle wykonuje `SELECT 1` jako `oliginvest_app` i uwierzytelniony PING obu Valkey; limit każdej sondy 1500 ms, zamykanie połączeń, 200/503 i wyłącznie ok/fail. OpenAPI 3.1 generowany z Zod dla trzech wdrożonych tras. Start i zmienne środowiskowe opisane w [konwencjach API § 4.2](../02-api/konwencje-api.md#42-szkielet-http-i-sondy-bl-009). `pg` i `@types/pg` wykorzystują istniejące wersje lockfile; Valkey przez `node:net`.

Dowody tej sesji: **37 testów API PASS**, lint/typecheck/test/build API PASS; pełne **lint/typecheck/test/build 88/88 PASS z cache**, instalacja frozen offline i kontrole deps/docs/repository PASS. Test procesu Node potwierdza rzeczywiste HTTP, 503 przy milczących połączeniach TCP i zamknięcie gniazd po limicie czasu. Docker jest niedostępny; nie wykonano integracji z prawdziwym PostgreSQL/Valkey. BL-010 (porównanie całego OpenAPI, pending, Redocly) nie było realizowane. Brak dodatkowych plików raportów.

Pominięte zgodnie z zakresem: pozostałe zadania M0 i pełne CI. **Integracja z prawdziwymi usługami potwierdzona 2026-09-22 poza sesją Codexa: 13/13** (szczegóły w historii); stałego testu na prawdziwych usługach w CI jeszcze nie ma. Estymacja BL-009 1 d bez zmian; odchylenie nakładu niezmierzone. Brak nowych ryzyk i decyzji do ADR. BL-015 nadal korzysta wyłącznie z `docs/03-dane/wektory-testowe.json`; tekst kwot i zera końcowe zachowane, jawne konwersje poza API loaderów zabronione.

Decyzje bez zmian: Turbo 2.10.13 (ADR-015), TypeScript 7 strict + skipLibCheck, karencja bez wyjątków, sieć dev internal:false/loopback, wyjątek OSV esbuild do 2026-12-20 (R-24), ruleset 0 zatwierdzeń i przegląd właściciela.

Dalej: najpierw poprawki z [przeglądu kodu](m0-1-przeglad-kodu.md) § 4 (P-01, P-02, P-03, P-06; jeśli wystarczy limitu także P-04, P-05), potem BL-010, pozostałe zadania paczki i pełne CI w BL-017. M0 nadal otwarty: 1 lokalnie PASS, 2 CI PASS, 3 otwarte, 4–7 dalsze prace/działania właściciela, 8 częściowo. Lokalny uv: `.git/tools/uv-0.12.16/uv.exe` (dopisz katalog do PATH).
