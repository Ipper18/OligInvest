# CI/CD — testy, wydania, wdrożenie

**Cel:** opisać, jak kod OligInvest przechodzi od pull requesta do produkcji — ochronę gałęzi, zadania CI blokujące scalenie, budowanie podpisanych obrazów z SBOM, wdrożenie ściągane przez serwer domowy z weryfikacją podpisu, migracje zgodne wstecz i wycofanie — przy zerowym koszcie i bez dawania CI dostępu do serwera (NFR-03.09, NFR-09.05, NFR-10.02, NFR-10.03).

Powiązane: [`infrastruktura.md`](infrastruktura.md), [`backup-dr.md`](backup-dr.md), [`monitoring.md`](monitoring.md), [`../06-bezpieczenstwo/kontrole-bezpieczenstwa.md`](../06-bezpieczenstwo/kontrole-bezpieczenstwa.md) § 4, [ADR-013](../09-decyzje/ADR-013-repozytorium-publiczne.md), [`../04-frontend/wydajnosc.md`](../04-frontend/wydajnosc.md) § 6, [`../03-dane/model-danych.md`](../03-dane/model-danych.md) § 5.

Fakty sprawdzone 2026-09-19 w dokumentacji GitHub: runnery hostowane przez GitHub są darmowe dla repozytoriów publicznych; runnerów własnych nie należy używać w repozytoriach publicznych (każdy może otworzyć pull request i uruchomić kod na maszynie runnera); przypięcie akcji do pełnego SHA commitu to jedyny sposób na niezmienną wersję akcji.

## 1. Zasady

1. **CI nie ma dostępu do serwera.** Brak runnerów własnych, brak kluczy SSH i poświadczeń produkcyjnych w GitHubie. Serwer sam pobiera podpisane wydanie (model „pull”).
2. **CI nie ma sekretów.** Testy używają fixtures i atrap dostawców; podpis obrazów korzysta z tokenu OIDC wystawianego na czas zadania (cosign keyless).
3. **Scalenie tylko po zielonym CI.** Każde wymaganie z [`../06-bezpieczenstwo/kontrole-bezpieczenstwa.md`](../06-bezpieczenstwo/kontrole-bezpieczenstwa.md) § 7 oznaczone „T” ma test w CI.
4. **Dokumentacja przed kodem** (NFR-10.01): zmiana kontraktu (OpenAPI, schemat bazy, wzory) to zmiana dokumentu w tym samym PR — CI porównuje kod z dokumentacją.

## 2. Gałęzie i ochrona `main`

- **Model:** trunk-based — krótkie gałęzie tematyczne, PR do `main`, scalanie przez „squash”, tytuł PR w formacie Conventional Commits (sprawdzany w CI).
- **Reguły ochrony (ruleset) dla `main`:** wymagany PR; wymagane zadania CI z § 3 (status „success”); historia liniowa; zakaz force-push i usuwania gałęzi; wymagane rozwiązanie wątków przeglądu; reguły obowiązują także właściciela (bez obejść). Podpisane commity — zalecane.
- **Przegląd:** właściciel przegląda każdy PR, także przygotowany przez agenta AI (Codex, Claude) — T-SC-06; plik `CODEOWNERS` wskazuje właściciela dla `docs/06-bezpieczenstwo/`, `infra/`, `.github/`, `packages/db/`, `apps/api/src/auth/`.
- Przegląd właściciela jest obowiązkiem procesu (R-11), nie jest egzekwowany mechanizmem zatwierdzeń GitHuba; `CODEOWNERS` wskazuje obszary wymagające szczególnej uwagi. Przy jednym współpracowniku ruleset wymaga 0 zatwierdzeń i nie wymaga zatwierdzenia code ownera, bez odrębnej tożsamości autora i bez bypass. Pozostałe reguły ochrony obowiązują bez zmian (decyzja właściciela z 2026-09-20, R-23; bez nowego ADR).
- **Ustawienia repozytorium:** skanowanie sekretów z push protection, CodeQL, alerty Dependabot, prywatne zgłaszanie podatności (ADR-013); domyślne uprawnienia tokenu zadań: tylko odczyt; akcje tylko z listy dozwolonych (organizacje `actions`, `github`, `docker`, `sigstore`, `pnpm`, `astral-sh` i zweryfikowani twórcy) i przypięte SHA.

## 3. Zadania CI (pull request i `main`)

**BL-017/018/035 (2026-09-30):** uzupełniamy istniejące workflow `contracts`, `db`, `modules`, `workers` i `web` o `repository` (dokumentacja i higiena repo), `lint`, `typecheck`, `unit`, sześć wariantów `build`, `deps-audit` i `e2e`. Budżety i Lighthouse pozostają krokami `web`, typy klienta w `contracts`; nie tworzymy zduplikowanych kontekstów. Ruleset pozostaje wyłączony; nazwy rozszerzamy dopiero po potwierdzeniu rzeczywistych zielonych przebiegów. Wyniki i otwarte kryteria w [raporcie M0-1](../08-plan/m0-1-session-report.md).`pnpm ci:deps-audit` uruchamia przypięte OSV 2.6.0 i Syft 1.52.0 (SHA-256 sprawdzane przed wykonaniem). Skan z jawnym `--config=osv-scanner.toml` obejmuje oba lockfile; dodatkowy pełny skan bez filtracji służy raportowaniu i egzekwowaniu zatwierdzonych wyjątków. Próg wynosi zawsze 7,0. Wpis wymaga daty `approved=YYYY-MM-DD`, uzasadnienia, identyfikatora ryzyka i terminu do 90 dni; wygasły lub niepoprawny wpis blokuje. Błąd skanera/parsera, brak oceny, pakietu w SBOM lub nieznana licencja także blokuje. Raport Markdown, pełne JSON i CycloneDX trafiają do artefaktu także przy czerwonym wyniku. Moderate/low pozostają w podsumowaniu dla przeglądu Renovate. Testy polityki są offline.

## 10. Kontrole M0-1 — uruchamianie lokalne

`pnpm ci:lint`, `pnpm ci:typecheck`, `pnpm ci:unit` obejmują całe monorepo. `pnpm ci:build -- <none|analytics|alerts|education|admin|quick-actions>` tworzy dla pominiętego modułu czystą kopię śledzonych źródeł, instalacje frozen i własny cache; nie edytuje oryginalnego workspace.

`pnpm ci:e2e` buduje web/API/db, uruchamia izolowany projekt Compose i seed, API w trybie production z losowymi sekretami przez `*_FILE` oraz produkcyjny Next na lokalnym HTTPS. Wymaga przeglądarek z `pnpm --filter @oliginvest/web exec playwright install --with-deps chromium webkit firefox` i OpenSSL (Ubuntu; Git for Windows). Certyfikat powstaje na czas testu, nie trafia do repo ani raportów. Nagłówki CSP pozostają produkcyjne. Rejestrujący proxy testowy przekazuje sondę live do prawdziwego API; test readiness sprawdza PostgreSQL i obie instancje Valkey. Cały zestaw zabezpieczeń, UI i axe działa w trzech silnikach; błąd i sukces sprzątają procesy oraz własne wolumeny. Raport HTML i logi są artefaktem CI. M0-2 zastąpi lokalne procesy obrazami po BL-020–023; MFA/regulamin i scenariusze domenowe dopiero M1.
