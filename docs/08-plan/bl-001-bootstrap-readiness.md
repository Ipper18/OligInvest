# BL-001 — warunki rozpoczęcia implementacji M0

**Cel:** zapisać wynik weryfikacji startowej BL-001, blokadę polityki zależności i propozycję dalszej kolejności prac do przeglądu właściciela.

Stan: **2026-09-20**. Raport dotyczy przygotowania BL-001; nie potwierdza wykonania bootstrapu ani zamknięcia M0. Podstawa: [`backlog.md`](backlog.md) § 1, [`roadmapa.md`](roadmapa.md) § 3, [`AGENTS.md`](../../AGENTS.md) § 2.5 i [`CONTRIBUTING.md`](../../CONTRIBUTING.md) § 3.

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

1. Zachować ADR-002 i pełną politykę zależności. Rozpocząć instalację po upływie karencji wybranej wersji 2.11; najwcześniejszy termin dla samego pakietu `turbo` to 2026-09-21 18:31:36.614 Europe/Warsaw. Przed instalacją ponownie sprawdzić cały rozwiązywany graf, w tym pakiety binarne dla poszczególnych platform. Termin w tabeli nie gwarantuje przejścia pozostałych kontroli.
2. Uruchomić narzędzia projektu na Node.js 24 LTS i przypiąć konkretne wersje zgodne ze stosem. Utworzyć lockfile przy niezmienionej polityce, a instalację i późniejsze odtworzenie środowiska przeprowadzić z `--frozen-lockfile`.
3. Wykonać BL-001, następnie zadania z gotowymi zależnościami; każda mała paczka ma osobną gałąź i PR. Scalenie pozostaje po przeglądzie właściciela. Nie oznaczać zadań `gotowe` przed spełnieniem ich kryteriów.
4. Poprawić podział paczek w [`prompty-codex.md`](prompty-codex.md): BL-034 znajduje się w M0-1, lecz zależy od BL-022 z M0-2. Proponowane przeniesienie BL-034 do M0-2, po BL-022, zachowuje zakres i zależności backlogu. W tym raporcie jest to propozycja; tabeli paczek i zależności nie zmieniono.

Proponowane odczekanie karencji nie wymaga nowego ADR. Gdyby właściciel wybrał inną linię Turborepo, potrzebny jest nowy ADR zastępujący odpowiednią część ADR-002 przed implementacją. Nie zaproponowano wyłączenia karencji ani dodania wyjątków od niej.

## 4. Raport sesji i weryfikacja

- **Zrobione:** odczyt backlogu, roadmapy, wymagań, Definition of Done i ADR-001–014; kontrola stanu Git i narzędzi; sprawdzenie wersji i dat publikacji w publicznym rejestrze npm; raport blokady i propozycja kolejności prac.
- **Pominięte:** implementacja BL-001 oraz zadania od niej zależne — wstrzymane zgodnie z `AGENTS.md` § 2.5. Nie wykonano prac na serwerach ani operacji na sekretach.
- **Odchylenia:** BL-001 pozostaje `w toku`, wyłącznie analiza startowa. Estymacja implementacji 1 d bez zmian; czas oczekiwania na karencję jest opóźnieniem kalendarzowym, nie wykonaną pracą programistyczną. Końcowe odchylenie nakładu pracy zostanie ustalone po implementacji.
- **Decyzje:** do przeglądu właściciela — termin rozpoczęcia bez zmiany stosu oraz korekta przypisania BL-034 do paczki. Brak przyjętego nowego ADR.
- **Ryzyka:** R-22 — wymagane świeże wydania mogą czasowo blokować instalację przy obowiązującej polityce.
- **Testy:** brak uruchomienia aplikacji, testów jednostkowych i CI — nie istnieje jeszcze kod ani konfiguracja tych zadań. Walidacja tego PR obejmuje `git diff --check`, lokalne linki w dodanym raporcie i ponowne wyliczenie terminów z metadanych npm.
- **Kryteria wyjścia M0:** etap pozostaje otwarty; ten raport nie dostarcza dowodu spełnienia żadnego z ośmiu kryteriów wyjścia.
