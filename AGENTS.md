# OligInvest — instrukcje dla agenta (Codex)

**Cel:** dać agentowi budującemu OligInvest stały zestaw reguł — czym jest projekt, co czytać przed pracą, jakiego stosu używać, czego nie wolno, jak pracować i jak sprawdzać funkcje analityczne — tak, aby kod powstawał zgodnie z dokumentacją w `docs/` bez dopytywania o podstawy.

## 1. Projekt w skrócie

- Prywatna aplikacja webowa (PWA) do analizy inwestycji dla właściciela i kilku zaproszonych osób (≤ 10 kont, ≤ 5 jednocześnie): portfel w PLN (GPW, USA, ETF; waluty PLN/USD/EUR), import z XTB i mBank eMakler, wyniki (FIFO, TWR, XIRR), scenariusze i rozkłady (nigdy prognozy punktowe), alerty, edukacja.
- Budżet 0 zł: self-hosting w VM na Proxmoxie (Dell 7020, i5-4590, 16 GB) obok Immicha; VPS OVH jako przekaźnik TCP (routing po SNI, bez terminacji TLS) przez WireGuard; domena `invest.oligi.pl`.
- Dane rynkowe: EOD z archiwum GPW, notowania opóźnione ~15 min z Yahoo (best effort), kursy NBP; Stooq wyłącznie jako ręczny import pliku.
- Aplikacja **analizuje i uczy, nie doradza** (MiFID II, MAR — [`docs/11-zgodnosc-prawna.md`](docs/11-zgodnosc-prawna.md)).

## 2. Zanim cokolwiek zrobisz

1. Znajdź swoje zadania w [`docs/08-plan/backlog.md`](docs/08-plan/backlog.md) (`BL-xxx`) i sprawdź, że ich zależności mają status `gotowe`. Pracuj wyłącznie w zakresie tych zadań.
2. Przeczytaj sekcję etapu w [`docs/08-plan/roadmapa.md`](docs/08-plan/roadmapa.md) (kryteria wyjścia) i dokumenty z kolumny „Dokumenty” (legenda: backlog § 0.1).
3. Zawsze obowiązują: [`CONTRIBUTING.md`](CONTRIBUTING.md) (Definition of Done), [`docs/00-przeglad/wymagania.md`](docs/00-przeglad/wymagania.md) (FR/NFR i kryteria akceptacji), decyzje w [`docs/09-decyzje/`](docs/09-decyzje/ADR-000-szablon.md) (ADR-001…014).
4. Źródła kontraktów: API — [`docs/02-api/openapi.yaml`](docs/02-api/openapi.yaml) i [`konwencje-api.md`](docs/02-api/konwencje-api.md); SSE — [`realtime.md`](docs/02-api/realtime.md); baza — [`docs/03-dane/schema.sql`](docs/03-dane/schema.sql) i [`testy-rls.sql`](docs/03-dane/testy-rls.sql); wzory — [`docs/03-dane/obliczenia-finansowe.md`](docs/03-dane/obliczenia-finansowe.md) i [`wektory-testowe.json`](docs/03-dane/wektory-testowe.json); importy — [`formaty-importu.md`](docs/03-dane/formaty-importu.md); moduły — [`docs/01-architektura/moduly.md`](docs/01-architektura/moduly.md); UI — [`docs/04-frontend/`](docs/04-frontend/mapa-ekranow.md); bezpieczeństwo — [`docs/06-bezpieczenstwo/`](docs/06-bezpieczenstwo/kontrole-bezpieczenstwa.md); wdrożenie — [`docs/07-wdrozenie/`](docs/07-wdrozenie/infrastruktura.md).
5. Gdy dokumentacja jest sprzeczna, niepełna albo nie zgadza się z rzeczywistością (wersja biblioteki, zachowanie API) — **zatrzymaj się**, opisz rozbieżność i zaproponuj zmianę dokumentu lub nowy ADR. Nie zgaduj i nie zmieniaj decyzji po cichu.

## 3. Stos (zmiana tylko przez ADR)

