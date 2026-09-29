# M0-1 — stan bieżący

**Cel:** przekazać stan i następny krok; poprzednie dowody w [historii](m0-1-session-history.md).

**2026-09-29**, gałąź `feat/m0-1-skeleton`, [roboczy PR #2](https://github.com/Ipper18/OligInvest/pull/2), bez scalania. Node 24.21.0, pnpm 12.4.2, Python 3.13.13; uv `.git/tools/uv-0.12.16/uv.exe` (PATH lub `UV_BIN`). `packages/core` rozwijany osobno w PR #3 — bez zmian.

## BL-011 — etap generatora wykonany

Zatwierdzony prywatny workspace `tools/openapi-client`, wyłącznie devDependencies: openapi-typescript 7.13.0 i TypeScript 5.9.3. Aplikacja web nadal TS 7.0.2. Strict peers i karencja bez wyjątków. Typy `apps/web/src/api/schema.d.ts` commitowane; kontrola aktualności w contracts. Renovate osobno, TS generatora < 6. Wyjątek opisany w stosie, BL-032 i R-20, bez ADR.

Instalacja frozen, generowanie i kontrola aktualności PASS; negatywna kontrola nieaktualnego pliku PASS. check:deps oraz 36 testów granic PASS (w tym zakaz narzędzia z apps/modules/packages). Dalej: nonce/CSP, klient serwerowy, tokeny i motywy, testy produkcyjnego web. Estymacja 3 d bez zmiany; nakład niezmierzony.

## Dotychczasowy stan paczki

BL-001–010/013–015/034 wykonane lokalnie; BL-032 technicznie zamknięty. Statusy `w toku` do wspólnego DoD. BL-013: osiem kolejek i sonda PING/heartbeat; BL-014: Node → Python ACK, bez analiz i DB. Oba workery wymagają jawnego NODE_ENV i plików sekretów w produkcji. W dev aplikacje na hoście; pytest blokuje gniazda poza Valkey, izolacja systemowa analytics od M3 (ADR-003).

BL-034: `pnpm dev` przygotowuje Compose, migracje i seed oraz uruchamia cztery aplikacje. Seed zachowuje leksemy kwot, RLS i expected; idempotencja oraz rollback potwierdzone. Konto bez hasła/MFA bypass; auth w M1. Instrukcja: [środowisko dev](../07-wdrozenie/srodowisko-deweloperskie.md).

Ostatnie dowody kodu (2026-09-28): monorepo 88/88 PASS; jobs 5 testów; Python 9 PASS + 1 integracyjny przez runner; queues:test, db:seed:test, dev:test PASS. Baza: 12 testów pul, RLS/audyt, ZERO DIFFERENCES. Logi `.git/m0-workers/` i `.git/bl007-db/`.

CI rewizji `0096fd4` PASS: [workers](https://github.com/Ipper18/OligInvest/actions/runs/36474677562), [db](https://github.com/Ipper18/OligInvest/actions/runs/36474677512), [modules](https://github.com/Ipper18/OligInvest/actions/runs/36474677505), [contracts](https://github.com/Ipper18/OligInvest/actions/runs/36474677553); CodeQL i Analyze (python) SUCCESS.

Dalej BL-011/012/016/018/033, pełne CI BL-017, ustawienia BL-019 i pozostałe BL-035. Ruleset nadal disabled. P-01–P-06 w historii; P-07 poza zakresem, P-08/P-09 przy M0-2. M0 otwarty: kryteria 1–3 mają wcześniejsze dowody, 4–7 wymagają dalszych prac/właściciela, 8 częściowo. Serwery i ustawienia GitHub bez zmian.
