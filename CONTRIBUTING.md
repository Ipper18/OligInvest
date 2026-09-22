# Jak współtworzyć OligInvest

**Cel:** ustalić jednolite zasady pracy nad kodem i dokumentacją OligInvest — przepływ gałęzi, konwencje commitów, Definition of Done zadania, przegląd kodu, politykę zależności i sekretów — obowiązujące ludzi i agentów (Codex, Claude Code) (NFR-10.03).

Powiązane: [`AGENTS.md`](AGENTS.md) (reguły dla agenta), [`CLAUDE.md`](CLAUDE.md), [`SECURITY.md`](SECURITY.md), [`docs/07-wdrozenie/ci-cd.md`](docs/07-wdrozenie/ci-cd.md), [`docs/08-plan/backlog.md`](docs/08-plan/backlog.md).

## 1. Przepływ pracy

- **Trunk-based:** krótkie gałęzie od `main`, nazwa `<typ>/bl-<nr>-<opis>` (np. `feat/bl-145-xtb-import`), PR do `main`, scalanie przez *squash*.
- **Ochrona `main`** (ruleset): wymagany PR i zielone zadania CI, historia liniowa, bez force-push, rozwiązane wątki przeglądu; reguły obowiązują także właściciela ([`docs/07-wdrozenie/ci-cd.md`](docs/07-wdrozenie/ci-cd.md) § 2).
- **Jedno zadanie backlogu = jeden PR** (albo mała, spójna grupa zadań). PR powyżej ok. 800 zmienionych linii kodu dzielimy.
- **Dokumentacja przed kodem** (NFR-10.01): zmiana kontraktu (OpenAPI, schemat bazy, wzory, disclaimery, instrukcje) jest w tym samym PR, a CI porównuje kod z dokumentacją.
- Decyzja sprzeczna z ADR wymaga nowego ADR ([`docs/09-decyzje/ADR-000-szablon.md`](docs/09-decyzje/ADR-000-szablon.md)) przed scaleniem.

## 2. Commity i tytuły PR — Conventional Commits

Format: `<typ>(<zakres>): <opis w trybie rozkazującym po angielsku>`; zakres = moduł lub pakiet (`portfolio`, `core`, `db`, `web`, `infra`, `docs`…); w treści ID zadań.

| Typ | Kiedy |
|---|---|
| `feat` | nowa funkcja |
| `fix` | poprawka błędu (także bezpieczeństwa) |
| `docs` | wyłącznie dokumentacja |
| `refactor`, `perf`, `test` | zmiana bez nowej funkcji, wydajność, testy |
| `build`, `ci`, `chore` | budowanie, CI, porządki i zależności |

Zmiana niezgodna wstecz: `!` po typie i stopka `BREAKING CHANGE:` z opisem migracji (API: okres przejściowy ≥ 90 dni, [`docs/02-api/konwencje-api.md`](docs/02-api/konwencje-api.md)). Przykład:

```text
feat(portfolio): parse XTB cash operations (new template)

Implements BL-145: header detection by content, idempotent row keys,
CFD rows kept as ADJUSTMENT(category=cfd_pl).
```

Commity przygotowane z pomocą agenta mogą mieć stopkę `Co-Authored-By:`. Wersje wydań: SemVer, tag `vMAJOR.MINOR.PATCH` na `main` (wersja API `/v1` jest niezależna).

## 3. Definition of Done zadania

Zadanie jest skończone, gdy spełnia **wszystkie** punkty (lista trafia do szablonu PR `.github/pull_request_template.md` w BL-019):