Szczegóły, licencje i uzasadnienia: [`docs/01-architektura/stack-technologiczny.md`](docs/01-architektura/stack-technologiczny.md). Wersje przypina lockfile; poniżej linie startowe.

| Obszar | Wybór |
|---|---|
| Monorepo | pnpm 12.4 (workspace z polityką z § 5.8), Turborepo 2.11, TypeScript 7.0 `strict` (spike BL-032; zapas 6.x), Biome 2.5 |
| Runtime | Node.js 24 LTS; Python 3.13 (uv 0.12, Ruff 0.16, mypy 2.3) |
| `apps/web` | Next.js 16.3 (App Router, RSC, streaming, `proxy.ts` z CSP nonce), React 19.3, Tailwind CSS 4.3, natywny HTML + wybrane Radix Primitives, TanStack Query 5, TanStack Table 9 + Virtual 3, Lightweight Charts 5.2, uPlot 1.6, driver.js 1.8, własny service worker; **bez dostępu do bazy** |
| `apps/api` | Hono 4.13 + `@hono/node-server`, Zod 4.6 + `@hono/zod-openapi` 1.6, Better Auth 1.7.5 (`twoFactor`, `admin`, `haveIBeenPwned`, `@better-auth/api-key`), Argon2id przez `@node-rs/argon2`, SSE; jedyna granica domenowa (REST `/api/v1`) |
| `apps/jobs` | BullMQ 6.3, SheetJS CE 0.20.3 (tarball z cdn.sheetjs.com), `yahoo-finance2`, nodemailer (SMTP Brevo), `web-push` |
| `apps/analytics` | Python: vectorbt 1.1, PyPortfolioOpt 1.6 + cvxpy, quantstats, numpy/pandas/scipy, `bullmq` 3.2, psycopg 3.3 (rola tylko do odczytu), `jsonschema`; **bez internetu i bez danych użytkowników w bazie** |
| Dane | PostgreSQL 18 (RLS, `uuidv7()`, `NUMERIC`), Drizzle ORM 0.45 + drizzle-kit, `pg`; Valkey 9 ×2: `valkey-queue` (`noeviction`, AOF) i `valkey-cache` (`allkeys-lru`) |
| Testy | Vitest 5, pytest 9 + hypothesis, Playwright 1.63 + `@axe-core/playwright`, Lighthouse 13.5 ze skryptem asercji, size-limit; referencje tylko w testach: TA-Lib, empyrical-reloaded ≥ 0.5.12 |
| Infrastruktura | Docker Compose (Debian 13), Caddy 2.11 (TLS 1.3, ACME TLS-ALPN-01, `proxy_protocol`), nginx `stream` na VPS, WireGuard, CrowdSec, pgBackRest + restic/rest-server, Uptime Kuma |
| CI/CD | GitHub Actions (akcje przypięte SHA), Renovate, osv-scanner, syft (SBOM), cosign keyless, CodeQL, GHCR; wdrożenie „pull” skryptem na serwerze |

**Struktura:** `apps/{web,api,jobs,analytics}`, `modules/{identity,notifications,market,portfolio}` (fundamentowe) i `modules/{analytics,alerts,education,admin,quick-actions}` (funkcjonalne, wyłączalne flagą), `packages/{platform,core,contracts,db,data-providers,ui,i18n,config,test-vectors}`.

## 4. Granice modułów

- Moduł ma strukturę z [`moduly.md`](docs/01-architektura/moduly.md) § 1; publiczne są tylko eksporty `./contracts`, `./server`, `./jobs`, `./ui`.
- Warstwy: `packages` ← moduły fundamentowe (`identity` → `notifications` → `market` → `portfolio`) ← moduły funkcjonalne. **Moduł funkcjonalny nie zależy od innego funkcjonalnego** — współpraca wyłącznie przez zdarzenia. `pnpm check:deps` pilnuje tego w CI.
- `packages/core` nie ma I/O ani zależności poza `decimal.js`; to **jedyna** implementacja obliczeń finansowych dla web, api i jobs. Python liczy tylko Monte Carlo, optymalizację, backtest, testy skrajne i „co jeśli” — i jest weryfikowany tymi samymi wektorami.
- `apps/web` nie importuje `modules/*/server` ani `packages/db`; komponenty serwerowe pobierają dane z `api` przez sieć wewnętrzną.
- Zdarzenia publikowane po zatwierdzeniu transakcji; handlery idempotentne; nocne `recompute-all` jako siatka bezpieczeństwa.
- Wyłączona flaga modułu: brak nawigacji, `404` dla tras, zadania pomijane.

