# BL-303 — stan sesji

**Cel:** przekazać aktualny stan wyników portfela i diagnozy CI PR #75.

**2026-11-14**, `feat/bl-303-performance`, worktree `OligInvest-bl-303`, [PR #75](https://github.com/Ipper18/OligInvest/pull/75) gotowy do przeglądu. Przyjęto fast-forward do opublikowanego przez właściciela merge `fbc4fca` (main obejmuje PR #67, #73 i #74). Status `w toku`; M3 pozostaje otwarty.

## Zakres

`getPerformance` i osobna `/portfel/wyniki`: TWR/XIRR z istniejącego core, daty i osiem okresów, PLN lub waluta rachunku, PL/EN i istniejący P/L. Decimal, stopy jako ciągi, XIRR `period_too_short`, założenia/EOD/disclaimer. RLS/404, luki i brak pierwszego recompute nie stają się zerami; transfery klasyfikuje core.

## Diagnoza CI na fbc4fca

Przeczytano logi nieudanych kroków obu czerwonych kontroli i szczegółowe logi Playwright z artefaktów:

- `images`, run **43583867382**: obrazy zbudowane, kontrole USER/sekretów PASS; 9 błędów wyłącznie w `performance.spec.ts` (205 PASS, 2 skipped). Testy z syntetyczną sesją dziedziczyły produkcyjny `E2E_BASE_URL`, więc trafiały na logowanie. Poprawka BL-303: jawny adres lokalnego serwera fixtures w tym zestawie, zgodnie z pozostałymi testami fixtures.
- `e2e`, run **43583867399**: 216 PASS, 2 skipped, jeden FAIL poza BL-303 — Firefox, `shell-auth.spec.ts:178`, po wylogowaniu pozostaje puste `__Host-oliginvest.session_token`, choć oczekiwano braku cookies. Bez zmian w uwierzytelnianiu lub osłabiania asercji.
- Pozostałe 22 kontrole PASS, release pominięty. Unit API i web/budżety/Lighthouse przeszły w CI; wcześniejszy lokalny timeout startu API nie wystąpił w tym przebiegu.

## Weryfikacja poprawki

- `pnpm turbo run lint typecheck test build --filter=@oliginvest/web --output-logs=errors-only`: **16/16 PASS** (8 z cache).
- E2E wyników z globalnym `E2E_BASE_URL=https://127.0.0.1:1`: **9/9 PASS** w Chromium/WebKit/Firefox. Potwierdza niezależność zestawu fixtures od adresu bramy obrazów; PL/EN, daty, krótki XIRR, luki i axe.
- Grep sekretów z CLAUDE.md: cztery istniejące syntetyczne fixtures, zero nowych trafień względem HEAD; dokumentacja i `git diff --check`: PASS.
- Bez zmian w plikach chronionych, zależnościach, timeoutach, retry i progach. Pełnych obrazów lokalnie nie przebudowywano; wynik ich nowego przebiegu wymaga CI.

## Wcześniejsze dowody i otwarte sprawy

Unit portfolio 56/56; integracja PostgreSQL/RLS/404, wektor B, granica 29/30 dni, transfery i luki PASS. Budżety przed merge: `/` 158,75/190 KiB, `/portfel` 168,49/195, powłoka 29,82/30; R-53 nadal monitorowany przez CI. Nie są to nowe pomiary tej sesji.

Do DoD: zielone CI i przegląd właściciela; błąd wylogowania poza zakresem zgłoszony w raporcie. Wynik pozycji odroczony decyzją właściciela 2026-11-13 (`instrumentId`: 422); benchmark BL-304. Bez nowego ADR/ryzyka; estymata 2 d, nakład i odchylenie niezmierzone.