1. **Zakres:** zrobione dokładnie to, co opisuje zadanie w backlogu; kryteria akceptacji wymagań z kolumny „Wymagania” ([`docs/00-przeglad/wymagania.md`](docs/00-przeglad/wymagania.md)) spełnione i wskazane w opisie PR.
2. **Dokumentacja:** zaktualizowane dokumenty źródłowe z kolumny „Dokumenty”; status zadania i odchylenia w [`docs/08-plan/backlog.md`](docs/08-plan/backlog.md); nowe ryzyka w [`docs/08-plan/ryzyka.md`](docs/08-plan/ryzyka.md).
3. **Testy:** jednostkowe (w `packages/core` pokrycie ≥ 90 % linii i 100 % wzorów na wektorach referencyjnych), integracyjne z prawdziwym PostgreSQL (każda nowa tabela z `user_id` ma politykę RLS i test w tym samym PR), kontraktowe (OpenAPI, parsery, adaptery), e2e dla ścieżek krytycznych z axe.
4. **CI zielone:** `lint`, `typecheck`, `unit`, `contracts`, `db`, `build` (także bez modułów opcjonalnych), `budgets`, `e2e`, `lighthouse`, `deps-audit`, `codeql`.
5. **Bezpieczeństwo:** walidacja Zod na każdym wejściu; zapytania parametryzowane; brak sekretów, adresów IP i danych rzeczywistych; klucze cache i kanały SSE z `user_id`; logi bez danych finansowych; brak nowych połączeń wychodzących poza allowlistę; wymagania ASVS oznaczone „T” mają test ([`docs/06-bezpieczenstwo/kontrole-bezpieczenstwa.md`](docs/06-bezpieczenstwo/kontrole-bezpieczenstwa.md) § 7).
6. **Pieniądze i czas:** `decimal.js`/`Decimal`/`NUMERIC`, nigdy `float`; waluta zawsze jawna; kwoty w JSON jako ciągi ([ADR-014](docs/09-decyzje/ADR-014-pieniadze-waluty-czas.md)).
7. **Wydajność:** budżety tras dotrzymane; biblioteki wykresów, onboarding, panel admina i analizy tylko leniwie ([`docs/04-frontend/wydajnosc.md`](docs/04-frontend/wydajnosc.md)).
8. **Dostępność:** obsługa klawiaturą, etykiety, kontrast, tabela zamiast wykresu, `prefers-reduced-motion`; zysk/strata nie tylko kolorem.
9. **Zgodność:** ekrany analiz, screenera, alertów i eksportów przechodzą checklistę z [`docs/11-zgodnosc-prawna.md`](docs/11-zgodnosc-prawna.md) § 4.4; funkcje przewidujące lub backtestowe mają w PR przegląd metodologiczny według checklist z [`AGENTS.md`](AGENTS.md).
10. **i18n:** brak literałów tekstowych w komponentach; formatowanie `Intl` pl-PL.
11. **Zależności:** każda nowa zależność uzasadniona w PR i wpisana do [`docs/01-architektura/stack-technologiczny.md`](docs/01-architektura/stack-technologiczny.md) (albo ADR); wersja przypięta w lockfile; licencja z listy dozwolonych.

## 4. Przegląd kodu

- Właściciel przegląda **każdy** PR — także przygotowany przez agenta i z zielonym CI (R-11 w [`docs/08-plan/ryzyka.md`](docs/08-plan/ryzyka.md)).
- Przegląd właściciela pozostaje obowiązkiem procesu (R-11), nie jest egzekwowany mechanizmem zatwierdzeń GitHuba: repozytorium ma jednego współpracownika, który nie może zatwierdzić własnego PR. Ruleset wymaga 0 zatwierdzeń i nie wymaga zatwierdzenia code ownera; nie tworzymy odrębnej tożsamości autora ani obejść reguł.
- `CODEOWNERS` wskazuje obszary wymagające szczególnej uwagi właściciela: `docs/06-bezpieczenstwo/`, `infra/`, `.github/`, `packages/db/`, `apps/api/src/auth/`.
- Na co patrzeć: zakres zgodny z zadaniem; nowe zależności i skrypty instalacyjne; usunięte lub osłabione testy; zmiany w politykach RLS, nagłówkach i CSP; nowe połączenia wychodzące; język wyników (zakazy z [`docs/11-zgodnosc-prawna.md`](docs/11-zgodnosc-prawna.md) § 4.1).

## 5. Dokumentacja

- Dokumentacja po polsku; kod, identyfikatory, nazwy plików technicznych i commity — po angielsku.
- Każdy dokument zaczyna się zdaniem `**Cel:** …`.
- Liczby (limity API, wersje, ceny) z linkiem i datą sprawdzenia albo ze znacznikiem **NIEZWERYFIKOWANE**; nie wymyślamy bibliotek ani linków.
- Diagramy w Mermaid; fragmenty kodu w dokumentacji ilustracyjne i krótkie.
- Konwencje nazw: katalogi i pliki `kebab-case`, komponenty i typy `PascalCase`, funkcje i zmienne `camelCase`, stałe i zmienne środowiskowe `SCREAMING_SNAKE_CASE`, tabele SQL `snake_case` w liczbie mnogiej, wymagania `FR-xx.yy`/`NFR-xx.yy`, decyzje `ADR-NNN-slug.md`, zadania `BL-NNN`.

## 6. Sekrety i repozytorium publiczne

