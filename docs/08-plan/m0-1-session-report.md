# M0-1 — raport przygotowania podczas karencji

**Cel:** zapisać wykonane prace, ich weryfikację i brakujące dowody paczki BL-001–BL-019 oraz BL-032–BL-035, bez utożsamiania przygotowanych plików z działającą aplikacją lub CI.

Stan: **2026-09-20**, gałąź `feat/m0-1-skeleton` utworzona z `main` po scaleniu PR #1. **Konfiguracja przygotowana; nie uruchomiono jeszcze w CI.** Ten raport będzie uzupełniony po instalacji i wykonaniu szkieletu. M0 pozostaje otwarty.

## 1. Zrobione

- BL-001: utrwalony [audyt grafu](audits/m0-1-release-age.json), wspólny termin karencji **2026-09-21 18:31:49 Europe/Warsaw**; brak osłabienia polityki i zmian ADR-002. Szczegóły metody i jej ograniczeń: [raport BL-001 § 5](bl-001-bootstrap-readiness.md#5-audyt-całego-wybranego-grafu-przed-oczekiwaniem).
- Dokumentacja: BL-034 pozostaje w M0-1, zależy od BL-013/BL-014; BL-018 rozdzielony między lokalny build produkcyjny i późniejsze obrazy; stara propozycja w raporcie PR #1 zastąpiona zatwierdzoną decyzją. Backlog i paczki spójne.
- BL-017, przygotowanie: nieaktywny [szkic workflow](../../.github/workflow-drafts/ci.yml), macierz build bez modułów, planowane kontrole i raporty; akcje przypięte do zweryfikowanych pełnych SHA, wyłącznie `contents: read`, checkout bez zachowania poświadczeń, brak `pull_request_target`.
- BL-019, przygotowanie: [CODEOWNERS](../../.github/CODEOWNERS), [szablon PR](../../.github/pull_request_template.md) z 11 punktami DoD, [Renovate](../../renovate.json), [nieaktywny ruleset](../../.github/rulesets/main.json), [instrukcja właściciela](../07-wdrozenie/ustawienia-repozytorium.md). Ustawienia GitHub tylko odczytano.
- Kontrola `.xlsx/.csv` spoza `fixtures/anonymized` i tytułów PR, z testami pozytywnymi i negatywnymi; standard Node, bez nowych zależności. Pusty tytuł jest dozwolony dla zdarzenia push, odrzucany dla pull_request.
- CodeQL: instrukcja jawnie wymaga konfiguracji domyślnej **po scaleniu M0-1** oraz ponownej kontroli `javascript-typescript`, `python` i dostępności `actions` w panelu, z zapisaniem wyniku.

## 2. Pominięte i przyczyny

| Praca | Stan / powód |
|---|---|
| Instalacje npm/PyPI, lockfile i bootstrap BL-001 | przed terminem karencji; nie wykonano instalacji ani obejścia polityki |
| BL-002–016, BL-032–035 | implementacja po gotowych zależnościach i zgodnym środowisku; obecnie brak kodu aplikacji, migracji i testów M0 |
| BL-017: aktywne workflow i uruchomienie CI | brak poleceń i lockfile; szkic pozostaje poza `.github/workflows/` |
| BL-018: testy trzech przeglądarek | niewykonane; część na obrazach produkcyjnych pozostaje do M0-2 / BL-020–023 |
| BL-019: aktywacja ustawień, Renovate i rulesetu | wykonuje właściciel po scaleniu; dodatkowo wymaga rozstrzygnięcia self-approval |
| BL-032: zgodność TypeScript 7 | brak instalacji, więc nie ma wyniku ani podstaw do oznaczenia spike jako zamkniętego |
| Pełna walidacja YAML, schematu Renovate i akcji w CI | do wykonania po karencji; sprawdzono ręcznie treść oraz metadane przypięć, nie uruchomienie |
| Serwery, sekrety, wdrożenie, logika domenowa | poza zakresem paczki i uprawnieniami |

## 3. Weryfikacja lokalna

- `node --test scripts/check-repository.test.mjs`: **7/7 PASS** na zastanym Node 25.1.0; testy poprzedzały implementację, dodatkowy przypadek push/PR wykrył i potwierdził poprawkę obsługi pustego tytułu. Ponowić na Node 24 przed zakończeniem BL-001.
- `node scripts/check-repository.mjs`: PASS dla plików śledzonych w repozytorium; kontrola samej lokalizacji nie dowodzi anonimizacji zawartości fixtures.
- `git diff --check`: PASS.
- Kontrola JSON, lokalnych linków w zmienionych dokumentach, kompletności sum i przeliczenia maksymalnego terminu audytu: do zapisania po końcowym sprawdzeniu.
- `pnpm turbo run lint typecheck test build`, `pnpm db:test`, testy OpenAPI, RLS, e2e i budżety: **NIE URUCHOMIONO**. Skan podatności: **NIE URUCHOMIONO**. Nie ma dowodu zielonego CI.

## 4. Estymacje, decyzje i ryzyka

- Bazowa suma estymacji wybranych zadań: **31,5 dnia idealnego**; zakres zadania BL-018 obejmuje również pozostałą część w M0-2. Estymacji nie zmieniono.
- BL-001 (1 d), BL-017 (2 d), BL-019 (1 d) pozostają `w toku` wyłącznie w zakresie przygotowania. Odchylenie nakładu będzie policzone po ich wykonaniu; oczekiwanie do podanego terminu jest opóźnieniem kalendarzowym, nie dniem wykonanej implementacji. Nie przypisano oszczędności estymacji niewykonanym zadaniom.
- ADR: brak zmian i brak potrzeby zmiany ADR-002 dla wybranego terminu. Późniejsza niż 2026-09-24 wymagana linia, zmiana stosu albo konfiguracja zaawansowana CodeQL wymagają zatrzymania i nowej propozycji decyzji.
- Do rozstrzygnięcia przed aktywacją rulesetu: GitHub nie pozwala `Ipper18` zatwierdzić PR własnego autorstwa; pytanie właściciela dotyczy odrębnej tożsamości autora albo jawnego przeglądu bez self-approval. Nie zmieniono automatycznie wymagań zatwierdzania.
- Ryzyka: R-22 uzupełniony o cały graf i granicę oczekiwania; R-23 — blokada self-approval; R-24 — deprecated `@esbuild-kit/*` w Drizzle Kit. Sam znacznik deprecated nie jest wynikiem skanowania podatności.

## 5. Kryteria wyjścia M0 i kontynuacja

| Kryterium | Stan i brakujący dowód |
|---|---|
| 1 — monorepo, testy, granice, build bez education | niespełnione; brak implementacji i pełnego przebiegu na Node 24 |
| 2 — migracje, zgodność SQL, RLS | niespełnione; brak migracji i wyników PostgreSQL/CI |
| 3 — OpenAPI i malejąca lista pending | niespełnione; brak implementacji porównania |
| 7 — ustawienia repozytorium | częściowo przygotowane pliki; aktywacja i dowody właściciela nadal wymagane |
| 8 — część BL-032 | niespełnione; spike dopiero po instalacji |

Kontynuować po upływie karencji na tej samej gałęzi i w tym samym PR: zgodne lokalne narzędzia, lockfile z porównaniem do inwentarza, instalacja frozen, implementacja według zależności, testy i uzupełnienie tego raportu. Nie scalać PR i nie oznaczać M0 jako zakończonego. W czasie oczekiwania nie uruchamiać instalacji świeżych wydań ani nie zmieniać zegara/polityki.
