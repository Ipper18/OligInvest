# Prompty dla Codex — jak uruchomić i prowadzić budowę

**Cel:** dać gotowe do wklejenia prompty, którymi właściciel uruchamia i prowadzi budowę OligInvest w Codex (GPT-6) etap po etapie — z jasnym zakresem, lekturą obowiązkową, zasadami bezpieczeństwa i raportem po każdej sesji.

Powiązane: [`../../AGENTS.md`](../../AGENTS.md) (instrukcje stałe — Codex czyta je automatycznie), [`roadmapa.md`](roadmapa.md), [`backlog.md`](backlog.md), [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md).

## 1. Jak pracować z Codex

1. **Jedna sesja = jedna paczka zadań** z tabel poniżej (zwykle 5–10 zadań, 5–15 dni estymacji). Mniejsze paczki łatwiej przejrzeć.
2. **Gałąź i PR na każde zadanie albo małą grupę** (`feat/bl-101-better-auth`), tytuł w formacie Conventional Commits, w opisie PR lista ID `BL-xxx` i wypełniona checklista z `CONTRIBUTING.md`.
3. **Przegląd właściciela przed scaleniem** — zawsze, także gdy CI jest zielone (R-11). Zwróć uwagę na nowe zależności, zmiany w `docs/`, testy usunięte lub osłabione.
4. **Codex nie ma dostępu do serwerów ani sekretów.** Zadania infrastrukturalne kończą się skryptem, konfiguracją i instrukcją; wykonuje je właściciel i wkleja wynik (bez sekretów i adresów) do kolejnej sesji.
5. **Konflikt dokumentacji z rzeczywistością** (np. inna wersja biblioteki, zachowanie niezgodne z opisem): Codex zatrzymuje się, opisuje rozbieżność i proponuje zmianę dokumentu lub ADR — nie „naprawia” dokumentacji po cichu.
6. Po każdej sesji: aktualizacja statusów w [`backlog.md`](backlog.md), nowe ryzyka w [`ryzyka.md`](ryzyka.md), decyzje wymagające ADR — w raporcie.

## 1.1 Zanim zaczniesz (jednorazowo)

| # | Czynność | Uwagi |
|---|---|---|
| 1 | **Repozytorium na GitHubie** — utwórz publiczne repo i wypchnij `main` | skan przed Krokiem 7 nie znalazł sekretów ani adresów; publiczne repozytorium to decyzja z [ADR-013](../09-decyzje/ADR-013-repozytorium-publiczne.md) |
| 2 | **Ustawienia repozytorium**: skanowanie sekretów z blokadą wypchnięcia, alerty Dependabot, prywatne zgłaszanie podatności; **CodeQL w konfiguracji domyślnej po scaleniu M0-1** | pliki tworzy BL-019, przełączniki ustawia właściciel według [instrukcji](../07-wdrozenie/ustawienia-repozytorium.md); po pojawieniu się kodu ponownie sprawdza języki `javascript-typescript`, `python` i dostępność `actions`, zapisując wynik |
| 3 | **Ochrona `main`** (ruleset: wymagany PR, wymagane zadania CI, historia liniowa) | wymagane zadania CI da się wskazać dopiero po pierwszym przebiegu — włącz po scaleniu sesji M0-1 |
| 4 | **Renovate** — zainstaluj aplikację GitHub dla tego repozytorium | konfiguracja `renovate.json` powstaje w BL-019 |
| 5 | **Codex** — podłącz repozytorium; w skrypcie startowym środowiska ustaw `npm i -g pnpm@12`, a po pierwszej sesji dopisz `pnpm install --frozen-lockfile` | Node 25 nie zawiera już corepacka, więc instalujemy pnpm przez npm. Codex czyta `AGENTS.md` sam — nie wklejaj reguł do czatu; lokalnie działa też Codex CLI uruchomiony w katalogu repozytorium |
| 6 | **Narzędzia lokalne** (do przeglądu i testów na Twoim komputerze): Node 24 LTS, pnpm ≥ 12.4 (`npm i -g pnpm@12`), Docker, Python 3.13 (instaluje `uv`) | wersje: [`../01-architektura/stack-technologiczny.md`](../01-architektura/stack-technologiczny.md) § 2–3 |
| 7 | **Pliki do weryfikacji parserów** — przygotuj lokalnie prawdziwy eksport z XTB (i mBank) | nie commituj ich; w repozytorium są tylko fikstury syntetyczne (G-05, G-16 w [`../00-przeglad/macierz-pokrycia.md`](../00-przeglad/macierz-pokrycia.md)) |