- Sekrety wyłącznie w `.env` (ignorowany) albo w `/etc/oliginvest/secrets` na serwerze; w repozytorium tylko [`.env.example`](.env.example) z pustymi wartościami. `.mcp.json` odwołuje się do kluczy przez `${VAR}`.
- Zakazane w repozytorium: adresy IP, wewnętrzne nazwy hostów, porty usług domowych, konfiguracje WireGuard i SSH, rzeczywiste wyciągi brokerskie ([ADR-013](docs/09-decyzje/ADR-013-repozytorium-publiczne.md)). Pliki `.xlsx`/`.csv` tylko w `**/fixtures/anonymized/**`, po anonimizacji.
- Przed commitem:

```bash
git grep -nE '(api[_-]?key|secret|token)\s*[:=]\s*["'"'"']?[A-Za-z0-9_\-]{16,}'
```

- Znalezisko po fakcie: nie „poprawiaj historii” samodzielnie — postępuj według playbooka P3 w [`docs/06-bezpieczenstwo/plan-reagowania.md`](docs/06-bezpieczenstwo/plan-reagowania.md) (unieważnienie sekretu jest ważniejsze niż usunięcie go z historii).

## 7. Zależności i skille

- Polityka zależności: [`docs/01-architektura/stack-technologiczny.md`](docs/01-architektura/stack-technologiczny.md) § 1 (standard platformy najpierw; licencje MIT, Apache-2.0, BSD, ISC, MPL-2.0; utrzymanie ≤ 6 miesięcy; wpływ na budżet JS).
- Aktualizacje proponuje Renovate (opóźnienie 3 dni, bez automatycznego scalania zależności produkcyjnych); poprawki bezpieczeństwa omijają opóźnienie, ale nie przegląd.
- **Ponowny audyt skilli** w `.claude/skills/` przy każdej ich aktualizacji ([`docs/09-decyzje/audyt-pluginow.md`](docs/09-decyzje/audyt-pluginow.md)): sprawdź datę ostatniego commita źródła, wywołania sieciowe, odczyty zmiennych środowiskowych i instalowanie zależności, a wynik dopisz do audytu:

```bash
git -C <klon-repozytorium-skilli> log -1 --format='%H %cs'
grep -rnE 'https?://|requests\.|urllib|fetch\(|axios|curl |wget ' .claude/skills/<skill>
grep -rnE 'os\.getenv|os\.environ|process\.env' .claude/skills/<skill>
grep -rnE 'pip install|npm install|npx |uv add' .claude/skills/<skill>
```

  Odrzucamy skill, który łączy się z nieudokumentowanymi hostami, czyta zmienne spoza własnego zakresu, instaluje nieprzypięte zależności albo nie jest utrzymywany ponad 6 miesięcy.

## 8. Uruchamianie lokalne

Polecenia powstają w etapie M0 (BL-001–BL-035). Zweryfikowano instalacje frozen i pełne `pnpm turbo run lint typecheck test build` na Node 24.21.0, pnpm 12.4.2, Python 3.13.13 i uv 0.12.16; uv musi być dostępne w PATH bieżącej powłoki. Kontrole `node scripts/check-docs.mjs` i `node scripts/check-repository.mjs` działają bez zależności. `pnpm check:deps`, `pnpm gen:module` i `pnpm test:scripts` wymagają zainstalowanych zależności z lockfile; generator sprawdzamy także przez `pnpm test:module-generator` w odizolowanym workspace. Pełne `pnpm dev` pozostaje docelowe. `pnpm db:test` sprawdzono na PostgreSQL 18.6 (migracje, pełne porównanie, RLS i pule). Korekta sieci Compose jest zatwierdzona ([raport](docs/08-plan/m0-1-session-report.md), [Compose dev](docs/07-wdrozenie/srodowisko-deweloperskie.md)).

| Polecenie | Co robi |
|---|---|
| `pnpm install --frozen-lockfile` | instalacja zależności z lockfile |
| `docker compose -f compose.dev.yaml up -d` | PostgreSQL 18, Valkey ×2 i Mailpit do testów e-maili |
| `pnpm dev` | aplikacje w trybie deweloperskim |
| `pnpm turbo run lint typecheck test build` | pełne sprawdzenie jak w CI |
| `pnpm db:test` | migracje od zera, porównanie z `docs/03-dane/schema.sql`, testy RLS |
| `pnpm check:deps` | reguły warstw modułów i importów produkcyjnych; test negatywny: `node --test scripts/check-deps.test.mjs` |
| `pnpm gen:module <nazwa>` | nowy moduł według [`docs/01-architektura/moduly.md`](docs/01-architektura/moduly.md) § 8.1 |
