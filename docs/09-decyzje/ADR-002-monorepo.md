# ADR-002: Monorepo Turborepo + pnpm ze strukturą `apps/`, `modules/`, `packages/`

**Cel:** zapisać wybór organizacji repozytorium (Turborepo + pnpm, `apps/`, `modules/`, `packages/`) i mechanizmów pilnujących granic modułów.

- **Status:** zaakceptowana
- **Data:** 2026-09-18
- **Decydent:** właściciel projektu
- **Powiązane wymagania:** NFR-02.01–NFR-02.03, NFR-02.07, NFR-10.05

## Kontekst

Specyfikacja (§4.2) wymaga monorepo (Turborepo lub Nx) z podziałem na `apps/` i `packages/` oraz modułów funkcjonalnych, które można dodać lub usunąć bez modyfikacji pozostałych. W jednym repozytorium żyją aplikacje w dwóch językach (TypeScript, Python), wspólne obliczenia (`packages/core`) i dokumentacja. Kod będzie generowany przez agenta (Codex), więc granice muszą być egzekwowane technicznie, a nie tylko opisane.

## Rozważane opcje

| Opcja | Zalety | Wady | Koszt / licencja |
|---|---|---|---|
| **Turborepo + pnpm workspaces** | Prosta konfiguracja (`turbo.json`), cache zadań per pakiet, pnpm izoluje zależności (brak importów „fantomowych”) | Brak generatorów kodu i reguł granic „z pudełka” | MIT, 0 zł |
| Nx | Generatory, reguły granic modułów (`enforce-module-boundaries`), wykres zależności | Więcej abstrakcji i konfiguracji; wtyczki per framework; stroma krzywa dla agenta | MIT (rdzeń), 0 zł |
| Same pnpm workspaces | Najmniej narzędzi | Brak cache i orkiestracji zadań; wolniejsze CI | MIT |
| Polyrepo | Twarde granice | Synchronizacja wersji kontraktów, wiele pipeline'ów — koszt bez korzyści dla jednej osoby | — |

## Decyzja

**Turborepo 2.11 + pnpm 12 workspaces** (wersja startowa M0: 2.10.13, następnie osobny PR do 2.11 zgodnie z [ADR-015](ADR-015-linia-turborepo-na-starcie-m0.md)) ze strukturą trzech katalogów: `apps/` (korzenie kompozycji: `web`, `api`, `jobs`, `analytics`), `modules/` (moduły domenowe `@oliginvest/mod-*`), `packages/` (warstwa wspólna: `platform`, `core`, `contracts`, `db`, `data-providers`, `ui`, `i18n`, `config`, `test-vectors`). Granice egzekwujemy trzema mechanizmami bez dodatkowych zależności: (1) pole `exports` w `package.json` każdego modułu, (2) ścisła izolacja pnpm (import tylko zadeklarowanych zależności), (3) skrypt `pnpm check:deps` w CI walidujący graf zależności względem warstw z [`../01-architektura/moduly.md`](../01-architektura/moduly.md). Aplikacja Python (`apps/analytics`) ma własny `pyproject.toml` + `uv.lock` oraz minimalny `package.json` ze skryptami (`test`, `lint`, `typecheck`) wywołującymi `uv`, aby Turborepo obejmowało ją w jednym grafie zadań.

## Konsekwencje

- Pozytywne: jedno repozytorium i jeden PR dla zmian przekrojowych (kontrakt + API + UI); cache Turborepo skraca CI; struktura czytelna dla agenta.
- Negatywne: katalog `modules/` wykracza poza minimalny podział `apps/` + `packages/` ze specyfikacji — to rozszerzenie dopuszczone przez §5; własny skrypt `check:deps` trzeba utrzymywać.
- Zadania: szablon modułu i generator `pnpm gen:module` (M0); skrypt `check:deps` (M0); zadanie CI „build bez modułu opcjonalnego” (M0).

## Weryfikacja

W M0: `pnpm turbo run build test` przechodzi dla pustych pakietów; próba importu `@oliginvest/mod-alerts` z `modules/analytics` kończy się błędem `check:deps`; build z usuniętym `modules/education` przechodzi.
