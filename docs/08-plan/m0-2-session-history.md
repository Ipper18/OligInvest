# M0-2 — historia etapów

**Cel:** zachować krótkie dowody zakończonych etapów; stan bieżący w [raporcie](m0-2-session-report.md).

## 2026-10-01 — przygotowanie i wykrycie blokady

- Gałąź `feat/m0-2-release` z `main` na `25e8762`; zależności M0-1 scalone.
- Przegląd INF ujawnił konflikt root/0600 z procesami non-root i plikowymi sekretami Compose.
- Lokalny Compose: oryginał 0:0/600 nieczytelny, kopia 10001:10001/400 czytelna i niezapisywalna; PASS.
- Dokumentacja Docker potwierdza ignorowanie `uid/gid/mode` dla źródła `file`.
- [Propozycja korekty](m0-2-secret-permissions.md) oczekuje na właściciela według AGENTS §2.5; R-27.
- Bez implementacji obrazów, wydania i wdrożenia; bez zmian ustawień GitHub i serwerów.

## 2026-10-01 — zatwierdzenie i zapis czterech etapów

- Właściciel zatwierdził INF §5.3/8 z jedną macierzą UID/GID; osobny docs: 5bff168, bez ADR.
- Generator i testy: 8045cce; Dockerfile: 6dd8d59; Compose: 74a0697; workflow: a8ebd1f; każdy od razu wypchnięty.
- Root/0600 oryginały, kopie 0400 per odbiorca pod root/0700, blokada i atomowa rotacja; R-27.

## 2026-10-01 — testy obrazów i spiki

- 2323e74: 9 USER/montowań, izolacja sieci/danych, migracja, szyfrowana kopia i 36 E2E lokalnie PASS.
- 2ed593c: BL-030/031, rzeczywiste HTTPS i trzy przeglądarki; szyfrowanie TOTP/kodów, hash PAT i Argon2id PASS.
- Notatka do decyzji właściciela; pomiar VM pozostaje owner-run. Bez produkcyjnego auth.
- 5a9862a: BL-023 z 5 testami osobno; b5aadff: release/secret-files/image-audit osobno; natychmiastowy push.

## 2026-10-01 — diagnostyka CI i bezpieczeństwo obrazów

- Artefakt e2e.log przebiegu 36866013065: brak @oliginvest/i18n/dist/index.js na czystym hoście; f2e9e67 buduje import testu.
- Poprawka fokusu zachowuje nawigację po natywnym close. Regresja emituje opóźniony close na ukrytym dialogu; 36/36 PASS po 5f5ca26.
- 6988453/5f5ca26: przypięte poprawki glibc, OpenSSL, Perl, util-linux; usunięte nieużywane gosu; bez wyjątku OSV.
- a7c6fda: oficjalny Caddy 2.11.6 z SHA-256; 9 SBOM/OSV lokalnie PASS według CI §5. Lockfile gate ≥7 bez zmian; R-28.
- 45986ab/b2e41ff: instrukcja właściciela, rotacja, rollback i lokalne hooki monitoringu; 5 testów wdrożenia PASS.
- Końcowe kontrole PR nadal sprawdzane. Brak tagów, wydań, GHCR i działań na serwerach.