## 5. Twarde reguły

### 5.1 Kontrakty i dokumentacja
- Dokumentacja przed kodem: zmiana OpenAPI, schematu, wzorów, disclaimerów lub instrukcji — w tym samym PR co kod. CI porównuje OpenAPI generowane z Zod z `docs/02-api/openapi.yaml` (operacje niezaimplementowane: `apps/api/openapi-pending.json` — lista może tylko maleć) i migracje z `schema.sql`.
- Błędy `application/problem+json` (RFC 9457) z polem `code` z listy w OpenAPI; paginacja kursorowa; `Idempotency-Key` dla operacji tworzących; kwoty w JSON jako ciągi z polem waluty.

### 5.2 Pieniądze, waluty, czas
- Nigdy `float` dla pieniędzy: `decimal.js` (precyzja 34, `ROUND_HALF_EVEN` w obliczeniach, `ROUND_HALF_UP` przy prezentacji), `Decimal` w Pythonie na granicach, `NUMERIC` w SQL; waluta zawsze jawna ([ADR-014](docs/09-decyzje/ADR-014-pieniadze-waluty-czas.md)).
- Koszt nabycia: FIFO per rachunek (średnia ważona tylko jako widok). Widok podatkowy: dzień przychodu i kosztu = **dzień rozliczenia** (`settle_date`; USA T+1, UE T+2, od 11.10.2027 T+1), kurs NBP z dnia roboczego poprzedzającego; widok informacyjny z disclaimerem `tax_view`.
- Każdy wzór ma test na wektorach referencyjnych z tolerancjami z `obliczenia-finansowe.md` § 0.5; pokrycie `packages/core` ≥ 90 % linii i 100 % wzorów.
- Czas: `timestamptz` w UTC, daty sesji w kalendarzu giełdy, prezentacja w strefie użytkownika (domyślnie Europe/Warsaw).

### 5.3 Bezpieczeństwo
- Zod `.strict()` na każdej granicy (HTTP, zadania, pliki, odpowiedzi dostawców); zapytania wyłącznie parametryzowane (bez `sql.raw` z danymi); brak `eval` i `dangerouslySetInnerHTML`.
- RLS na każdej tabeli z `user_id` (`FORCE ROW LEVEL SECURITY`, rola `oliginvest_app` bez `BYPASSRLS`, `SET LOCAL app.user_id` w każdej transakcji); nowa tabela = polityka + test w `testy-rls.sql` w tym samym PR. Admin nie ma polityk na tabelach portfela; impersonacja wyłączona.
- Uwierzytelnianie według [`uwierzytelnianie-autoryzacja.md`](docs/06-bezpieczenstwo/uwierzytelnianie-autoryzacja.md): Argon2id (m = 19 MiB, t = 2, p = 1 lub mocniej), obowiązkowy TOTP (bramka MFA), bramka regulaminu, step-up 15 min z rotacją tokenu sesji, PAT tylko dla `/api/v1/quick/*`, sekrety (tokeny zaproszeń i resetu) nigdy w URL — tylko we fragmencie `#`.
- CSP z nonce bez `unsafe-inline` i `unsafe-eval` (poza trybem deweloperskim); nagłówki z [`kontrole-bezpieczenstwa.md`](docs/06-bezpieczenstwo/kontrole-bezpieczenstwa.md) § 2; żadnych skryptów, czcionek ani analityki stron trzecich.
- Izolacja poza bazą: klucze cache i kanały SSE zawierają `user_id`; logi bez danych finansowych, haseł, tokenów i treści plików (redakcja w pino).
- Połączenia wychodzące tylko do allowlisty dostawców (brak pobierania URL-i od użytkownika — SSRF); `web` i `analytics` w sieciach bez wyjścia do internetu.
- Pliki: import ≤ 10 MB, parsowanie tylko w `jobs`, limity XLSX (≤ 50 MB po rozpakowaniu, ≤ 100 wpisów, współczynnik kompresji ≤ 100, ≤ 50 000 wierszy), brak wykonywania formuł; eksport CSV z neutralizacją formuł.

