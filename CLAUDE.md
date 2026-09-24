# OligInvest — instrukcje dla Claude Code

**Cel:** dać Claude Code kontekst projektu, zasady pracy, politykę sekretów i listę narzędzi, aby każda sesja była spójna z dokumentacją w `docs/`.

## Kontekst projektu

OligInvest to **prywatna** aplikacja webowa (PWA) do analizy inwestycji dla właściciela i kilku zaufanych osób:
portfel (stan obecny, P/L, ekspozycja walutowa PLN/USD/EUR), analiza inwestycji przeszłych (import CSV z XTB i mBank
eMakler, TWR/XIRR, cost basis), analiza przyszłych (scenariusze i rozkłady — **nigdy prognozy punktowe**), alerty,
warstwa edukacyjna. Rynki: GPW + USA + ETF. Budżet operacyjny: **0 zł** — wszystko self-hostowane w VM na Proxmoxie
(Dell 7020, i5-4590, 16 GB) za WireGuardem i małym VPS OVH jako edge; domena `oligi.pl`.

**Faza obecna: budowa według planu.** Kod aplikacji buduje Codex według `docs/` i `AGENTS.md`. Wybrane, rozłączne
paczki (np. rdzeń obliczeń w `packages/core`) może realizować Claude Code — na osobnej gałęzi, w osobnym PR, na tych
samych zasadach co Codex (`AGENTS.md`, Definition of Done z `CONTRIBUTING.md` § 3). Decyzja właściciela z 2026-09-24.

Źródło prawdy dla wymagań: `docs/00-przeglad/wymagania.md`. Decyzje: `docs/09-decyzje/ADR-*.md`. Plan: `docs/08-plan/`.

## Stack (zaakceptowany; szczegóły i wersje: `docs/01-architektura/stack-technologiczny.md`; zmiany tylko przez ADR)

- Monorepo Turborepo + pnpm: `apps/web` (Next.js 16, PWA, bez dostępu do bazy), `apps/api` (Hono + Better Auth, jedyna
  granica domenowa, REST `/api/v1` + SSE), `apps/jobs` (Node 24 + BullMQ: ingest, import, alerty, powiadomienia),
  `apps/analytics` (Python 3.13: vectorbt, PyPortfolioOpt, quantstats — bez internetu i bez danych użytkowników w bazie).
- `modules/*` — moduły domenowe (identity, notifications, market, portfolio + wyłączalne analytics, alerts, education,
  admin, quick-actions); `packages/core` (TS, `decimal.js` — jedyna implementacja obliczeń finansowych),
  `packages/contracts` (Zod → OpenAPI i JSON Schema), `packages/db` (Drizzle + PostgreSQL 18 + RLS),
  `packages/data-providers` (port/adapter, fallbacki, kwoty), `packages/platform`, `packages/ui`.
- Valkey 9 ×2 (kolejki `noeviction` + cache LRU) · Better Auth (Argon2id, **TOTP obowiązkowe** przez bramkę MFA, PAT) ·
  SSE · Web Push (własny service worker) · e-mail SMTP (Brevo) · Docker Compose w VM (Debian 13) · Caddy w VM,
  VPS = TLS passthrough.
- Dane: opóźnione ~15 min (Yahoo, best effort) i EOD (archiwum GPW, uczciwie identyfikujący się klient, bez obchodzenia
  blokad). Stooq zabrania automatów (`robots.txt`) — tylko ręczny import CSV. NBP API dla kursów walut.

## Zasady pracy i kodowania

- Dokumentacja po polsku; kod, identyfikatory, nazwy plików technicznych, commity — po angielsku.
- Każdy dokument w `docs/` zaczyna się od jednozdaniowego celu. Liczby (limity API, wersje, ceny) mają link i datę
  weryfikacji albo znacznik **NIEZWERYFIKOWANE**. Nie wymyślaj bibliotek ani linków.
- Kwestionuj wymagania: konflikty (wydajność vs funkcja, 0 zł vs usługa) trafiają do sekcji „Zastrzeżenia do
  specyfikacji” w `wymagania.md` i do `docs/10-ograniczenia.md` — nie ukrywaj ich.
