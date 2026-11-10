# BL-602 — raport sesji

**Cel:** zapisać stan paczki BL-602 (pasywny skan DAST ZAP baseline lokalnej instancji i poprawki): zakres, decyzje, wyniki weryfikacji, odchylenia i pytania do właściciela.

**2026-11-08**, gałąź `feat/bl-602-zap-baseline`, baza `origin/main` `797fd4a`, wykonawca Claude Code. Równolegle Codex pracuje nad BL-211 (`apps/web` strony, `apps/api` trasy auth/preferencji, `packages/i18n`) — tych obszarów nie zmieniano.

## Zrobione

- `apps/web/scripts/zap-baseline.mjs`: dwa pasywne przebiegi ZAP baseline (`public`, `authenticated` z syntetyczną sesją `fixture-perf`) przez Caddy z `infra/caddy/Caddyfile.test` przed produkcyjnym `next start` i syntetycznym API — ten sam układ co Lighthouse (`performance-server.mjs` dostał opcję `edge: false`; domyślna ścieżka Lighthouse bez zmian). `-silent` (bez nieprzypiętych aktualizacji dodatków), dodatek pscanrulesBeta beta-50 z SHA-256, minimalna liczba URL-i jako ochrona przed pustym skanem, raport w podsumowaniu zadania.
- `apps/web/zap-baseline.conf`: 26 reguł `FAIL` z powodami (kontrole SEC § 2–3, AUTH); brak `IGNORE`, `*`, `OUTOFSCOPE`.
- Poprawka ustalenia 90004: `Cross-Origin-Embedder-Policy: require-corp` w `Caddyfile` i `Caddyfile.test`; `-Server` w `Caddyfile.test` (zgodność z produkcją); test zgodności bloków nagłówków w `infra/tests/test-host-config.py`.
- Testy: `apps/web/test/zap-baseline.test.mjs` (podmiany Caddyfile i wykrywanie dryfu, parser reguł, raport, przypięcia), `apps/web/test/auth-action-origin.test.mjs` (strażnik same-origin `/auth/action` — dowód dla 10202).
- CI: zadanie `dast` w workflow Web security (osobny runner, limit 15 min, artefakt `zap-baseline-report`), kontekst `dast` w `.github/rulesets/main.json`.
- Dokumenty: SEC § 2.2 (COEP), § 9 i nowy § 9.1; [protokół](../06-bezpieczenstwo/przeglady/2026-11-08-zap-baseline-bl-602.md); CI/CD § 3; ustawienia repozytorium; DoD w `CONTRIBUTING.md`; stos (§ 7); backlog; R-56.

## Wyniki weryfikacji

| Kontrola | Wynik |
|---|---|
| ZAP baseline lokalnie (po poprawce) | `public` 30 URL-i, `authenticated` 153 URL-e; FAIL 0; WARN 5 / 7 reguł (protokół § 3); 34–38 s |
| Kontrola bramki (COEP usunięty z `Caddyfile.test`) | FAIL 90004, kod 1 — przywrócono |
| Vitest `apps/web` (nowe testy) | PASS |
| `infra/tests/test-host-config.py` | nowy test i testy Caddy PASS; testy chrony/nft/nginx wymagają narzędzi Linuksa (CI `infrastructure`) |
| `check-ci`, `check-docs`, lint, typecheck, unit | wyniki w opisie PR |
| CI PR #62 (`b710ec0`) | wszystkie kontrole zielone; `dast` 2 min 15 s (skan 91 s), wynik jak lokalnie; `web` 9 min 21 s, `images` (E2E 3 przeglądarek z COEP) 14 min 47 s |

## Pominięte i dlaczego

- 10019 (`Content-Type` przekierowania w `proxy.ts`) i 10044 (przekierowanie zalogowanego w stronie `/logowanie`) — poprawki w obszarze BL-211; P4/P5 → BL-613.
- Skan prawdziwego `api` (ciasteczka Better Auth, nagłówki API) — wymaga sesji z TOTP albo osobnego przebiegu w zadaniu obrazów; P7 → BL-614, R-56.

## Odchylenia

Estymacja 1,5 d; nakład ok. jednej sesji, niezmierzony. Dodatkowy element poza opisem zadania: COEP w nagłówkach produkcyjnych (rzeczywiste ustalenie skanu).

## Decyzje do ADR

Brak — bez zmiany stosu runtime; ZAP to narzędzie CI wpisane do `stack-technologiczny.md` § 7.

## Decyzje właściciela (2026-11-10, komentarz w PR #62)

- **P1, P2, P3, P6:** bez wyjątków skanera — 10202, 10015, 10049, 10111, 10109, 10096, 10031 zostają `WARN`; plik reguł bez zmian.
- **P4, P5:** poprawki 10019 i 10044 w `apps/web/src/proxy.ts` po scaleniu BL-211 (PR #63), osobnym PR; potem 10019 → `FAIL` — **BL-613**.
- **P7:** skan prawdziwego `api` (Better Auth) — osobne zadanie później — **BL-614**.
- **P8:** krawędź testowa na obrazie bazowym `caddy:2.11.7@sha256:f2a1…`.
- **P9:** `dast` blokuje tylko przy `FAIL`.
- `dast` — wymagany check rulesetu `main` (ustawienie właściciela po scaleniu PR #62).

Szczegóły: [protokół § 5.1](../06-bezpieczenstwo/przeglady/2026-11-08-zap-baseline-bl-602.md).

## Stan

BL-602 `gotowe`: CI PR #62 zielone, decyzje zapisane. Otwarte: BL-613 (po BL-211), BL-614, włączenie `dast` w rulesecie GitHub.
