# M0-1 — stan bieżący

**Cel:** dać agentowi i właścicielowi na starcie każdej sesji krótki, aktualny obraz paczki M0-1 — co jest wykonane, jakie decyzje obowiązują i co jest następnym krokiem — bez czytania całej historii.

Zasady pliku: po każdej sesji ten plik jest **nadpisywany** (nie dopisywany) i ma najwyżej ok. 3 KB. Przebieg, dowody i diagnozy trafiają na koniec [historii sesji](m0-1-session-history.md) — najwyżej 10 linii na zamknięty etap. Historię czyta się tylko wtedy, gdy potrzebny jest konkretny dowód.

## Stan — 2026-09-21

Gałąź `feat/m0-1-skeleton`, [roboczy PR #2](https://github.com/Ipper18/OligInvest/pull/2), bez scalania. Środowisko: Node 24.21.0, pnpm 12.4.2, Python 3.13.13 + uv 0.12.16, `compose.dev.yaml` na Docker Desktop. Własne CI nieuruchomione — zadania wykonane lokalnie mają status `w toku` do wspólnego DoD.

| Zadania | Stan lokalny | Brakuje |
|---|---|---|
| BL-001, BL-002 | lockfile npm i uv, instalacje frozen, 22 pakiety ze szkieletami, `lint typecheck test build` 88/88 | CI |
| BL-003, BL-004 | — | całość (granice warstw, generator modułów) |
| BL-005, BL-006 | konfiguracja z `*_FILE` (11 testów), platforma: rejestry, kontekst żądania, pino, RFC 9457 (19 testów) | CI |
| **BL-007** | **etap 1/4 zamknięty** (`4b4d656`): 64 tabele Drizzle w 9 schematach, migracje, 40/40 | etapy 2–4 |
| BL-008 | — | zadanie CI `db` |
| BL-009–BL-016, BL-033 | — | całość; Lighthouse 13.5.0 wraca do manifestu w BL-016 |
| BL-017, BL-019 | nieaktywny szkic workflow, ruleset, CODEOWNERS, Renovate, instrukcja właściciela | aktywacja CI; kliknięcia właściciela po scaleniu |
| BL-018 | — | lokalne E2E; część na obrazach produkcyjnych w M0-2 |
| BL-032 | zamknięty [notatką](bl-032-typescript-7-spike.md) | — |
| BL-034, BL-035 | Compose działa, kontrola dokumentacji przechodzi | seed i `pnpm dev`; uruchomienie w CI |

## Obowiązujące decyzje właściciela

- [ADR-015](../09-decyzje/ADR-015-linia-turborepo-na-starcie-m0.md): Turborepo 2.10.13, przejście na 2.11 osobnym PR Renovate.
- Patche zamiast czekania na karencję: bullmq 6.3.6 (npm) i 3.2.2 (PyPI), psycopg i psycopg-binary 3.3.5. Karencja bez wyjątków.
- `strict: true`, `skipLibCheck: true` — błędy deklaracji Drizzle i Better Auth bez łatek typów.
- `compose.dev.yaml`: `internal: false` tylko w dev, porty na `DEV_BIND_ADDRESS`; produkcyjne sieci internal (BL-022) bez zmian.
- deps-audit: high i critical blokują; moderate i low do raportu. Wyjątek OSV dla esbuild (GHSA-67mh-4wv8-2f99) do 2026-12-20, R-24.
- Ruleset: 0 wymaganych zatwierdzeń, przegląd właściciela jako obowiązek procesu (R-23). CodeQL: konfiguracja domyślna po scaleniu M0-1.
- BL-002 traktowane jako spełniona zależność BL-007 mimo statusu `w toku`.

## Kryteria wyjścia M0

1 — częściowo (brak BL-003) · 2 — w toku (BL-007/008) · 3 — niewykonane (BL-009/010) · 7 — wymaga działań właściciela · 8 — BL-032 zamknięty, pozostałe spiki w M0-2 i M0-3. Otwarte ryzyka: R-22, R-24, R-25, R-26.

## Następny krok

BL-007 etap 2: migracje od zera na PostgreSQL 18 i porównanie ze `schema.sql` (zero różnic). Potem etap 3 (role, uprawnienia, RLS, `testy-rls.sql`), etap 4 (pule per rola, helper transakcji, test braku przenikania kontekstu) i BL-008.
