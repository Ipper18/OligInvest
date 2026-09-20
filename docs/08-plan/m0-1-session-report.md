# M0-1 — raport przygotowania podczas karencji

**Cel:** zapisać wykonane prace, ich weryfikację i brakujące dowody paczki BL-001–BL-019 oraz BL-032–BL-035, bez utożsamiania przygotowanych plików z działającą aplikacją lub CI.

Stan: **2026-09-20**, gałąź `feat/m0-1-skeleton` utworzona z `main` po scaleniu PR #1. **Konfiguracja przygotowana; nie uruchomiono jeszcze w CI** — dotyczy nowego szkicu własnych workflow. Istniejący CodeQL dla Pythona uruchomił się automatycznie po otwarciu [roboczego PR #2](https://github.com/Ipper18/OligInvest/pull/2); wynik odnotowano w § 3. Ten raport będzie uzupełniony po instalacji i wykonaniu szkieletu. M0 pozostaje otwarty.

## 1. Zrobione

- BL-001: utrwalony [audyt grafu](audits/m0-1-release-age.json), wspólny termin karencji **2026-09-21 18:31:49 Europe/Warsaw**; brak osłabienia polityki i zmian ADR-002. Szczegóły metody i jej ograniczeń: [raport BL-001 § 5](bl-001-bootstrap-readiness.md#5-audyt-całego-wybranego-grafu-przed-oczekiwaniem).
- BL-001, część plikowa: `pnpm-workspace.yaml` z pełną polityką SEC § 4.3, `.npmrc`, `.nvmrc` (24.21.0), Turbo, Biome, bazowy TypeScript strict i 21 konfiguracji TS. **23 prywatne manifesty**: root, 4 aplikacje, 9 modułów i 9 pakietów; eksporty modułów ograniczone do czterech publicznych ścieżek. Przygotowane manifesty i konfiguracje **nie zostały zweryfikowane instalacją, lintem, typecheckiem ani buildem**. Nie powstały jeszcze ich źródła i testy dymne (BL-002 pozostaje otwarty).
- Wersje 35 deklaracji zależności zewnętrznych są dokładnie zgodne z zapisanym audytem; 7 deklaracji `workspace:*` wskazuje istniejące manifesty. Nie dodano całego grafu naukowego ani funkcji domenowych. Pakiety pomocnicze typów, pokrycia i adapter CSS uzasadniono w STACK § 3.1. `allowBuilds: {}` pozostaje puste do przeglądu konkretnych skryptów. `pmOnFail: error` wymaga właściwego pnpm bez automatycznego pobierania; ustawienia pnpm 12 są w YAML, a `.npmrc` zawiera tylko rejestr.
- Dokumentacja: BL-034 pozostaje w M0-1, zależy od BL-013/BL-014; BL-018 rozdzielony między lokalny build produkcyjny i późniejsze obrazy; stara propozycja w raporcie PR #1 zastąpiona zatwierdzoną decyzją. Backlog i paczki spójne.
- BL-017, przygotowanie: nieaktywny [szkic workflow](../../.github/workflow-drafts/ci.yml), macierz build bez modułów, planowane kontrole i raporty; akcje przypięte do zweryfikowanych pełnych SHA, wyłącznie `contents: read`, checkout bez zachowania poświadczeń, brak `pull_request_target`.
- BL-019, przygotowanie: [CODEOWNERS](../../.github/CODEOWNERS), [szablon PR](../../.github/pull_request_template.md) z 11 punktami DoD, [Renovate](../../renovate.json), [nieaktywny ruleset](../../.github/rulesets/main.json), [instrukcja właściciela](../07-wdrozenie/ustawienia-repozytorium.md). Ustawienia GitHub tylko odczytano.
- Kontrola `.xlsx/.csv` spoza `fixtures/anonymized` i tytułów PR, z testami pozytywnymi i negatywnymi; standard Node, bez nowych zależności. Pusty tytuł jest dozwolony dla zdarzenia push, odrzucany dla pull_request.
- CodeQL: instrukcja jawnie wymaga konfiguracji domyślnej **po scaleniu M0-1** oraz ponownej kontroli `javascript-typescript`, `python` i dostępności `actions` w panelu, z zapisaniem wyniku.
- BL-019 / R-23: zgodnie z decyzją właściciela ruleset wymaga **0 zatwierdzeń**, bez wymogu code owner review, osobnej tożsamości autora i bypass. Przegląd pozostaje obowiązkiem procesu R-11; CODEOWNERS wskazuje obszary uwagi. Ujednolicono CONTRIBUTING, CI/CD, instrukcję i ryzyka; bez ADR.
- BL-034, część plikowa: [samodzielny Compose](../../compose.dev.yaml), PostgreSQL 18.6, Valkey 9.1.2 ×2 i Mailpit 1.31.1, przypięte digesty; kolejka z AOF/noeviction, cache allkeys-lru bez trwałości, sieć wewnętrzna, wymagane lokalne zmienne. [Instrukcja](../07-wdrozenie/srodowisko-deweloperskie.md) oddziela walidację od uruchomienia i bootstrap bazy od roli aplikacji.
- BL-035: [kontrola dokumentacji](../../scripts/check-docs.mjs) na standardowym Node, 13 testów pozytywnych i negatywnych. Kontroluje pierwsze zdanie „Cel:”, lokalne linki Markdown i pełne przypisania FR/NFR ↔ BL. W macierzy rozwinięto ukryte listy „(+N)” i naprawiono niedomknięty fragment kodu; w researchu przesunięto cel przed aktualizację. BL-708 nadal jest jawną propozycją bez FR/NFR, obecną w rejestrze luk; nie dodano mu nowego wymagania. Polecenia podłączono wyłącznie do nieaktywnego szkicu workflow.

## 2. Pominięte i przyczyny

| Praca | Stan / powód |
|---|---|
| Instalacje npm/PyPI, rozwiązywanie grafu i lockfile | nie wykonywano, zgodnie z zakazem właściciela podczas tej sesji; przygotowano wyłącznie pliki BL-001 |
| BL-002–016, BL-032–033 | implementacja po gotowych zależnościach i zgodnym środowisku; obecnie brak kodu aplikacji, migracji i testów dymnych pakietów |
| BL-034: działające środowisko | brak uruchomienia kontenerów, migracji/ról, seedów i połączeń workerów; `pnpm dev` jest przygotowanym poleceniem, nie zweryfikowaną funkcją |
| BL-035: CI | kontrola lokalna przechodzi; zadanie pozostaje otwarte do uruchomienia w CI po BL-017 |
| BL-017: aktywne workflow i uruchomienie CI | brak poleceń i lockfile; szkic pozostaje poza `.github/workflows/` |
| BL-018: testy trzech przeglądarek | niewykonane; część na obrazach produkcyjnych pozostaje do M0-2 / BL-020–023 |
| BL-019: aktywacja ustawień, Renovate i rulesetu | wykonuje właściciel po scaleniu; R-23 rozstrzygnięte, ustawienia panelu nadal do potwierdzenia |
| BL-032: zgodność TypeScript 7 | brak instalacji, więc nie ma wyniku ani podstaw do oznaczenia spike jako zamkniętego |
| Pełna walidacja YAML, schematu Renovate i akcji w CI | do wykonania po karencji; sprawdzono ręcznie treść oraz metadane przypięć, nie uruchomienie |
| Serwery, sekrety, wdrożenie, logika domenowa | poza zakresem paczki i uprawnieniami |

## 3. Weryfikacja lokalna

- `node --test scripts/check-repository.test.mjs`: **7/7 PASS** na zastanym Node 25.1.0; testy poprzedzały implementację, dodatkowy przypadek push/PR wykrył i potwierdził poprawkę obsługi pustego tytułu. Ponowić na Node 24 przed zakończeniem BL-001.
- `node --test scripts/check-docs.test.mjs scripts/check-repository.test.mjs`: **20/20 PASS**, w tym 13 nowych testów dokumentacji; testy przygotowane przed implementacją. `node scripts/check-docs.mjs`: **PASS dla 73 dokumentów**. Sprawdzane są pliki/katalogi, bez zdalnych URL i kotwic nagłówków. Node 25.1.0, bez nowych bibliotek i bez zmiany globalnej instalacji.
- `docker compose -f compose.dev.yaml config`: **PASS** na zastanym Compose 5.1.3, z syntetycznymi wartościami wyłącznie w środowisku procesu; również wariant instrukcji `--env-file .env.example ... config --quiet`: PASS. Model JSON: 4 usługi, porty związane z pętlą zwrotną, sieć internal, osobne polityki kolejki/cache: PASS. Brak wymaganych zmiennych: poprawne odrzucenie. Nie pobrano warstw obrazów i nie uruchomiono kontenerów. To walidacja parsera, nie dowód runtime ani walidacja na Compose v2 z docelowego środowiska.
- Manifesty: **23/23 poprawne JSON**, 35 dokładnych deklaracji zewnętrznych zgodnych z audytem, 7 lokalnych odwołań do nazw istniejących pakietów; poprawne cztery klucze eksportów modułów; `core` ma tylko `decimal.js`, manifest web nie zależy od db. Kontrola statyczna nie zastępuje testu importów ani TypeScript. Brak `pnpm-lock.yaml`, `uv.lock` i `node_modules` potwierdzony; grafu nie rozwiązywano ponownie.
- `node scripts/check-repository.mjs`: PASS dla plików śledzonych w repozytorium; kontrola samej lokalizacji nie dowodzi anonimizacji zawartości fixtures.
- `git diff --check`: PASS.
- Kontrola JSON i lokalnych linków plikowych w zmienionych dokumentach: **PASS** (kotwice nagłówków nie były osobno walidowane). Inwentarz: wszystkie 559 wpisów npm mają SHA-512, wszystkie 2308 plików PyPI mają SHA-256; maksimum dat publikacji + 4320 minut zgadza się z terminem w raporcie: **PASS**.
- Kontrola statyczna szkicu workflow: **19 odwołań `uses`** do 6 akcji, każde z pełnym SHA; jedna deklaracja `permissions: { contents: read }`, brak `pull_request_target`: **PASS**. Ruleset ma `enforcement: disabled` i brak bypass: **PASS**. To kontrola wskazanych pól, nie pełna walidacja YAML ani test wykonania.
- `pnpm turbo run lint typecheck test build`, `pnpm db:test`, testy OpenAPI, RLS, e2e i budżety: **NIE URUCHOMIONO**. Skan podatności: **NIE URUCHOMIONO**. Nie ma dowodu zielonego CI.
- GitHub uruchomił istniejącą konfigurację domyślną CodeQL: `Analyze (python)` i kontrola `CodeQL` — **PASS** dla commita `08cb4cc`, [przebieg](https://github.com/Ipper18/OligInvest/actions/runs/35526140837), zakończony 2026-09-20 17:32:30 UTC. Wynik nie potwierdza skanowania przyszłego TypeScript ani `actions` i nie zastępuje pełnego CI M0-1. Nie zmieniono ustawień CodeQL.
- Kontrola zmienionych plików pod kątem literalnych IPv4 i przypisań przypominających sekrety — **PASS**; nie zastępuje GitHub secret scanning ani przeglądu właściciela.

## 4. Estymacje, decyzje i ryzyka

- Bazowa suma estymacji wybranych zadań: **31,5 dnia idealnego**; zakres zadania BL-018 obejmuje również pozostałą część w M0-2. Estymacji nie zmieniono.
- BL-001 (1 d), BL-017 (2 d), BL-019 (1 d), BL-034 (1 d), BL-035 (0,5 d) pozostają `w toku`: pliki i wskazane kontrole lokalne są przygotowane, pełne kryteria nie są spełnione. Prace plikowe BL-034/035 przed ukończeniem ich zależności zostały jawnie zlecone przez właściciela. Odchylenie nakładu będzie policzone po wykonaniu; oczekiwanie kalendarzowe liczone osobno. Estymacji nie zmieniono i nie przypisano oszczędności niewykonanym zadaniom.
- Przy kontynuacji zastano czystą gałąź z wypchniętym commitem `8d91754` (`Document dependency readiness and split M0 CI responsibilities`), zawierającym przygotowane pliki. Jego tytuł nie jest Conventional Commit; zachowano commit właściciela bez przepisywania historii. Kolejne commity i tytuł PR używają wymaganej konwencji. Rozbieżność należy uwzględnić przy uruchamianiu kontroli historii commitów; nie wyłączać jej po cichu.
- ADR: brak zmian i brak potrzeby zmiany ADR-002 dla wybranego terminu. Późniejsza niż 2026-09-24 wymagana linia, zmiana stosu albo konfiguracja zaawansowana CodeQL wymagają zatrzymania i nowej propozycji decyzji.
- R-23 rozstrzygnięte 2026-09-20 przez właściciela; ocena obniżona z 15 do 3 po zmianie definicji rulesetu. Przy aktywacji trzeba potwierdzić 0 zatwierdzeń i brak code owner review w panelu.
- Ryzyka nadal otwarte: R-22 — wybrany graf i granica oczekiwania; R-24 — deprecated `@esbuild-kit/*` w Drizzle Kit. Sam znacznik deprecated nie jest wynikiem skanowania podatności. Nowych decyzji do ADR ani nowych ryzyk produktowych w tej części nie dodano; niezweryfikowane manifesty, skrypty instalacyjne, obrazy i połączenia są jawnymi brakami dowodów przed ukończeniem M0.

## 5. Kryteria wyjścia M0 i kontynuacja

| Kryterium | Stan i brakujący dowód |
|---|---|
| 1 — monorepo, testy, granice, build bez education | niespełnione; brak implementacji i pełnego przebiegu na Node 24 |
| 2 — migracje, zgodność SQL, RLS | niespełnione; brak migracji i wyników PostgreSQL/CI |
| 3 — OpenAPI i malejąca lista pending | niespełnione; brak implementacji porównania |
| 7 — ustawienia repozytorium | częściowo przygotowane pliki; aktywacja i dowody właściciela nadal wymagane |
| 8 — część BL-032 | niespełnione; spike dopiero po instalacji |

Kontynuować po upływie karencji na tej samej gałęzi i w tym samym PR: zgodne lokalne narzędzia, lockfile z porównaniem do inwentarza, instalacja frozen, implementacja według zależności, testy i uzupełnienie tego raportu. Nie scalać PR i nie oznaczać M0 jako zakończonego. W czasie oczekiwania nie uruchamiać instalacji świeżych wydań ani nie zmieniać zegara/polityki.

Automatyzację „OligInvest — kontynuacja M0-1 po karencji” **usunięto 2026-09-20** na prośbę właściciela (narzędzie aplikacji potwierdziło `deleted`). Nie ma zaplanowanego automatycznego wznowienia; właściciel wróci ręcznie do tej gałęzi i PR #2 po karencji. Nie należy powtarzać bootstrapu ani tworzyć nowego PR.
