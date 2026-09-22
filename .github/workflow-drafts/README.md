# Szkice workflow M0-1

**Cel:** przygotować konfigurację CI podczas karencji bez uruchamiania nieistniejących jeszcze poleceń i bez pozornego spełnienia kryteriów M0.

**Konfiguracja przygotowana; nie uruchomiono jeszcze w CI.** GitHub uruchamia workflow z `.github/workflows/`, więc pliki w tym katalogu są nieaktywne. Przenieść je dopiero w BL-017 po implementacji poleceń, utworzeniu lockfile i lokalnej weryfikacji. Wpisy `uses` są przypięte do commitów, także po rozwinięciu tagów adnotowanych.

## Warunki aktywacji

- `pnpm-lock.yaml` i `apps/analytics/uv.lock` istnieją, instalacje frozen działają przy niezmienionej polityce; wszystkie wersje porównane z audytem BL-001.
- Root package udostępnia rzeczywiste `ci:lint`, `ci:typecheck`, `ci:unit`, `ci:contracts`, `ci:db`, `ci:budgets`, `ci:e2e`, `ci:deps-audit`, `ci:lighthouse` oraz `ci:build -- <moduł|none>`. Nie tworzyć atrap zwracających sukces.
- `ci:db`, `ci:e2e` i `ci:lighthouse` samodzielnie przygotowują i sprzątają lokalne usługi testowe; e2e/lighthouse startują build produkcyjny, nie `next dev`. Dane wyłącznie syntetyczne. E2E obejmuje Chromium, WebKit i Firefox z axe.
- `ci:build` dla wariantu bez modułu buduje odizolowaną kopię bez tego modułu; wyłączenie flagi runtime nie zastępuje testu granic kompilacji.
- `ci:contracts` obejmuje OpenAPI/pending, generowane typy/JSON Schema, granice importów i spójność dokumentacji. `ci:deps-audit` obejmuje npm/PyPI, próg podatności oraz licencje; pobierane narzędzia przypięte i zweryfikowane.
- Lighthouse w M0 używa trybu raportowego; brak wymaganego status check aż do M1. Raporty testów nie mogą zawierać sekretów ani rzeczywistych danych.
- Zweryfikować składnię i semantykę YAML, ścieżki raportów, kontrakty wszystkich poleceń, SHA akcji i odpowiadające im wejścia. Potwierdzenie samych SHA nie jest walidacją uruchomienia workflow.
- Po pierwszym rzeczywistym przebiegu zsynchronizować nazwy status checks w definicji rulesetu. CodeQL pozostaje poza własnymi workflow, zgodnie z [instrukcją właściciela](../../docs/07-wdrozenie/ustawienia-repozytorium.md).

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
