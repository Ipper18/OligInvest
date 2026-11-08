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
| CI `dast` | ⏳ czas i wynik po pierwszym przebiegu PR |

## Pominięte i dlaczego

- 10019 (`Content-Type` przekierowania w `proxy.ts`) i 10044 (przekierowanie zalogowanego w stronie `/logowanie`) — poprawki w obszarze BL-211; opisane jako P4/P5.
- Skan prawdziwego `api` (ciasteczka Better Auth, nagłówki API) — wymaga sesji z TOTP albo osobnego przebiegu w zadaniu obrazów; P7, R-56.

## Odchylenia

Estymacja 1,5 d; nakład ok. jednej sesji, niezmierzony. Dodatkowy element poza opisem zadania: COEP w nagłówkach produkcyjnych (rzeczywiste ustalenie skanu).

## Decyzje do ADR

Brak — bez zmiany stosu runtime; ZAP to narzędzie CI wpisane do `stack-technologiczny.md` § 7.

## Pytania do właściciela

P1–P9 w protokole § 5 (wyjątki 10202, 10015, 10049/10111/10109, 10096/10031; poprawki 10019/10044 po BL-211; skan prawdziwego API; obraz Caddy krawędzi testowej; blokowanie na `WARN`). Do tego: dodanie kontekstu `dast` do rulesetu w ustawieniach GitHub.
