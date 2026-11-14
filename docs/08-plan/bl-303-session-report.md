# BL-303 — stan sesji

**Cel:** przekazać aktualny stan wyników portfela i weryfikacji po połączeniu z main.

**2026-11-14**, `feat/bl-303-performance`, worktree `OligInvest-bl-303`, draft [PR #75](https://github.com/Ipper18/OligInvest/pull/75). Merge `origin/main` **16968fa** (PR #67 i #73) w commicie **6e401d2**: bez konfliktów, bez przepisywania opublikowanej historii. Status `w toku`; M3 pozostaje otwarty.

## Zakres

`getPerformance` i osobna `/portfel/wyniki`: TWR/XIRR z istniejącego core, dowolne daty i osiem okresów, PLN lub waluta rachunku, PL/EN i istniejący P/L. Kwoty Decimal, stopy jako ciągi, XIRR `period_too_short`, założenia/EOD/disclaimer. RLS/404, luki i brak pierwszego recompute nie stają się zerami; transfery między wybranymi rachunkami klasyfikuje core. OpenAPI/pending/klient i dokumentacja są aktualizowane w tym PR.

## Weryfikacja po merge

- Instalacja `pnpm install --frozen-lockfile`: PASS, bez zmiany zależności względem main.
- Lint/typecheck zmienionych pakietów i zależnych: **49/49 zadań PASS**. Build produkcyjny web: PASS.
- Unit portfolio **56/56**, web **79/79**. Pozostałe zakończone pakiety unit PASS; API **92/93** (w tym 25 testów OpenAPI PASS).
- **FAIL poza edytowanym zakresem:** `apps/api/test/server.test.mjs`, „Node entrypoint starts during outages and bounds actual TCP readiness probes”: `TimeoutError: The operation was aborted due to timeout` (test trwał ok. 5120 ms). Test i kod startowy są identyczne z main. Nie ustalono, czy przyczyną jest aktualizacja Hono, środowisko czy inny czynnik. Bez poprawek w tym obszarze, retry i podnoszenia timeoutów. Zbiorczy przebieg zatrzymał się na tym błędzie; niedokończone kontrole webu wykonano osobno.
- E2E ekranu wyników: **9/9 PASS**, Chromium/WebKit/Firefox, PL/EN, zakres dat, krótki XIRR, luki i axe.
- `proxy.ts`, locale-cookie, settings, relay, wszystkie `package.json` i `pnpm-lock.yaml`: identyczne z `origin/main`, bez własnych poprawek.
- Grep CLAUDE.md: cztery istniejące syntetyczne fixtures, brak nowych trafień względem main.

## Wcześniejsze dowody BL-303

Przed merge: PostgreSQL 18/RLS/404, waluty, transfer w drodze i brak wycen rachunku PASS; porównanie schematu ZERO DIFFERENCES. Wektor B, granica 29/30 dni, annualizacja od 365 dni i luki w unit PASS. Budżety: `/` 158,75/190 KiB, `/portfel` i wyniki 168,49/195, powłoka 29,82/30. Lighthouse: LCP `/` 1802,680 ms, `/portfel` 1352,756 ms; cztery trasy PASS. Tych pomiarów nie traktujemy jako nowych pomiarów po merge. R-53 nadal monitorowany w CI.

## Otwarte

Do DoD: wyjaśnienie lokalnego timeoutu API, pełne CI i przegląd właściciela. Właściciel odroczył wynik pozycji do osobnej metodologii (2026-11-13); `instrumentId` zwraca 422. Benchmark to BL-304, również jawne 422. Brak nowego ADR i potwierdzonego nowego ryzyka. Estymata 2 d bez zmian, nakład/odchylenie niezmierzone. Przegląd FR-04 nie dotyczy historycznych stóp; M3 nie jest zamykany.
