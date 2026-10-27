# M4 — backend: stan bieżący

**Cel:** przekazać stan BL-403/404/405 i backendu BL-407/408 oraz poprawki CI PR #38.

**2026-10-27**, `feat/m4-backend`, osobny worktree, [draft PR #38](https://github.com/Ipper18/OligInvest/pull/38). Poprawki zapisane w `8e61c04`, następnie merge `89ea2cc` z `origin/main` do `2477dea`: #37 (zależności), #36 (demo) i #39 (analizy). Konflikt rejestru ryzyk rozwiązany przez zachowanie R-45 oraz R-46–R-49 z main. Statusy `w toku` do zielonego CI i wspólnego DoD.

## Zakres backendu

Powiadomienia e-mail/fallback, ciche godziny i deduplikacja; rezerwa 50 z 300 prób SMTP/dobę. Trzy alerty cenowe z histerezą/cooldownem, blokadą stale/BLOCK, czasem i źródłem danych, bez kwot portfela i zaleceń. PAT: CSPRNG/hash, step-up, zakresy, limity, odwołanie, nowa sieć i przypomnienia; replay 24 h bez sekretu. Pięć `/quick/*`, tekstowe pieniądze z przecinkiem/kropką; niepełna wycena to 200, null, `incomplete` i powody.

## Poprawki znalezione przez CI i test

- TS2883: jawne adnotacje `alertsModule`, `quickModule`, `conflictError` i `rateLimitedError`, oparte na publicznych eksportach. Zachowane opcjonalne ładowanie modułów; tsconfig bez zmian.
- `test-monitoring.mjs` konfiguruje prawdziwy limiter na Valkey. Sprawdza naliczenie puli zwykłej/całkowitej i odmowę wysyłki po 250 zwykłych próbach. Produkcyjna odmowa przy braku konfiguracji pozostaje.
- **Test integracyjny ujawnił dodatkowy błąd limitera poczty:** `runCommand` adaptera BullMQ/ioredis wywołuje metodę klienta o podanej nazwie; wielkie `INCR`/`EXPIRE` powodowały `TypeError`. Produkcyjne wywołania poprawiono na `incr`/`expire`. Nie zmieniono limitów, rezerwy ani kontroli błędów.
- Nie naprawiano samodzielnie deps-audit, zależności ani `osv-scanner.toml`; aktualizacje weszły wyłącznie przez merge #37.

## Dowody po scaleniu

- Pełne `pnpm ci:build -- alerts` oraz `-- quick-actions`: **21/21 PASS każdy**, świeże kopie z frozen install, deklaracjami TS i buildem web/Python.
- Zmienione pakiety i zależne: lint/typecheck **60/60 PASS**; unit **42/42 PASS** przy `--concurrency=1` i `--maxWorkers=2`, bez zmiany timeoutów. Core: 99,58% linii, 100% funkcji. Wcześniej równoległe uruchomienie miało timeouty smoke (5 s), a web zgłosił za mały plik stronicowania Windows/SWC; powtórzenia po ograniczeniu równoległości przeszły.
- `pnpm db:test`: PASS, PostgreSQL 18.6, RLS/izolacja, PAT/notifications/alerts/quick, zero różnic schematu. Monitoring: PostgreSQL + Valkey + Mailpit, restart/retry i limit SMTP PASS (lokalnie przekierowano wyłącznie katalog logów runnera do git-dir worktree).
- Granice modułów, dokumentacja/repozytorium, klient API i OpenAPI **93 implemented / 92 pending**: PASS. `uv` dostępne; nie ma pominięć przez jego brak. Python unit i pełne E2E/obrazy pozostawiono CI w tej poprawce.
- CI: jedno końcowe sprawdzenie po pushu, bez oczekiwania/pollingu; wynik w podsumowaniu sesji.

## Pozostało

M4 nie jest zamknięte: PWA/Web Push, ekrany (w tym PAT), Skróty i testy urządzeń w kolejnej paczce. Zależność od BL-402 odłożona przez właściciela. Estymata paczki 11,5 dnia obejmuje odłożony ekran PAT, rzeczywisty nakład niezmierzony. Bez nowego ADR. Ryzyko M4 **R-45**: duplikat SMTP po awarii między wysłaniem a zapisem potwierdzenia; brak nowych ryzyk w tej poprawce CI.
