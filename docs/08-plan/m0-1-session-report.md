# M0-1 — stan bieżący

**Cel:** przekazać stan i następny krok; poprzednie dowody w [historii](m0-1-session-history.md).

**2026-09-29**, gałąź `feat/m0-1-skeleton`, [roboczy PR #2](https://github.com/Ipper18/OligInvest/pull/2), bez scalania. Node 24.21.0, pnpm 12.4.2, Python 3.13.13; uv `.git/tools/uv-0.12.16/uv.exe` (PATH lub `UV_BIN`). `packages/core` rozwijany osobno w PR #3 — bez zmian.

## Następny krok: decyzja w BL-011

Architektura UI § 3 wymaga `openapi-typescript@7.13.0`, który deklaruje peer `typescript: ^5.x`; projekt ma zatwierdzony w BL-032 TS 7.0.2. Próba dodania generatora do lockfile zwróciła `ERR_PNPM_PEER_DEP_ISSUES` przy obowiązującym `strictPeerDependencies: true`. Odtworzenie metadanych: `pnpm view openapi-typescript@7.13.0 peerDependencies --json`.

**Propozycja oczekująca na właściciela:** odizolowany pakiet narzędziowy generatora z własnym TS 5.x, przy zachowaniu TS 7 dla aplikacji i strict peers; opisać wyjątek w stosie i BL-032 przed wdrożeniem. Wstrzymanie według AGENTS § 2.5, aktualizacja istniejącego R-20. Cofnięto własne zmiany manifestu, lockfile i robocze wpisy o wdrożeniu. Ponowna instalacja frozen, docs/repository i diff check PASS. CSP, klient, tokeny i testy BL-011 jeszcze niewykonane. Status `w toku`; estymacja 3 d bez zmian, nakład niezmierzony. ADR nie zmieniono.

## Dotychczasowy stan paczki

BL-001–010/013–015/034 wykonane lokalnie; BL-032 technicznie zamknięty. Statusy `w toku` do wspólnego DoD. BL-013: osiem kolejek i sonda PING/heartbeat; BL-014: Node → Python ACK, bez analiz i DB. Oba workery wymagają jawnego NODE_ENV i plików sekretów w produkcji. W dev aplikacje na hoście; pytest blokuje gniazda poza Valkey, izolacja systemowa analytics od M3 (ADR-003).

BL-034: `pnpm dev` przygotowuje Compose, migracje i seed oraz uruchamia cztery aplikacje. Seed zachowuje leksemy kwot, RLS i expected; idempotencja oraz rollback potwierdzone. Konto bez hasła/MFA bypass; auth w M1. Instrukcja: [środowisko dev](../07-wdrozenie/srodowisko-deweloperskie.md).

Ostatnie dowody kodu (2026-09-28): monorepo 88/88 PASS; jobs 5 testów; Python 9 PASS + 1 integracyjny przez runner; queues:test, db:seed:test, dev:test PASS. Baza: 12 testów pul, RLS/audyt, ZERO DIFFERENCES. Logi `.git/m0-workers/` i `.git/bl007-db/`.

CI rewizji `0096fd4` PASS: [workers](https://github.com/Ipper18/OligInvest/actions/runs/36474677562), [db](https://github.com/Ipper18/OligInvest/actions/runs/36474677512), [modules](https://github.com/Ipper18/OligInvest/actions/runs/36474677505), [contracts](https://github.com/Ipper18/OligInvest/actions/runs/36474677553); CodeQL i Analyze (python) SUCCESS.

Dalej BL-011/012/016/018/033, pełne CI BL-017, ustawienia BL-019 i pozostałe BL-035. Ruleset nadal disabled. P-01–P-06 w historii; P-07 poza zakresem, P-08/P-09 przy M0-2. M0 otwarty: kryteria 1–3 mają wcześniejsze dowody, 4–7 wymagają dalszych prac/właściciela, 8 częściowo. Serwery i ustawienia GitHub bez zmian.
