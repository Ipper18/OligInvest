# BL-001 — warunki rozpoczęcia implementacji M0

**Cel:** zapisać wynik weryfikacji startowej BL-001, blokadę polityki zależności i propozycję dalszej kolejności prac do przeglądu właściciela.

Stan: **2026-09-20**. Raport dotyczy przygotowania BL-001; nie potwierdza wykonania bootstrapu ani zamknięcia M0. Podstawa: [`backlog.md`](backlog.md) § 1, [`roadmapa.md`](roadmapa.md) § 3, [`AGENTS.md`](../../AGENTS.md) § 2.5 i [`CONTRIBUTING.md`](../../CONTRIBUTING.md) § 3.

**Aktualizacja 2026-09-21:** § 1–5 zachowują historyczny audyt Turbo 2.11.0. Przyjęto [ADR-015](../09-decyzje/ADR-015-linia-turborepo-na-starcie-m0.md), dojrzałe patche bullmq/psycopg i odroczenie Lighthouse do BL-016. Oba lockfile i instalacje frozen są już zweryfikowane bez wyjątków karencji; wyniki i każda różnica względem audytu: [raport sesji § 8](m0-1-session-report.md#8-lockfile-i-instalacja-po-zatwierdzeniu-patchy--2026-09-21). Historyczne terminy oczekiwania nie blokują obecnego wybranego grafu.

## 1. Wynik weryfikacji

- Repozytorium zawiera dokumentację, bez aplikacji, manifestów pakietów i lockfile. BL-001 nie ma zależności; pozostałe zadania paczki M0-1 mają niespełnione zależności i nie zostały rozpoczęte.
- Linie pnpm 12.4, Turborepo 2.11, Biome 2.5 i TypeScript 7.0 są opublikowane w npm. Samo istnienie wersji nie potwierdza zgodności bibliotek — to zakres późniejszego BL-032.
- Lokalnie wykryto Node.js 25.1.0 i pnpm 12.5.1. Implementację trzeba weryfikować na Node.js 24 LTS wskazanym w [`stack-technologiczny.md`](../01-architektura/stack-technologiczny.md) § 2; nie zmieniono globalnej instalacji narzędzi.
- Dostęp do repozytorium przez GitHub CLI działa; podczas sprawdzenia nie było otwartych PR. Istniejące commity dokumentacji pozostają zachowane.

## 2. Blokada: Turborepo 2.11 a karencja 72 godzin

[`ADR-002`](../09-decyzje/ADR-002-monorepo.md) wymaga Turborepo 2.11. Jednocześnie [`kontrole-bezpieczenstwa.md`](../06-bezpieczenstwo/kontrole-bezpieczenstwa.md) § 4.3 i `AGENTS.md` § 5.8 wymagają `minimumReleaseAge: 4320` (minuty, czyli 72 godziny).

Poniższe daty publikacji pochodzą z pola `time` [publicznego rejestru npm dla turbo](https://registry.npmjs.org/turbo), odczytanego 2026-09-20. Termin to data publikacji + 4320 minut, przeliczona na Europe/Warsaw (UTC+02:00 w podanych dniach).

| Wersja | Publikacja UTC | Upływ karencji w Europe/Warsaw |
|---|---|---|
| 2.11.0 | 2026-09-18 16:31:36.614Z | 2026-09-21 18:31:36.614 |
| 2.11.1 | 2026-09-18 17:30:22.727Z | 2026-09-21 19:30:22.727 |
| 2.11.2 | 2026-09-18 21:07:36.588Z | 2026-09-21 23:07:36.588 |

Żadna stabilna wersja 2.11 dostępna podczas sprawdzenia nie spełniała tego warunku. [Dokumentacja pnpm 12](https://pnpm.io/settings/dependency-resolution#minimumreleaseage) potwierdza, że karencja obejmuje także zależności pośrednie, a jawna konfiguracja włącza domyślnie ścisłe egzekwowanie. [Ogłoszenie Turborepo 2.11](https://turborepo.dev/blog/2-11) potwierdza datę wydania 2026-09-18.

To blokada czasowa instalacji, nie stwierdzenie podatności pakietu. Nie uruchamiano instalacji ani nie przygotowano lockfile z pominięciem polityki; wniosek wynika z metadanych i dokumentacji pnpm.

## 3. Propozycja dalszej pracy

1. Zachować ADR-002 i pełną politykę zależności. Właściciel zatwierdził oczekiwanie. Audyt rozszerzonego grafu npm/PyPI, w tym binariów platformowych, wyznacza wspólny termin **2026-09-21 18:31:49 Europe/Warsaw** — szczegóły w § 5. Nie przesuwać oczekiwania poza 2026-09-24: wymagana linia z późniejszym terminem oznacza zatrzymanie i propozycję ADR. Przed instalacją porównać rozwiązywany graf z inwentarzem; metadane nie gwarantują przejścia pozostałych kontroli.
2. Uruchomić narzędzia projektu na Node.js 24 LTS i przypiąć konkretne wersje zgodne ze stosem. Utworzyć lockfile przy niezmienionej polityce, a instalację i późniejsze odtworzenie środowiska przeprowadzić z `--frozen-lockfile`.
3. Wykonać BL-001, następnie zadania z gotowymi zależnościami; każda mała paczka ma osobną gałąź i PR. Scalenie pozostaje po przeglądzie właściciela. Nie oznaczać zadań `gotowe` przed spełnieniem ich kryteriów.
4. **BL-034 pozostaje w M0-1, z zależnościami BL-013 i BL-014**, zgodnie z decyzją właściciela z 2026-09-20. `compose.dev.yaml` jest samodzielnym środowiskiem lokalnym i nie wymaga BL-022. Backlog i tabela paczek są poprawione. BL-018 dzieli się na testy lokalnego buildu produkcyjnego w M0-1 oraz testy obrazów produkcyjnych po BL-020–BL-023 w M0-2. Ten punkt zastępuje nieaktualną propozycję przeniesienia BL-034; PR #1 jest już scalony, więc korekta trafia do PR M0-1.

Proponowane odczekanie karencji nie wymaga nowego ADR. Gdyby właściciel wybrał inną linię Turborepo, potrzebny jest nowy ADR zastępujący odpowiednią część ADR-002 przed implementacją. Nie zaproponowano wyłączenia karencji ani dodania wyjątków od niej.

## 4. Raport sesji i weryfikacja

- **Zrobione:** odczyt backlogu, roadmapy, wymagań, Definition of Done i ADR-001–014; kontrola stanu Git i narzędzi; sprawdzenie wersji i dat publikacji w publicznym rejestrze npm; raport blokady i propozycja kolejności prac.
- **Pominięte:** implementacja BL-001 oraz zadania od niej zależne — wstrzymane zgodnie z `AGENTS.md` § 2.5. Nie wykonano prac na serwerach ani operacji na sekretach.
- **Odchylenia:** BL-001 pozostaje `w toku`, wyłącznie analiza startowa. Estymacja implementacji 1 d bez zmian; czas oczekiwania na karencję jest opóźnieniem kalendarzowym, nie wykonaną pracą programistyczną. Końcowe odchylenie nakładu pracy zostanie ustalone po implementacji.
- **Decyzje:** właściciel zatwierdził oczekiwanie bez zmiany stosu, BL-034 w M0-1 z nowymi zależnościami i podział BL-018. Brak przyjętego nowego ADR. Raport aktualizuje stan po scaleniu PR #1; sama implementacja nadal wymaga upływu karencji i weryfikacji.
- **Ryzyka:** R-22 — wymagane świeże wydania mogą czasowo blokować instalację przy obowiązującej polityce.
- **Testy:** brak uruchomienia aplikacji, testów jednostkowych i CI — nie istnieje jeszcze kod ani konfiguracja tych zadań. Walidacja tego PR obejmuje `git diff --check`, lokalne linki w dodanym raporcie i ponowne wyliczenie terminów z metadanych npm.
- **Kryteria wyjścia M0:** etap pozostaje otwarty; ten raport nie dostarcza dowodu spełnienia żadnego z ośmiu kryteriów wyjścia.

## 5. Audyt całego wybranego grafu przed oczekiwaniem

**Wspólny termin: 2026-09-21 18:31:49 Europe/Warsaw (16:31:49 UTC).** Obliczenie: maksimum czasów publikacji wybranego grafu + 4320 minut, zaokrąglone w górę do pełnej sekundy. Ostatni pakiet to `@turbo/darwin-64@2.11.0`, opublikowany 2026-09-18T16:31:48.531Z. Pozostałe binaria Turborepo i Lighthouse 13.5.0 kończą karencję wcześniej. Żadna sprawdzona wymagana linia nie wymaga oczekiwania po 2026-09-24.

Źródło danych z 2026-09-20: pola `time` i `dist.integrity` [npm](https://registry.npmjs.org/turbo), a dla [PyPI](https://pypi.org/pypi/uv/0.12.16/json) czasy `upload_time_iso_8601`, sumy SHA-256, `Requires-Python`, markery zależności i tagi wheels. Pełny [inwentarz JSON](audits/m0-1-release-age.json) zawiera wersje, pochodzenie, czasy, terminy i sumy kontrolne; nie jest lockfile.

| Zakres | Wynik |
|---|---|
| npm: STACK § 2–3 i kandydaci do M0-1/BL-032/BL-033 | 559 par nazwa–wersja, w tym 211 pakietów platformowych; sprawdzone zależności zwykłe, opcjonalne wszystkich platform i obowiązkowe peers |
| PyPI: STACK § 2–3, biblioteki wymienione przy Pythonie i worker | po 95 dystrybucji dla CPython 3.13.13 na Windows x64 i Linux x64; 97 unikalnych par nazwa–wersja w obu rozwiązaniach, 2308 opublikowanych plików z czasami i SHA-256 |
| Platforma poza npm/PyPI | Node 24.21.0, Python 3.13.13, PostgreSQL 18.6 i Valkey 9.1.2 są opublikowane; lokalne Node 25.1.0, pnpm 12.5.1 i Compose 5.1.3 nie są potwierdzeniem zgodności z wersjami stosu; przygotowanie lokalnych narzędzi zgodnych ze stosem przed testami, bez zmiany globalnych instalacji |

Wybrane przypięcia narzędzi (UTC; pełne czasy i terminy wszystkich pakietów w inwentarzu):

| Narzędzie | Wersja | Data publikacji / ostatniego pliku PyPI |
|---|---|---|
| pnpm | 12.4.2 | 2026-09-15 |
| Turborepo | 2.11.0 | 2026-09-18 |
| TypeScript | 7.0.2 | 2026-07-08 |
| Biome | 2.5.14 | 2026-09-16 |
| Vitest | 5.0.1 | 2026-09-15 |
| Playwright | 1.63.0 | 2026-09-04 |
| `@axe-core/playwright` | 4.13.0 | 2026-08-11 |
| Lighthouse | 13.5.0 | 2026-09-18 |
| size-limit | 14.0.0 | 2026-09-15 |
| uv | 0.12.16 | 2026-09-18 |
| Ruff | 0.16.8 | 2026-09-16 |
| mypy | 2.3.1 | 2026-08-15 |
| pytest | 9.1.1 | 2026-06-19 |
| hypothesis | 6.168.0 | 2026-09-08 |

Pozostałe wersje wymienione przy Pythonie: numpy 2.5.3, scipy 1.18.1, pandas 3.0.6, numba 0.67.0, cvxpy 1.9.2, TA-Lib 0.8.0, vectorbt 1.1.0. Audyt tych wersji nie dodaje bibliotek numerycznych do szkieletu workera. Wybór starszego patcha w tej samej linii (np. uv 0.12.16) zachowuje stos i nie przesuwa terminu na nowsze wydania.

**Ograniczenia:** npm rozwiązano na podstawie metadanych, nie resolverem pnpm; opcjonalne peers nie są automatycznie włączane. PyPI rozwiązano z uwzględnieniem zgodności wheels dla dwóch środowisk. Po utworzeniu lockfile należy porównać każdą wersję z audytem i sprawdzić dodatkowe węzły przed instalacją; nie wybierać ponownie wszystkich „latest”. Karencja nie dowodzi zgodności API/ABI, braku podatności, poprawnej licencji ani spełnienia `trustPolicy` i `strictDepBuilds`.

Wykryto dwa wycofane pakiety pośrednie `@esbuild-kit/esm-loader@2.6.5` i `@esbuild-kit/core-utils@3.3.2` w Drizzle Kit 0.31.10. Nie zastępowano ich przez overrides; ocena podatności pozostaje do wykonania. Opcjonalne binarium `@img/sharp-win32-ia32` nie obsługuje Node 24; nie dotyczy Windows x64 ani Linux x64. Inwentaryzacja wszystkich platform nie oznacza deklaracji wsparcia wszystkich architektur.

Nie uruchomiono instalacji, aplikacji, testów M0 ani CI. Przygotowanie podczas karencji opisuje [raport sesji M0-1](m0-1-session-report.md).