Opcjonalnie, jeśli Codex pozwala zapisać instrukcje niestandardowe dla projektu, wystarczy krótki tekst — reszta jest w `AGENTS.md`:

```text
Projekt OligInvest. Zasady stałe są w AGENTS.md w repozytorium — czytaj je przed każdą pracą.
Pracuj wyłącznie w zakresie zadań BL-xxx podanych w wiadomości; nie rozszerzaj zakresu.
Dokumentacja i raporty po polsku; kod, identyfikatory i commity po angielsku.
Zatrzymaj się i zapytaj, gdy trzeba zmienić decyzję z ADR, dodać zależność spoza stack-technologiczny.md,
użyć sekretu albo dostępu do serwera.
Każdą sesję kończ raportem: zrobione / pominięte / odchylenia estymacji / decyzje do ADR / nowe ryzyka.
```

## 2. Prompt 0 — pierwsza sesja (M0, repozytorium i CI)

```text
Jesteś głównym inżynierem projektu OligInvest. Repozytorium zawiera dziś wyłącznie dokumentację
(docs/), AGENTS.md, CLAUDE.md, CONTRIBUTING.md, SECURITY.md, .mcp.json, .env.example, redocly.yaml.
Zasady stałe są w AGENTS.md — przestrzegaj ich bezwzględnie.

Zadanie: zrealizuj z docs/08-plan/backlog.md zadania BL-001–BL-019 oraz BL-032–BL-035
(szkielet monorepo, pakiety wspólne, baza z RLS, CI, ustawienia repozytorium jako pliki).

Przeczytaj najpierw:
- AGENTS.md, CONTRIBUTING.md
- docs/08-plan/roadmapa.md (§ 1, § 3 „M0”), docs/08-plan/backlog.md (§ 0, § 1)
- docs/01-architektura/moduly.md, docs/01-architektura/stack-technologiczny.md
- docs/03-dane/schema.sql, docs/03-dane/testy-rls.sql, docs/03-dane/model-danych.md
- docs/02-api/konwencje-api.md, docs/02-api/openapi.yaml (tag health i platform)
- docs/06-bezpieczenstwo/kontrole-bezpieczenstwa.md § 2.3 (CSP), § 4 (łańcuch dostaw)
- docs/07-wdrozenie/ci-cd.md § 1–3, § 7; docs/04-frontend/wydajnosc.md § 6

Wymagania dodatkowe:
- Wersje jak w stack-technologiczny.md; każdą zależność przypinaj w lockfile; nowa biblioteka spoza
  dokumentu = uzasadnienie w PR (i propozycja wpisu do stack-technologiczny.md).
- Pliki `.github/workflows/*` z akcjami przypiętymi pełnym SHA i `permissions: contents: read`.
- Nie implementuj logiki domenowej ani ekranów poza stroną testową.
- Testy dymne w każdym pakiecie; `pnpm turbo run lint typecheck test build` ma przechodzić lokalnie.

Kryteria wyjścia tej sesji: kryteria 1–3 i 7 z roadmapy M0 oraz spike BL-032 zamknięty notatką.
Na koniec: raport (co zrobione, co pominięte i dlaczego, odchylenia estymacji), aktualizacja statusów
w backlog.md, lista decyzji do ADR i nowych ryzyk. Nie commituj sekretów ani adresów IP.
```

## 3. Prompty etapów

### 3.1 Szablon (każda kolejna sesja)

```text
Etap <Mx> z docs/08-plan/roadmapa.md. Zakres: zadania <BL-…> z docs/08-plan/backlog.md
(sprawdź, że ich zależności mają status „gotowe”; jeśli nie — zatrzymaj się i zgłoś).

Przeczytaj: AGENTS.md, CONTRIBUTING.md, sekcję etapu w roadmapa.md i backlog.md oraz dokumenty
z kolumny „Dokumenty” każdego zadania (legenda w backlog.md § 0.1).

Pracuj zadanie po zadaniu: najpierw dokumentacja (jeśli kontrakt się zmienia), potem testy, potem kod.
Każde zadanie = osobny commit (Conventional Commits) z ID w treści; PR może obejmować kilka zadań.
Kryteria akceptacji = Definition of Done z CONTRIBUTING.md + kryteria wymagań z kolumny „Wymagania”.

Na koniec sesji: raport (zrobione / pominięte / odchylenia estymacji / decyzje do ADR / nowe ryzyka),
aktualizacja statusów w backlog.md i — jeśli etap się kończy — lista kryteriów wyjścia z dowodami.
```

### 3.2 Paczki zadań

| Sesja | Zakres (`BL-…`) | Uwagi do promptu |
|---|---|---|
| M0-1 | 001–019, 032–035 | Prompt 0 (§ 2); pozostałe sesje z gotowymi promptami: § 3.3; BL-034 w całości (zależności BL-013 i BL-014); BL-018: lokalny build produkcyjny + Compose dev; BL-019: pliki i instrukcja, ustawienia potwierdza właściciel po scaleniu |
| M0-2 | 018 (dokończenie), 020–023, 030, 031 | obrazy, wydanie, skrypty; BL-018: testy na obrazach po BL-020–BL-023; spiki Better Auth w lokalnym Compose |
| M0-3 | 024–029 | Codex przygotowuje konfiguracje i instrukcje krok po kroku; wykonuje właściciel; wartości `<…>` tylko na serwerach |
| M1-1 | 101–103, 105–109, 111, 117 | uwierzytelnianie i autoryzacja; testy RLS i 403 dla każdej trasy |
| M1-2 | 131–139, 125 | dane rynkowe i SSE; testy kontraktowe na zapisanych próbkach, bez sieci w CI |
| M1-3 | 141–149 | `core` i portfel; wektory A, F, G; import XTB na syntetycznych fixtures. **BL-141–BL-143 zrealizowane w PR `feat/m1-core-engine` (Claude Code, [#3](https://github.com/Ipper18/OligInvest/pull/3); tam też rdzeń BL-301 i BL-305–BL-308 dla M3-1)** — sesja Codexa zaczyna od **BL-144**; API rdzenia: [`m1-core-session-report.md`](m1-core-session-report.md) § „Dla Codexa” |
| M1-4 | 113, 116, 121, 122, 147, 148, 152, 154, 155 | ekrany i budżety; brama A — raport z kryteriami |
| M1-5 | 104, 110, 112, 114, 115, 118, 123, 124, 151, 153, 156 | brama B; zadania 118, 151, 153, 156 wykonuje właściciel według instrukcji |
| M2-1 | 201–204, 209, 213, 216 | wskaźniki, wyjaśnienia, jakość danych |
| M2-2 | 205–208, 210–212, 214, 215 | watchlisty, indeksy, alokacja, mBank, preferencje |
| M3-1 | 301–310, 319 | wyniki historyczne; wektory B–D |
| M3-2 | 311–318 | worker Python i analizy; na końcu prompt przeglądu metodologicznego (§ 4) |
| M4-1 | 401–406 | PWA, push, powiadomienia, alerty |
| M4-2 | 407–412 | PAT, szybkie akcje, Skróty; testy na urządzeniach wykonuje właściciel |
| M5a-1 | 501–509 | panel administratora |
| M5a-2 | 511–516 | edukacja, heatmapa, screener, kalendarz, intraday |
| M5b-1 | 551–554, 562, 563 | ryzyko, atrybucja, decyzje, import CSV, alerty rozszerzone |
| M5b-2 | 555–561, 566 | analizy zaawansowane; przegląd metodologiczny (§ 4) obowiązkowy |
| M5b-3 | 564, 565 | OAuth (najpierw spike i ADR), migawka offline |
| M6-1 | 601–612 | przeglądy z dowodami; część zadań wykonuje właściciel |

### 3.3 M0-1 — pozostałe sesje (stan 2026-09-22)

Kolejność wynika z zależności w backlogu. Każdy prompt zakłada zasady z [`AGENTS.md`](../../AGENTS.md) § 6.1 (raport stanu na start, czytanie fragmentami, commit po zadaniu), więc ich nie powtarza. Model „Wysoki”; „Bardzo wysoki” tylko wtedy, gdy Codex zatrzyma się z pytaniem projektowym. Orientacyjnie: ok. 14 dni idealnych, przy dotychczasowym zużyciu mniej więcej tydzień limitu Codexa (**szacunek**, nie pomiar).

| Sesja | Zadania | Zależy od |
|---|---|---|
| R | poprawki z [przeglądu kodu](m0-1-przeglad-kodu.md): P-01, P-02, P-03, P-06 (+ P-04, P-05) | — |
| A | BL-010 | R |
| B | BL-013, BL-014, dokończenie BL-034 | R |
| C | BL-011 | R |
| D | BL-012 | C |
| E | BL-016, BL-033 | C |
| F | BL-017, BL-018 (część M0-1), BL-035 w CI, domknięcie BL-019 | A, B, D, E |

**R — poprawki z przeglądu**

```text
Etap M0, paczka M0-1, gałąź feat/m0-1-skeleton (PR #2). Poprawki z docs/08-plan/m0-1-przeglad-kodu.md:
P-01, P-02, P-03 i P-06, a jeśli wystarczy limitu także P-04 i P-05. Przeczytaj raport stanu i ten przegląd.
Kolejność: dokumentacja, testy, kod. Zmiana schema.sql i model-danych.md w zakresie P-03 (limity czasu ról)
jest zatwierdzona przez właściciela; porównanie schematu musi dalej dawać zero różnic. P-02 dopisz do
.env.example, P-04 do ci-cd.md i ustawienia-repozytorium.md. Jeśli nie zgadzasz się ze znaleziskiem albo
proponowaną wartością, napisz dlaczego i zatrzymaj się przy tej pozycji — nie pomijaj jej po cichu.
```

**A — BL-010, test zgodności OpenAPI (kryterium 3 M0)**

```text
Etap M0, paczka M0-1, gałąź feat/m0-1-skeleton (PR #2). Zadanie: BL-010.
Przeczytaj: raport stanu, docs/02-api/konwencje-api.md, docs/09-decyzje/ADR-012-api-jako-granica-domenowa.md,
docs/07-wdrozenie/ci-cd.md § 3 (wiersz contracts), redocly.yaml; z openapi.yaml nagłówek, tagi health
i platform oraz potrzebne schematy — grepem.
Cel: test porównuje dokument generowany z Zod z docs/02-api/openapi.yaml dla zaimplementowanych operacji
(ścieżka, metoda, operationId, parametry, kody i schematy odpowiedzi). apps/api/openapi-pending.json zawiera
wszystkie pozostałe operationId — wygeneruj ją skryptem z openapi.yaml, nie ręcznie — a test odrzuca jej
powiększenie względem gałęzi bazowej. Lint Redocly przechodzi. Testy negatywne: operacja spoza dokumentu,
zmieniony kształt odpowiedzi, dopisanie pozycji do pending. W raporcie wskaż dowód kryterium 3 M0.
```

**B — BL-013, BL-014, dokończenie BL-034**

```text
Etap M0, paczka M0-1, gałąź feat/m0-1-skeleton (PR #2). Zadania: BL-013, BL-014, dokończenie BL-034.
Przeczytaj: raport stanu, docs/01-architektura/moduly.md § 3.1 i § 5, docs/09-decyzje/ADR-003-hybryda-obliczen-i-kolejki.md,
docs/07-wdrozenie/srodowisko-deweloperskie.md.
Cel: apps/jobs łączy się z valkey-queue, rejestruje kolejki z katalogu moduly.md § 5.2 przez rejestry BL-006
(bez logiki zadań) i ma sondę zdrowia; apps/analytics konsumuje kolejkę testową i potwierdza odbiór, bez logiki
analitycznej i bez dostępu do sieci; seed tworzy wyłącznie dane syntetyczne; `pnpm dev` uruchamia api, web,
jobs i analytics na usługach z compose.dev.yaml. Testy połączeń na prawdziwym Valkey z compose.dev.yaml,
tak jak db:test. Ustalenia P-02 (NODE_ENV) stosuj także w jobs i analytics.
```

**C — BL-011, aplikacja web**

```text
Etap M0, paczka M0-1, gałąź feat/m0-1-skeleton (PR #2). Zadanie: BL-011.
Przeczytaj: raport stanu, docs/04-frontend/architektura-ui.md § 1–5 i § 12, docs/04-frontend/system-projektowy.md
§ 2–4 i § 7, docs/06-bezpieczenstwo/kontrole-bezpieczenstwa.md § 2.2–2.3, ADR-012.
Cel: strona testowa renderowana dynamicznie z nonce generowanym na każde żądanie w proxy.ts; CSP bez
'unsafe-inline' i bez zewnętrznych źródeł; klient API działa wyłącznie po stronie serwera i przekazuje
ciasteczko oraz X-Request-Id; tokeny kolorów, typografii i odstępów z system-projektowy.md w Tailwind 4,
motyw jasny i ciemny. Testy: unikalny nonce w CSP na każde żądanie, brak zasobów spoza origin, klient API
nieobecny w bundlu przeglądarki, check:deps odrzuca import db z web. Bez ekranów produktowych.
```

**D — BL-012, i18n, zgodność i komponenty wspólne**

```text
Etap M0, paczka M0-1, gałąź feat/m0-1-skeleton (PR #2). Zadanie: BL-012.
Przeczytaj: raport stanu, docs/11-zgodnosc-prawna.md § 4, docs/04-frontend/system-projektowy.md § 5–6,
docs/04-frontend/architektura-ui.md § 10, docs/04-frontend/dostepnosc.md § 2 i § 10.
Cel: packages/i18n/src/pl/disclaimers.json z 12 kluczami i wersjami z § 4 — treść dosłownie, bez parafrazy;
packages/i18n/src/compliance/forbidden-phrases.pl.json i test przeszukujący słowniki i komponenty; formatery
Intl pl-PL przyjmują kwoty jako ciąg albo Decimal, nigdy number; lint odrzuca literał tekstowy w JSX.
packages/ui: prymitywy oraz DataFreshness, AssumptionsBlock i Disclaimer — bez literałów, z testem axe.
```

**E — BL-016, BL-033, budżety wydajności**

```text
Etap M0, paczka M0-1, gałąź feat/m0-1-skeleton (PR #2). Zadania: BL-016 i BL-033.
Przeczytaj: raport stanu, docs/04-frontend/wydajnosc.md § 2, § 3 i § 6.
Cel: size-limit dla pakietów współdzielonych, route-budgets.mjs z budżetami z § 3, wykrywanie zakazanych
bibliotek w chunkach początkowych (§ 6.1) i skrypt Lighthouse 13.5 z asercjami — w M0 tylko raport.
Lighthouse 13.5.0 dodaj teraz do manifestu (karencja minęła 2026-09-21). BL-033: zmierz rozmiary bazowe
Next.js, Zod i Radix na obecnym buildzie i zaktualizuj wydajnosc.md § 2 z datą pomiaru.
```

**F — aktywne CI i zamknięcie paczki**

```text
Etap M0, paczka M0-1, gałąź feat/m0-1-skeleton (PR #2). Zadania: BL-017, BL-018 (część M0-1), BL-035 w CI,
domknięcie plików BL-019 (P-04 z przeglądu, jeśli jeszcze otwarte).
Przeczytaj: raport stanu, docs/07-wdrozenie/ci-cd.md § 1–3 i § 7, docs/07-wdrozenie/ustawienia-repozytorium.md,
.github/workflow-drafts/ci.yml, docs/04-frontend/dostepnosc.md § 10.
Cel: przenieś szkic do .github/workflows/ jako działające zadania lint, typecheck, unit, contracts, build
(macierz bez modułów funkcjonalnych), budgets, deps-audit (high i critical blokują, wyjątki tylko
w osv-scanner.toml), e2e (Playwright: Chromium, WebKit, Firefox z axe na lokalnym buildzie produkcyjnym
i compose.dev.yaml) oraz kontrolę dokumentacji. Wszystkie przebiegi w PR #2 zielone; nazwy kontroli
w rulesecie równe rzeczywistym, łącznie z db i modules.
Na koniec kontrola końca etapu według prompty-codex.md § 5 dla kryteriów 1–3 i 7 oraz opis PR z checklistą
DoD. Nie scalaj i nie zmieniaj statusu PR — to robi właściciel.
```

## 4. Prompt przeglądu metodologicznego (analizy i backtest)

Codex nie ma skilli Claude (`strategy-critique`, `backtest-review`) — ich checklisty są w `AGENTS.md`. Użyj po każdej funkcji z obszaru FR-04:

```text
Przeprowadź adwersarialny przegląd metodologiczny funkcji <nazwa, BL-…> według checklist
„Przegląd backtestu” i „Krytyka strategii/analizy” z AGENTS.md oraz reguł
z docs/03-dane/obliczenia-finansowe.md § 12–14 i docs/11-zgodnosc-prawna.md § 2–4.
Dla każdego punktu: PASS / FAIL / NIEJASNE, jedno zdanie uzasadnienia, a przy FAIL — konkretna
poprawka. Sprawdź w kodzie i testach (nie tylko w opisie): look-ahead, survivorship, przeuczenie
(liczba prób, DSR, OOS vs IS), koszty i podatki, reżimy rynku, wielkość pozycji, realizm wykonania,
język wyników i disclaimery. Zakończ werdyktem SHIP / FIX / SCRAP i listą zmian do wprowadzenia
w tym samym PR. Wynik wklej do opisu PR.
```

## 5. Prompt kontroli końca etapu

```text
Sprawdź, czy etap <Mx> spełnia kryteria wyjścia z docs/08-plan/roadmapa.md § 3 i kryteria wspólne
z § 4. Dla każdego kryterium podaj dowód: nazwę testu i wynik CI, plik protokołu, zrzut raportu
budżetów albo wskaż brak. Porównaj statusy w backlog.md z faktycznym stanem kodu. Sprawdź,
czy dokumentacja (OpenAPI, schema.sql, wzory, disclaimery, instrukcje użytkownika) zgadza się z kodem.
Wypisz: kryteria niespełnione, ryzyka do aktualizacji w ryzyka.md, decyzje wymagające ADR.
Niczego nie naprawiaj w tej sesji — tylko raport.
```

## 6. Prompt poprawki (błąd lub incydent)

```text
Błąd/incydent: <opis, request-id, kroki, oczekiwane vs faktyczne — bez danych osobowych i sekretów>.
Zlokalizuj przyczynę, napisz najpierw test odtwarzający błąd, potem poprawkę. Jeśli dotyczy
bezpieczeństwa lub izolacji danych (RLS, cache, SSE, eksport) — zastosuj playbook
z docs/06-bezpieczenstwo/plan-reagowania.md i dopisz test regresji (dla RLS w testy-rls.sql).
Commit „fix: …”, wpis w backlog.md (odchylenie) i — przy incydencie — szkic postmortem.
```
