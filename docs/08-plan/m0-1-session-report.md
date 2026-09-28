# M0-1 — stan bieżący

**Cel:** przekazać stan i następny krok. Raport nadpisywany; poprzednie dowody w [historii](m0-1-session-history.md).

**2026-09-28**, gałąź `feat/m0-1-skeleton`, [roboczy PR #2](https://github.com/Ipper18/OligInvest/pull/2), bez scalania. Node 24.21.0, pnpm 12.4.2, Python 3.13.13; uv `.git/tools/uv-0.12.16/uv.exe` (do PATH lub `UV_BIN` dla runnera kolejek). `packages/core` i seed źródłowy bez zmian; core rozwijany w PR #3.

BL-013: BullMQ 6.3.6, osiem uchwytów kolejek z katalogu § 5.2, rejestry BL-006 i puste harmonogramy, bez konsumentów domenowych. Sonda PING + heartbeat instancji ≤ 10 s. Sterownik ioredis 6.0.0 (MIT, publikacja 2026-07-31); uzasadnienie w stosie, instalacja frozen i karencja PASS.

BL-014: Python potwierdza `ping` na `analytics-smoke`, waliduje zamknięty payload i UUID; bez analiz, zapytań DB i nowych zależności Pythona. P-02 w obu workerach: jawne NODE_ENV, pliki sekretów w produkcji. Uzgodnione przez właściciela: wszystkie aplikacje dev na hoście; fixture pytest blokuje gniazda poza Valkey; systemowa izolacja analytics od M3, bez zmiany ADR-003.

BL-034: `pnpm dev` przygotowuje Compose, role/migracje i seed, uruchamia api/web/jobs/analytics. Kwoty seeda z oryginalnych leksemów JSON do NUMERIC; zapis portfela z RLS. Wszystkie expected sprawdzane na bazie, rollback przy rozbieżności, ponowny seed bez duplikatów. Konto bez hasła/MFA bypass (auth w M1). Konfiguracja NODE_ENV i DEV_* według [instrukcji](../07-wdrozenie/srodowisko-deweloperskie.md).

Dowody lokalne: monorepo **88/88 PASS** (częściowo cache), jobs **5 testów**, Python **9 PASS + 1 integracyjny pomijany poza runnerem**; `queues:test`: prawdziwy Valkey, katalog, sondy negatywne, Node → Python ACK i blokada gniazd PASS. `db:seed:test`: 4788 cen, 1596 kursów, 19 operacji, wszystkie expected, rollback/idempotencja PASS. `dev:test`: cztery procesy, gotowość API/bazy/obu Valkey, web i SMTP/Mailpit PASS. `db:test`: PostgreSQL 18.6, RLS/audyt, 12 testów pul i **ZERO DIFFERENCES**. deps/docs/repository PASS. Logi w `.git/m0-workers/` i `.git/bl007-db/`.

Nowy workflow `workers` obejmuje pakiety i trzy integracje Compose; wynik CI po push do uzupełnienia. db/modules/contracts aktywne; ruleset nadal disabled. BL-001–010/013–015/034 wykonane lokalnie, BL-032 technicznie zamknięty. Statusy `w toku` do wspólnego DoD. Dalej BL-011/012/016/018/033, pełne CI BL-017, ustawienia BL-019 i pozostałe BL-035. P-01–P-06 w historii; P-07 poza zakresem, P-08/P-09 przy M0-2.

M0 otwarty: kryteria 1–3 mają dowody lokalne/dotychczasowe CI; 4–7 dalsze prace/właściciel, 8 częściowo. Estymacje bez zmian, odchylenie nakładu niezmierzone. Bez nowych ryzyk/ADR. Serwery i ustawienia GitHub nie były zmieniane.
