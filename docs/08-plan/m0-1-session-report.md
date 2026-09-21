# M0-1 — raport przygotowania podczas karencji

**Cel:** zapisać wykonane prace, ich weryfikację i brakujące dowody paczki BL-001–BL-019 oraz BL-032–BL-035, bez utożsamiania przygotowanych plików z działającą aplikacją lub CI.

Stan: **2026-09-21**, gałąź `feat/m0-1-skeleton` utworzona z `main` po scaleniu PR #1. **Konfiguracja przygotowana; nie uruchomiono jeszcze w CI** — dotyczy nowego szkicu własnych workflow. Istniejący CodeQL dla Pythona uruchomił się automatycznie po otwarciu [roboczego PR #2](https://github.com/Ipper18/OligInvest/pull/2); wynik odnotowano w § 3. Ten raport będzie uzupełniony po instalacji i wykonaniu szkieletu. Próba wznowienia przed końcem karencji: § 6. M0 pozostaje otwarty.

## 1. Zrobione

- BL-001: utrwalony [audyt grafu](audits/m0-1-release-age.json); pierwotny termin z Turbo 2.11.0 wynosił **2026-09-21 18:31:49 Europe/Warsaw**. Decyzja właściciela ADR-015 zmienia start na Turbo 2.10.13, bez osłabienia polityki; pozostałe blokady i nowy termin **16:13:56** tego dnia opisuje § 7. Szczegóły pierwotnej metody: [raport BL-001 § 5](bl-001-bootstrap-readiness.md#5-audyt-całego-wybranego-grafu-przed-oczekiwaniem).
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
- ADR: przyjęty **ADR-015** na polecenie właściciela 2026-09-21 — start Turbo 2.10.13, potem osobny PR Renovate do 2.11. ADR-002 pozostaje w mocy z odwołaniem do doprecyzowania linii startowej. Innych wersji i decyzji nie zmieniono; późniejsza niż 2026-09-24 wymagana linia, inna zmiana stosu albo konfiguracja zaawansowana CodeQL wymagają zatrzymania i nowej propozycji decyzji.
- R-23 rozstrzygnięte 2026-09-20 przez właściciela; ocena obniżona z 15 do 3 po zmianie definicji rulesetu. Przy aktywacji trzeba potwierdzić 0 zatwierdzeń i brak code owner review w panelu.
- Ryzyka nadal otwarte: R-22 — wybrany graf i granica oczekiwania; R-24 — deprecated `@esbuild-kit/*` w Drizzle Kit. Sam znacznik deprecated nie jest wynikiem skanowania podatności. Poza ADR-015 nie dodano nowych decyzji do ADR ani nowych ryzyk produktowych; niezweryfikowane manifesty, skrypty instalacyjne, obrazy i połączenia są jawnymi brakami dowodów przed ukończeniem M0.

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

## 6. Kontrola przed instalacją — 2026-09-21 rano

Na czystej gałęzi `feat/m0-1-skeleton`, od commita `aa388d8`, potwierdzono rzeczywiste wyniki poleceń: **`node --version` → `v24.21.0`**, **`pnpm --version` → `12.4.2`**. Nie zmieniano instalacji globalnych ani polityki zależności. Po sprawdzeniu wersji pnpm stwierdzono nowy, częściowy `pnpm-lock.yaml` (4560 bajtów, czas utworzenia `2026-09-21T05:05:09Z`) z jedynym importerem `.` i `packageManagerDependencies: pnpm@12.4.2` oraz binariami `@pnpm/exe.*`. Nie zawiera aplikacji ani ich zależności. Zachowano go lokalnie jako `.git/m0-1-pnpm-version-bootstrap-lock.yaml`, bez commitowania i bez nadpisywania; nie jest lockfile aplikacji ani dowodem przeprowadzonego audytu grafu. Weryfikacja wersji menedżera nie była zatem całkowicie bez zapisu do katalogu.

Deklaracja o zakończeniu karencji nie zgadzała się z czasem kontroli. Zegar hosta wskazał `2026-09-21T07:05:34+02:00` (Europe/Warsaw), narzędzie czasu `2026-09-21 05:05:10 UTC`, a nagłówek HTTP `Date` rejestru npm `Mon, 21 Sep 2026 05:05:33 GMT`. Odczyt [metadanych @turbo/darwin-64](https://registry.npmjs.org/@turbo%2Fdarwin-64) ponownie potwierdził publikację wersji `2.11.0` o `2026-09-18T16:31:48.531Z`; po 4320 minutach termin pozostaje **2026-09-21 18:31:49 Europe/Warsaw**. Nie zmieniła się data wskazana w inwentarzu; to około 11 godzin 26 minut po kontroli.

Zgodnie z poleceniem właściciela „zatrzymaj się i zapytaj, jeśli któraś wersja nie spełnia karencji” przerwano przed rozwiązywaniem grafu aplikacji. Nie wyłączano opcjonalnych pakietów platformowych, nie zmieniano zegara, ADR ani ustawień pnpm. Nie uruchomiono polecenia tworzenia lockfile aplikacji, instalacji frozen, lint/typecheck/build aplikacji, BL-002, spike BL-032 ani `docker compose up`. **Nie ma rozwiązanego grafu aplikacji do porównania** — nie należy interpretować tego jako braku różnic względem audytu. Dostępność PostgreSQL i Valkey z hosta przy `internal: true` pozostaje do sprawdzenia przy pierwszym uruchomieniu.

Następny krok po upływie terminu i potwierdzeniu wznowienia: ponownie sprawdzić czas, utworzyć lockfile przy niezmienionej polityce, wypisać wszystkie różnice względem inwentarza i dopiero wtedy instalować frozen. Estymacje pozostają bez zmian; oczekiwanie jest opóźnieniem kalendarzowym. Brak nowej decyzji ADR lub nowego ryzyka — nadal działa ograniczenie R-22. Nie przywrócono automatyzacji.

## 7. ADR-015 i ponowna kontrola całego inwentarza

**Aktualna decyzja właściciela z 2026-09-21:** [ADR-015](../09-decyzje/ADR-015-linia-turborepo-na-starcie-m0.md) akceptuje start na Turborepo 2.10.13 i późniejszą aktualizację do 2.11 osobnym PR Renovate. Zaktualizowano odwołanie w ADR-002, STACK, AGENTS, backlog, root `package.json`, inwentarz i R-22. Dedykowana reguła Renovate wyłącza grupowanie tej aktualizacji, zachowuje 3 dni karencji i brak automerge; działanie aplikacji Renovate nadal wymaga aktywacji przez właściciela. Pozostałe manifesty i polityka pnpm są niezmienione.

Kontrola w **2026-09-21 05:24:55.405 UTC (07:24:55 Europe/Warsaw)** objęła ponowne obliczenie wieku **559 wersji npm i wszystkich 2308 plików 97 wersji PyPI**, także binariów. Świeżo odczytano npm dla Turbo i wszystkich jego platform oraz wszystkich nadal blokowanych wersji npm, a PyPI dla wszystkich nadal blokowanych plików. Daty i sumy pozostałych wersji pochodzą z zapisanego audytu 2026-09-20; nie wykonano ponownego rozwiązywania grafu ani skanowania podatności.

### Turborepo 2.10.13 — wszystkie pakiety spełniają karencję

| Pakiet (2.10.13) | Publikacja UTC 2026-09-14 | Koniec 4320 minut UTC 2026-09-17 |
|---|---|---|
| `turbo` | 16:36:00.550 | 16:36:00.550 |
| `@turbo/linux-64` | 16:43:06.852 | 16:43:06.852 |
| `@turbo/darwin-64` | 16:33:38.588 | 16:33:38.588 |
| `@turbo/windows-64` | 16:34:09.008 | 16:34:09.008 |
| `@turbo/linux-arm64` | 16:39:11.511 | 16:39:11.511 |
| `@turbo/darwin-arm64` | 16:43:58.850 | 16:43:58.850 |
| `@turbo/windows-arm64` | 16:53:35.063 | 16:53:35.063 |

Zmiana inwentarza: dokładnie te **7 par nazwa–wersja** zastąpiono z 2.11.0 na 2.10.13, wraz z datami i SHA-512; root audytu `turbo` wskazuje 2.10.13. Pozostałe 552 wpisy npm, wszystkie pliki PyPI i liczby pakietów (w tym 211 platformowych) pozostają bez zmian. Zachowano pierwotny `resolutionCutoffUtc` jako parametr audytu metadanych, a nowe `ageRecheck` dokumentuje kontrolę wieku i blokady.

### Pozostałe blokady — pełna lista na czas kontroli

| Rejestr / pakiet | Wersja | Ostatnia publikacja UTC 2026-09-18 | Bezpieczny termin Europe/Warsaw 2026-09-21 (w górę do sekundy) |
|---|---|---|---|
| [npm bullmq](https://registry.npmjs.org/bullmq) | 6.3.7 | 07:00:33.237 | **09:00:34** |
| [PyPI bullmq](https://pypi.org/pypi/bullmq/3.2.3/json) | 3.2.3 | 07:00:35.997068 | **09:00:36** |
| [PyPI psycopg-binary](https://pypi.org/pypi/psycopg-binary/3.3.6/json) | 3.3.6 | 13:22:51.283084 | **15:22:52** |
| [PyPI psycopg](https://pypi.org/pypi/psycopg/3.3.6/json) | 3.3.6 | 13:22:55.152101 | **15:22:56** |
| [npm @babel/parser](https://registry.npmjs.org/@babel%2Fparser) | 7.29.9 | 13:50:33.592 | **15:50:34** |
| [npm lighthouse](https://registry.npmjs.org/lighthouse) | 13.5.0 | 14:13:55.261 | **16:13:56** |

Pozostałe **556 wersji npm i 94 wersje PyPI** spełniają karencję według zapisanych dat. Blokowanych jest 70 plików PyPI (2 bullmq, 2 psycopg, 66 psycopg-binary); pozostałe 2238 spełniają limit. Dla psycopg-binary tabela zachowuje przyjętą metodę maksimum dla wszystkich dystrybucji, nie tylko wybranego wheel CPython 3.13. Nie zawężano audytu do Windows, wybranej architektury ani aktualnie zadeklarowanych manifestów. Już sam przypięty `bullmq@6.3.7` w `apps/jobs` blokuje obecną instalację.

**Wniosek:** ADR-015 usuwa blokadę Turborepo, ale cały niezmieniony poza nim inwentarz spełni karencję dopiero **2026-09-21 16:13:56 Europe/Warsaw**. Nie ma wersji wymuszającej oczekiwanie po 2026-09-24. Zgodnie z warunkiem właściciela zatrzymano dalszą część 3: brak lockfile aplikacji, porównania rozwiązanego grafu, instalacji frozen, weryfikacji lint/typecheck/build pakietów, BL-002, spike BL-032 i pierwszego uruchomienia Compose. Lista powyżej nie jest wynikiem resolvera ani dowodem działania `trustPolicy`.

Do decyzji właściciela: audyt i dobór wcześniejszych zgodnych patchy także dla tych pozycji, jeśli rozpoczęcie przed wspólnym terminem nadal jest wymagane. Nie wybrano ich samodzielnie i nie dodano wyjątków karencji. Nie ma nowych ryzyk poza uaktualnionym R-22; estymacje bez zmian, odchylenie nakładu nadal do ustalenia po implementacji. R-24 (wycofane zależności Drizzle Kit) i pełne kryteria M0 pozostają otwarte.

Walidacja tej aktualizacji: **20/20 testów skryptów PASS na Node 24.21.0**, kontrola **74 dokumentów PASS**, JSON manifestu/Renovate/inwentarza i porównanie zmienionych wpisów audytu PASS. Kontrola ustawień reguły Renovate jest statyczna według [dokumentacji](https://docs.renovatebot.com/configuration-options/), bez uruchomienia Renovate/CI. Nie są to testy dymne pakietów ani zamknięcie BL-001/002/032.

## 8. Lockfile i instalacja po zatwierdzeniu patchy — 2026-09-21

Ta sekcja aktualizuje historyczne blokady z § 6–7. Potwierdzono Node 24.21.0 i pnpm 12.4.2. Zastosowano zatwierdzone bullmq npm 6.3.6, bullmq PyPI 3.2.2 (najnowsze dojrzałe 3.2.x), psycopg i psycopg-binary 3.3.5. Lighthouse 13.5.0 nie było w manifestach i pozostaje odroczone do BL-016, bez zmiany linii.

`pnpm install --lockfile-only` utworzyło pełny lockfile 23 projektów. [Każda różnica z audytem](audits/m0-1-lockfile-comparison.json): 377 wersji, 376 zgodnych, jedna zmieniona (`@babel/parser` 7.29.9 → 7.29.8), zero nowych nazw, 183 pominięte wersje szerszego inwentarza kandydatów. Każda pominięta pozycja jest wymieniona osobno w JSON. `magicast@0.5.5` wymaga parsera `^7.29.7`; ani inwentarz, ani rozwiązany graf nie zawiera rodzica przypinającego dokładnie 7.29.9. Brak overrides. Kontrola publikacji i SHA-512 wszystkich 377 wersji PASS, zero blokerów karencji.

`pnpm install --frozen-lockfile` PASS, bez ponownego rozwiązywania. Przejrzano skrypty i dodano zgody/odmowy dla dokładnych wersji ([uzasadnienie](m0-1-install-scripts.md)); skrypty esbuild zakończyły się bez zapasowego pobierania. Polityka karencji i ADR pozostają bez zmian.

`pnpm audit --json`: 1 podatność moderate, 0 high/critical — [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99), esbuild 0.18.20 przez Drizzle Kit i wycofane `@esbuild-kit/*`. Nie uruchamiamy serwera developerskiego esbuild; nie zastosowano automatycznych overrides ani `audit fix`. R-24 pozostaje otwarte.

Dalsze kroki tej sesji: ukończenie walidacji grafu Pythona, test Compose, szkielety BL-002 i porównanie TypeScript 7/6 w BL-032. Weryfikacja konfiguracji przygotowanej wcześniej wykryła błędy deklaracji bibliotek; właściciel zatwierdził `skipLibCheck: true` przy niezmienionym `strict: true`. Wyniki końcowe zostaną dopisane poniżej. **Własne CI nadal nieuruchomione; żadna z tych kontroli nie zamyka całego M0.**

### 8.1 Graf i szkielet Pythona

Python 3.13.13 i lokalny uv 0.12.16 (bez zmiany instalacji globalnych). Wheel uv pobrano z PyPI i porównano SHA-256 z wcześniejszym audytem. `uv lock` z `exclude-newer = "3 days"` utworzyło lockfile od zera; [pełne porównanie](audits/m0-1-python-lockfile-comparison.json): 27 zewnętrznych wersji, 183 pliki w lockfile, wszystkie zgodne z inwentarzem po zatwierdzonych patchach, zero nowych/zmienionych wersji i błędów sum/karencji. 70 pozostałych wersji szerokiego audytu nie jest potrzebne do tego szkieletu; każda wymieniona w JSON.

Instalacja frozen: najpierw przypięte wheels bez budowania, następnie lokalny pakiet bez izolacji z przypiętym setuptools 84.0.0. Ruff, mypy strict, pytest (1 test) oraz offline build sdist/wheel PASS. Minimalny pakiet nie uruchamia workera; BL-014 pozostaje todo. Backend setuptools był już audytowany; jego bezpośrednie użycie uzasadniono w STACK § 3.1.

### 8.2 Szkielet i spike TypeScript

BL-002: źródła i testy dymne 22 pakietów (4 aplikacje, 9 modułów, 9 pakietów wspólnych), cztery publiczne wejścia każdego modułu oraz negatywne próby importu prywatnej definicji. Bez domeny; web zawiera wyłącznie stronę testową z tekstami ze słownika i18n. Python jest pustym pakietem, a api/jobs nie uruchamiają jeszcze serwerów ani kolejek.

`pnpm turbo run lint typecheck test build`: **88/88 PASS**, 59 testów Vitest i 1 pytest. Poprawiono format konfiguracji zgodnie z Biome; `biome migrate` zastąpiło przestarzałe `recommended` przez równoważne `preset`. Testy importują zbudowane eksporty pakietów; typecheck web czeka na generowanie deklaracji Next podczas buildu. Build/test po fizycznym przeniesieniu modułu `education` poza workspace: **42/42 PASS bez cache**; moduł przywrócono. Nie zastępuje to pełnego skryptu granic BL-003.

BL-032: [notatka z decyzją](bl-032-typescript-7-spike.md) i [pełna lista diagnostyk](audits/bl-032-library-diagnostics.json). TypeScript 7.0.2 pozostaje; 6.0.3 wykazuje identyczne 72 błędy deklaracji Drizzle i 1 Better Auth. Właściciel zatwierdził `skipLibCheck: true`; `strict: true` i pozostałe opcje kontroli własnego kodu bez zmian. Fixture’y negatywne potwierdzają odrzucanie błędnego typu opcji auth, null i liczbowego UUID w naszym kodzie. Brak shimów/łatek deklaracji; bez nowego ADR.

**Status:** BL-002 i decyzja techniczna BL-032 wykonane lokalnie; zadania pozostają `w toku`, bo wspólne Definition of Done wymaga brakujących dowodów CI. BL-001 również nadal wymaga aktywnego CI. Własnych workflow nie uruchomiono. Estymacji nie zmieniono; nie prowadzono wiarygodnej ewidencji dni idealnych, więc nie podano fikcyjnego odchylenia. Oczekiwanie kalendarzowe i dodatkowa diagnoza typów/hosta są odrębne od wykonania.