### 5.4 Wydajność
- Budżety JS per trasa z [`wydajnosc.md`](docs/04-frontend/wydajnosc.md) § 3 (initial JS < 200 KB gzip; powłoka ≤ 30 KB ponad framework). Biblioteki wykresów, driver.js, panel admina, analizy i Zod w przeglądarce — **tylko** przez dynamiczny import na trasach, które ich używają.
- Wykresy na canvas; serwer decymuje serie do ≤ 3 000 punktów; listy > 100 wierszy wirtualizowane. Ścieżka żądania użytkownika nie woła zewnętrznych API (cache/baza; p95 < 300 ms).

### 5.5 Zgodność (MiFID II, MAR) — obowiązuje w kodzie, tekstach i testach
- Zakazane: prognozy punktowe („cena za 30 dni = X”), tryb rozkazujący i sugestie działań wobec instrumentów („kup”, „sprzedaj”, „trzymaj”, „warto”, „rekomendujemy”), „sygnały”, cele cenowe, rankingi „najlepszych”, obietnice zysku. Pełna lista i test CI: [`docs/11-zgodnosc-prawna.md`](docs/11-zgodnosc-prawna.md) § 4.1.
- Każdy ekran analiz, screenera, alertów i eksportów: `<AssumptionsBlock/>`, `<DataFreshness/>`, `<Disclaimer/>` z kluczem i wersją z § 4.3 tamtego dokumentu, wynik jako przedział lub rozkład (lewy ogon pierwszy).
- Treść powiadomień push i e-maili: fakty (wartość, próg, czas, źródło, link), **bez kwot portfela** ([ADR-010](docs/09-decyzje/ADR-010-kanaly-powiadomien.md)).
- Nowa funkcja przewidująca albo backtestowa = przegląd według § 7 zapisany w PR.

### 5.6 Dane rynkowe
- Każda wartość ma metadane `source`, `asOf`, `delayMinutes`, `stale`; awaria dostawcy = ostatnie dane z flagą „nieaktualne”, nigdy pusty ekran.
- Archiwum GPW: 1 żądanie na dzień sesyjny, identyfikujący `User-Agent`, **bez obchodzenia jakichkolwiek blokad**; Stooq — tylko ręczny import pliku (automaty zakazane w `robots.txt`); Yahoo — best effort z degradacją do „tylko EOD”. Kwoty dostawców planowane (token bucket), testy kontraktowe na zapisanych próbkach — bez sieci w CI.
- Dane rynkowe tylko dla zalogowanych (sesja lub PAT); atrybucje źródeł według `11-zgodnosc-prawna.md` § 6.

### 5.7 Repozytorium publiczne i sekrety
- Nigdy nie commituj sekretów, adresów IP, wewnętrznych nazw hostów, portów usług domowych, konfiguracji WireGuard/SSH ani rzeczywistych wyciągów; wartości instancji jako znaczniki `<…>` albo zmienne środowiskowe (`*_FILE` w produkcji). Pliki `.xlsx`/`.csv` tylko w `**/fixtures/anonymized/**`.
- Nie masz dostępu do serwerów ani sekretów: zadania infrastrukturalne kończ skryptem, konfiguracją i instrukcją krok po kroku dla właściciela.

### 5.8 Zależności
- Najpierw standard platformy (Web API, Node, PostgreSQL, CSS). Nowa zależność wymaga uzasadnienia w PR i wpisu w `stack-technologiczny.md`; licencje MIT, Apache-2.0, BSD, ISC, MPL-2.0 (bez AGPL/GPL w kodzie aplikacji); aktywne utrzymanie.
- `pnpm-workspace.yaml`: `minimumReleaseAge: 4320`, `trustPolicy: no-downgrade`, `strictDepBuilds: true`, `blockExoticSubdeps: true`, `allowBuilds` tylko dla pakietów z uzasadnieniem. Instalacja zawsze z lockfile.