- Konwencje nazw (dla przyszłego kodu): `kebab-case` katalogi i pliki, `PascalCase` komponenty/typy, `camelCase`
  funkcje/zmienne, `SCREAMING_SNAKE_CASE` stałe i env, tabele SQL `snake_case` liczba mnoga, ID wymagań `FR-xx`/`NFR-xx`,
  ADR `ADR-NNN-slug.md`. Commity: Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`).
- Pieniądze: nigdy `float` — `decimal.js` w TS, `Decimal` w Pythonie, `NUMERIC` w SQL, kwoty w JSON jako ciągi;
  waluta zawsze jawna (ADR-014).
- Preferuj mniej warstw i mniej zależności; każda nowa biblioteka wymaga uzasadnienia (ADR lub sekcja w
  `stack-technologiczny.md`). Jeśli da się standardem platformy — standardem.

## Polityka sekretów

- Sekrety tylko w `.env` (ignorowany) lub w zmiennych środowiskowych; w repo wyłącznie `.env.example` z pustymi wartościami.
- `.mcp.json` odwołuje się do kluczy wyłącznie przez `${VAR}`. Przed commitem: `git grep -nE '(api[_-]?key|secret|token)\s*[:=]\s*["'"'"']?[A-Za-z0-9_\-]{16,}'`.
- Skille społecznościowe nie mogą czytać env poza własnymi parametrami ani wywoływać sieci — patrz
  `docs/09-decyzje/audyt-pluginow.md`.
- **Repozytorium jest publiczne** (ADR-013): nigdy nie commituj adresów IP, wewnętrznych nazw hostów, portów usług
  domowych, konfiguracji WireGuard/SSH ani rzeczywistych wyciągów brokerskich; fixtures tylko po anonimizacji.
  Gałąź główna: `main`.

## Wymóg regulacyjny (MiFID II / rekomendacje inwestycyjne)

Aplikacja **edukuje i analizuje, nie doradza**. Każdy ekran z sugestią, scenariuszem, screeningiem lub wynikiem
backtestu musi pokazywać: założenia, źródło i opóźnienie danych, przedział/rozkład zamiast wartości punktowej oraz
disclaimer z `docs/11-zgodnosc-prawna.md`. Zakazane: „cena za 30 dni = X”, sygnały bez przedziału ufności, język
imperatywny („kup”, „sprzedaj”).

## Aktywne skille i kiedy ich używać

Krytyka metodologiczna (obowiązkowe przy każdej funkcji predykcyjnej/backtestowej):
- `strategy-critique` — adwersarialny przegląd strategii przed opisaniem jej jako funkcji.
- `backtest-review` — look-ahead, survivorship, przeuczenie, koszty transakcyjne w każdym opisie backtestu.
- `risk-report` — metryki z serii zwrotów (Sharpe, Sortino, max DD, VaR) — spójne z `obliczenia-finansowe.md`.
- `data-scrub` — walidacja danych rynkowych (luki, splity, duplikaty) przy projektowaniu `DataProvider`.
- `indicator-design`, `hedge-lab` — projektowanie wskaźników i hedgingu (rzadziej).

Obliczenia i portfel:
- `cost-basis-engine` (FIFO/średnia — u nas FIFO wg polskiego prawa podatkowego), `trade-accounting`,
  `portfolio-analytics`, `risk-management`, `position-sizing`, `kelly-criterion`, `position-sizer`,
  `drawdown-circuit-breaker`.

Backtesting i analiza (rynek USA jako wzorzec; adaptować do GPW):
- `vectorbt-reference` (baza wiedzy dla workera Python), `backtest-expert`, `us-stock-analysis`,
  `trade-performance-coach` (postmortem transakcji), `weekly-performance-digest`.

Pluginy Anthropic: `feature-dev` (projektowanie funkcji), `frontend-design` (UI), `code-review`, `security-guidance`
(hooki bezpieczeństwa aktywne w sesji). Serwery MCP: `context7` (dokumentacja bibliotek — używaj zamiast pamięci),
`playwright` (podgląd/testy UI), `github`, `alphavantage`, `twelvedata` (eksploracja danych; limity free tier!).

## Struktura repozytorium

```
docs/            dokumentacja projektowa (00–12) — produkt tej fazy
.claude/skills/  skille per-projekt (audyt w docs/09-decyzje/audyt-pluginow.md)
.mcp.json        serwery MCP (klucze z env)      AGENTS.md  instrukcje dla Codex
.env.example     wzorzec zmiennych              README.md  wejście dla ludzi
CONTRIBUTING.md  zasady pracy i Definition of Done   SECURITY.md  zgłaszanie podatności
```
