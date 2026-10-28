# M4 — backend: stan bieżący

**Cel:** przekazać stan BL-403/404/405 i backendu BL-407/408 oraz poprawki CI [PR #38](https://github.com/Ipper18/OligInvest/pull/38).

**2026-10-28**, `feat/m4-backend`, osobny worktree. Scalony `origin/main` do `4115e8a` (#41), po #37/#36/#39/#23. Caddy, zależności i wyjątki audytu wyłącznie ze scalonych PR. Statusy `w toku` do CI i wspólnego DoD.

## Zakres

Powiadomienia e-mail/fallback, cisza i deduplikacja; rezerwa 50 z 300 prób SMTP/dobę. Alerty cenowe, histereza/cooldown, blokada stale/BLOCK, fakty bez kwot portfela i zaleceń. PAT hash-only/CSPRNG, step-up, zakresy, przypomnienia, replay bez sekretu. Pięć `/quick/*`, tekstowe pieniądze, niepełne dane jako 200/null/incomplete/powody.

TS2883 poprawiono jawnymi typami bez zmiany tsconfig. **Test integracyjny limitera poczty ujawnił błąd produkcyjny:** adapter BullMQ/ioredis wymaga `incr`/`expire`, a wywołania `INCR`/`EXPIRE` powodowały TypeError. Poprawiono nazwy; limity, rezerwa i odmowa przy braku konfiguracji pozostają.

## Zimny import quick-actions

Wcześniej usunięto importy całych `portfolio/server` i `market/server` (trasy, importy brokerskie, przeliczanie i cykl routes/watchlist-routes). API przekazuje istniejące odczyty do QuickRepository; graf Node zmalał z 362 do 298 modułów. Kontrakty, Decimal, SQL i walidacja pozostają wymagane. Bez kopiowania logiki lub odraczania importu na żądanie.

CI `6f30097`: test zależności 5354 ms, smoke server 2308 ms. Smoke wcześniej ładuje kontrakty; test zależności zaczyna od zimnego grafu. Importy statyczne w testach projekcji są mierzone podczas kolekcji. Izolacja plików pozostaje włączona, kolejności nie zmieniono.

Dodano log `[quick-import:vitest/node]`: zimny import (wall/CPU), odczyty modułów, wskazane zależności i ponowny import z cache. Node działa w osobnym procesie po Vitest: pusty cache modułów, ale wspólny cache plików OS i zmienne obciążenie. Log Vitest pokazuje też koszt importów obsługiwanych przez Vite. Czas `native-load` nie obejmuje kompilacji/ewaluacji ani transformacji/RPC; zero oznacza brak odczytu przez ten hook, nie brak zależności.

Lokalnie przy równoległym Turbo: **Vitest 1216 ms / CPU 625 ms, Node 409 ms / CPU 422 ms**, odczyt plików 59/46 ms, ponowny import 0 ms. Narzut runnera i oczekiwanie są istotne; dokładny udział transformacji w CI wymaga nowego logu. Nie ma dowodu, że winne są same tłumaczenia lub kolejny cykl.

**Wyjątek zaakceptowany przez właściciela:** tylko test zimnego importu i odczytów ma 15 s (z komentarzem), by objąć startup i porównanie Node. Globalnie i dla smoke nadal 5 s. Wszystkie asercje zachowane; celowe dodanie importu `market/server` nadal daje FAIL. Pomiar CI trafia do logu jobów unit/db, bez osobnych raportów JSON.

## Weryfikacja i ograniczenia

- Quick-actions: 9/9 PASS; lint/typecheck PASS. Zmienione pakiety i zależne: 83/84 zadań PASS, API readiness przekroczył lokalny próg 3500 ms o 7 ms; pełne API z `maxWorkers=2`: 93/93 PASS. W pierwszej próbie pod obciążeniem także timeout smoke API; bez zmian jego limitu.
- Natywny mypy Windows: znany `os.killpg` z M3; `--platform linux`: PASS (12 plików). `uv` dostępne, brak pominięć z powodu jego braku. Obrazów/E2E/DB nie powtarzano dla zmiany diagnostyki testu; wcześniejsze dowody integracji i buildów w PR.
- CI sprawdzane raz po pushu, bez czekania/pollingu. Anulowane matrix.check/matrix.name ignorowane; WebKit internal error pozostaje **R-41**, bez naprawy w tej paczce.

## Pozostało

PWA/Web Push, ekrany (także PAT), Skróty i testy urządzeń w kolejnej paczce; M4 niezamknięte. Estymata 11,5 dnia obejmuje odłożony ekran PAT; rzeczywisty nakład niezmierzony. Bez nowego ADR i ryzyk w tej sesji; ryzyko paczki **R-45**: duplikat SMTP po wysłaniu przed zapisem potwierdzenia.