## 6. Jak pracować

- Małe PR-y na zadanie (lub spójną grupę), gałąź `<typ>/bl-<nr>-<opis>`, Conventional Commits po angielsku z ID `BL-xxx` w treści.
- Kolejność w zadaniu: dokument (jeśli kontrakt się zmienia) → test → kod. Nie usuwaj ani nie osłabiaj istniejących testów bez wyjaśnienia w PR.
- Definition of Done: [`CONTRIBUTING.md`](CONTRIBUTING.md) § 3. Po zadaniu zaktualizuj status w backlogu (i odchylenie estymacji), nowe ryzyka w [`docs/08-plan/ryzyka.md`](docs/08-plan/ryzyka.md).
- Raport na koniec sesji: zrobione / pominięte i dlaczego / odchylenia / decyzje do ADR / nowe ryzyka / kryteria wyjścia etapu z dowodami (jeśli etap się kończy).
- Język: dokumentacja i teksty UI po polsku (klucze w `packages/i18n`, brak literałów w komponentach); kod, identyfikatory, nazwy plików i commity po angielsku.
- Nazwy: pliki i katalogi `kebab-case`, komponenty i typy `PascalCase`, funkcje `camelCase`, stałe i env `SCREAMING_SNAKE_CASE`, tabele SQL `snake_case` w liczbie mnogiej.

**Zatrzymaj się i zapytaj właściciela, gdy:** zadanie wymaga zmiany decyzji z ADR, nowej usługi zewnętrznej lub kosztu; potrzebne są sekrety, dostęp do serwera albo realne dane; funkcja zbliża się do granicy doradztwa (§ 5.5) albo zmienia status z `11-zgodnosc-prawna.md` § 8; test bezpieczeństwa lub RLS nie przechodzi, a poprawka wymaga osłabienia kontroli.

## 7. Przegląd metodologiczny (zamiast skilli `backtest-review` i `strategy-critique`)

Obowiązkowy dla każdej funkcji z obszaru FR-04 (Monte Carlo, optymalizacja, testy skrajne, „co jeśli”, rebalancing, backtest, kalkulator celu) oraz alertów na wskaźnikach. Wynik (PASS / FAIL / NIEJASNE z uzasadnieniem i poprawką) wklej do PR. Reguły szczegółowe: [`obliczenia-finansowe.md`](docs/03-dane/obliczenia-finansowe.md) § 12–14.

### 7.1 Przegląd backtestu
1. **Look-ahead:** sygnał wyłącznie z danych do zamknięcia dnia `d`, wykonanie na otwarciu `d+1`; wskaźniki przyczynowe (bez `shift(-1)`, bez statystyk z całej serii, normalizacja tylko w oknie); test automatyczny: zmiana danych po `d` nie zmienia sygnałów ≤ `d`.
2. **Survivorship:** uniwersum point-in-time (GPW — z dziennych plików archiwum, także spółki wycofane); dla USA domyślnie tylko ETF/indeksy, dla spółek obowiązkowe ostrzeżenie.
3. **Przeuczenie:** raport liczby testowanych wariantów `N`; optymalizacja parametrów tylko w oknach walk-forward (dopasowanie 3 lata, test 1 rok, krok 1 rok) i podział IS/OOS 70/30 bez tasowania; Deflated Sharpe Ratio (DSR < 0,95 → „nieodróżnialne od szczęścia”); flaga, gdy wynik OOS < 60 % IS; domyślnie tryb bez optymalizacji; limit 500 kombinacji.
4. **Koszty:** prowizje z tabeli brokera (XTB: 0 % do 100 000 EUR obrotu miesięcznie, potem 0,2 %, min. 10 EUR), przewalutowanie 0,5 % przy każdej konwersji, poślizg według koszyków płynności, opcjonalnie podatek 19 % od zrealizowanych zysków.
5. **Reżimy:** tabela wyników per okres (2008, 2011, 2020, 2022, 2023–2024) i per stan rynku (wzrost, spadek, trend boczny); wynik zależny od jednego okresu = ostrzeżenie.
6. **Wielkość pozycji:** jawna reguła (równe wagi, stała frakcja, cel zmienności), bez dźwigni; Kelly ≤ 0,25 albo wyłączony.
7. **Wykonanie:** pozycja ≤ 5 % mediany obrotu z 20 sesji; wykluczenie instrumentów z medianą obrotu < 100 tys. PLN; brak modelu częściowych realizacji = ostrzeżenie.
8. **Werdykt:** SHIP (wszystko PASS) / FIX (konkretne poprawki) / SCRAP (błąd koncepcyjny).

