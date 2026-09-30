# Archiwalny szkic workflow M0-1

**Cel:** zachować pochodzenie konfiguracji przygotowanej podczas karencji i wskazać aktywne kontrole BL-017/018/035.

Szkic ci.yml jest archiwalny — **nie kopiować go do workflows/**. Jego zakres został rozdzielony bez zduplikowanych nazw zadań:

| Aktywny plik | Konteksty / odpowiedzialność |
|---|---|
| ../workflows/ci.yml | repository (Cel, linki, FR/NFR ↔ BL, fixtures, Conventional Commits), lint, typecheck, unit, build (all) i pięć buildów bez modułów |
| ../workflows/contracts.yml | contracts: OpenAPI, pending, wygenerowane typy klienta |
| ../workflows/db.yml | db: migracje, pełne porównanie SQL, RLS i pule |
| ../workflows/modules.yml | modules: granice, testy negatywne, generator, zgodność nazw workflow/rulesetu |
| ../workflows/workers.yml | workers: kolejki Node/Python, seed, uruchomienie czterech aplikacji |
| ../workflows/web.yml | web: UI/i18n, server-only, size-limit, budżety tras i Lighthouse (raport w M0) |
| ../workflows/e2e.yml | e2e: Chromium/WebKit/Firefox, axe, production build, HTTPS i compose.dev.yaml |
| ../workflows/deps-audit.yml | deps-audit: oba lockfile, próg CVSS ≥7, wyjątki OSV, licencje z CycloneDX |

Polecenia i warunki sprzątania opisuje [CI/CD §10](../../docs/07-wdrozenie/ci-cd.md#10-kontrole-m0-1--uruchamianie-lokalne). Raport audytu trafia do artefaktów także po błędzie. Testy polityki nie używają sieci. JSON Schema domenowych zadań analytics dojdzie wraz z ich implementacją w M3; obecny ACK sprawdza workers.

Ruleset pozostaje disabled. Jego konteksty odpowiadają rzeczywistym nazwom własnych zadań; CodeQL jest osobną regułą natywną, a nie fikcyjnym zadaniem. Właściciel aktywuje ustawienia po scaleniu według [instrukcji](../../docs/07-wdrozenie/ustawienia-repozytorium.md). Obrazy i wydanie należą do M0-2.

## Przypięcia akcji

Sprawdzono 2026-09-20 przez GitHub API (`git/ref/tags`, a następnie `git/tags` dla tagów adnotowanych):

| Akcja / linia | Commit |
|---|---|
| actions/checkout v5 | `fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09` |
| actions/setup-node v5 | `a0853c24544627f65ddf259abe73b1d18a591444` |
| actions/setup-python v6 | `ece7cb06caefa5fff74198d8649806c4678c61a1` |
| pnpm/action-setup v4 | `b906affcce14559ad1aafd4ab0e942779e9f58b1` |
| astral-sh/setup-uv v6 | `d0cc045d04ccac9d8b7881df0226f9e82c39688e` |
| actions/upload-artifact v4 | `ea165f8d65b6e75b540449e92b4886f43607fa02` |

Te akcje są z organizacji już dopuszczonych w CI/CD § 2. Konfiguracja nie publikuje obrazów, nie używa OIDC ani nie wykonuje wdrożeń; te zadania należą do M0-2.