### 7.2 Krytyka analizy lub strategii
1. **Hipoteza w jednym zdaniu:** co analiza mierzy albo zakłada; czy wynik da się przeczytać jako obietnicę lub zalecenie.
2. **Dane i okno:** czy historia jest wystarczająco długa (MC: proxy z ≥ 20 lat, inaczej ostrzeżenie i tabela wrażliwości); czy pokrywa hossę i bessę; czy seria nie ma otwartych problemów jakości (blokada `BLOCK`).
3. **Reżim, który psuje wynik:** zachowanie w 2008, 2020 i 2022; czy analiza ukrywa koncentrację, ryzyko USD/PLN albo krótką zmienność.
4. **Błąd estymacji:** max-Sharpe i średnie z krótkich okresów nie są domyślne; wagi jako przedziały (resampling); shrinkage kowariancji.
5. **Płynność i koszty:** czy wynik zakłada nieskończoną płynność (małe spółki GPW); koszty i podatki w modelu.
6. **Prezentacja:** lewy ogon pierwszy, mediana jako „połowa scenariuszy poniżej”, blok założeń, disclaimer; brak języka z § 5.5.
7. **Proces:** czy użytkownik zobaczy, że założenia przestały działać (dziennik, ponowne uruchomienie z zapisanym ziarnem i wersją danych); rebalancing zablokowany przy nieuzgodnionych danych.
8. **Ocena ryzyka** LOW / MEDIUM / HIGH / CATASTROPHIC i trzy pytania do właściciela przed udostępnieniem funkcji.

### 7.3 Metryki ryzyka i jakość danych
- Metryki (zmienność, Sharpe, Sortino, beta, max DD, VaR i CVaR historyczne) liczone dokładnie według definicji z `obliczenia-finansowe.md` § 7–8 — zawsze z pokazanymi założeniami: stopa wolna od ryzyka, częstotliwość, okno, annualizacja; zgodność z empyrical-reloaded na wektorach.
- Każda seria EOD przechodzi kontrole z § 14 (integralność OHLC, duplikaty, luki według kalendarza, świece „martwe”, skoki bez zdarzenia korporacyjnego, zmiana waluty lub ISIN); seria z problemem `BLOCK` nie trafia do analiz, a UI podaje powód.

## 8. Polecenia (dostępne od M0)

| Polecenie | Po co |
|---|---|
| `pnpm install --frozen-lockfile` | instalacja z lockfile |
| `pnpm turbo run lint typecheck test build` | pełne sprawdzenie jak w CI |
| `pnpm db:test` | migracje od zera, porównanie z `schema.sql`, `testy-rls.sql` |
| `pnpm check:deps` | reguły warstw modułów |
| `pnpm gen:module <nazwa>` | szkielet nowego modułu (lista kontrolna: `moduly.md` § 8.1) |
| `docker compose -f compose.dev.yaml up -d` | lokalne PostgreSQL, Valkey i Mailpit |
| `pnpm admin:<polecenie>` | polecenia administracyjne (kontrakt: [`docs/12-dla-uzytkownika/instrukcja-administratora.md`](docs/12-dla-uzytkownika/instrukcja-administratora.md) § 2) |

Prompty startowe i paczki zadań na sesje: [`docs/08-plan/prompty-codex.md`](docs/08-plan/prompty-codex.md).
