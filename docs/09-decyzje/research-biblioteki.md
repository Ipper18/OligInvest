# Research: biblioteki i komponenty gotowe

**Cel:** dla każdego elementu systemu wybrać gotowe, darmowe rozwiązanie open source (lub uzasadnić budowę własną), na podstawie zweryfikowanych wersji, licencji i rozmiarów — tak, aby `stack-technologiczny.md` i ADR-y nie opierały się na pamięci.

> **Aktualizacja (Krok 3, 2026-09-18):** finalne wybory i wersje są w [`../01-architektura/stack-technologiczny.md`](../01-architektura/stack-technologiczny.md). Zmiany względem tego researchu: Serwist → własny service worker; Redis → Valkey 9 (dwie instancje); PostgreSQL 16 → 18; dodane: SheetJS CE (XLS z archiwum GPW), `@node-rs/argon2` (Better Auth domyślnie używa scrypt), `yahoo-finance2`, `nodemailer`, TanStack Query, Tailwind CSS 4, Biome.

Data weryfikacji: 2026-09-18. Wersje i licencje z `npm view` / PyPI JSON / GitHub REST API; rozmiary gzip z bundlephobia.com. Kryteria wspólne: 0 zł, self-host, licencja niewymuszająca publikacji kodu aplikacji przy prywatnym użyciu, aktywne utrzymanie (commit ≤ 6 mies.), zgodność z budżetem 200 KB gzip na initial bundle.

## 1. Wykresy (świece + wolumen + 10 lat danych + płynność na telefonie)

| Biblioteka | Wersja | Licencja | gzip | Renderer | Świece+wolumen | Duże serie (2 500+ świec) | Dotyk/mobile | Werdykt |
|---|---|---|---|---|---|---|---|---|
| [Lightweight Charts](https://github.com/tradingview/lightweight-charts) | 5.2.1 | Apache-2.0 (**wymagana atrybucja TradingView** na wykresie) | 60 KB | canvas | natywnie (candlestick + histogram, skale cen/czasu) | tak — zaprojektowana pod to | tak (pinch, pan) | ✅ **primary** dla świec, wskaźników nakładanych, wolumenu |
| [uPlot](https://github.com/leeoniya/uPlot) | 1.6.32 | MIT | 21 KB | canvas | OHLC przez plugin, brak gotowego wolumenu | bardzo szybka (100k+ pkt) | podstawowy | ✅ **secondary**: krzywa kapitału, drawdown, sparkline, wykresy w tabelach |
| [Apache ECharts](https://github.com/apache/echarts) | 6.1.0 | Apache-2.0 | 359 KB (pełny; tree-shaking ~120–150 KB) | canvas/SVG | tak | tak | tak | ⛔ za ciężki na budżet; jedyna przewaga (heatmapa/treemap) zastępowalna CSS-grid |
| Recharts | — | MIT | ~45 KB | SVG | słabo | ❌ SVG pada przy tysiącach elementów | ok | ⛔ |
| visx | — | MIT | modułowa | SVG | DIY | ❌ | DIY | ⛔ zbyt dużo pracy własnej |

Decyzja: Lightweight Charts (lazy, tylko na ekranach z wykresem) + uPlot (lekkie serie). Heatmapa sektorowa i treemap alokacji: własny komponent CSS-grid/`<div>` (0 KB, dostępny z klawiatury) — ADR-009.

## 2. Analiza techniczna

| Opcja | Wersja | Licencja | Uwagi | Werdykt |
|---|---|---|---|---|
| Własne implementacje w `packages/core` (TS) | — | — | SMA/EMA/RSI/MACD/Bollinger/ATR/OBV/VWAP to < 300 linii; jedna implementacja dla web/PWA/workera; `decimal.js` tam, gdzie liczymy pieniądze, `number` dla wskaźników | ✅ **buduj** (uzasadnienie: współdzielenie z PWA offline i brak zależności; testy referencyjne vs TA-Lib) |
| [TA-Lib (python)](https://pypi.org/project/TA-Lib/) | 0.8.0 (2026-09-13) | BSD | wheels z wbudowaną biblioteką C; 150+ wskaźników | ✅ **wzorzec referencyjny** w testach workera |
| pandas-ta | PyPI 0.4.71b0 (2025-09-14) | MIT | **repozytorium GitHub autora usunięte/prywatne** — ryzyko utrzymania | ⚠️ nie używać |
| [pandas-ta-classic](https://pypi.org/project/pandas-ta-classic/) | 0.8.32 | MIT | fork społecznościowy | ⚠️ opcjonalnie w workerze; TA-Lib wystarcza |
| technicalindicators (JS) | 3.1.0 | MIT | mało aktywna, `number` only | ⛔ |
| tulipindicators | — | LGPL | C, bindingi | ⛔ zbędne |

## 3. Backtesting (worker Python)

| Biblioteka | Wersja | Licencja | Uwagi | Werdykt |
|---|---|---|---|---|
| [vectorbt](https://github.com/polakowo/vectorbt) | 1.1.0 (2026-07-05), Python 3.11–3.14 | **Apache-2.0 + Commons Clause** (zakaz *sprzedaży* oprogramowania, którego wartość wynika z vectorbt) | wektorowe backtesty tysięcy parametrów, walk-forward, Monte Carlo na kolejności transakcji; skille `vectorbt-reference` gotowe | ✅ **primary**; ⚠️ Commons Clause → wpis w `10-ograniczenia.md` (gdyby aplikacja miała być kiedyś płatna) |
| [backtesting.py](https://github.com/kernc/backtesting.py) | 0.6.6 | **AGPL-3.0** | prosta, event-driven, wolniejsza | ⚠️ fallback; AGPL zobowiązuje do udostępnienia źródeł użytkownikom sieciowym |
| nautilus_trader | 1.231.0 | LGPL-3.0 | silnik live-trading, Rust, ciężki | ⛔ overkill |

## 4. Portfel i ryzyko (worker Python)

| Biblioteka | Wersja | Licencja | Rola | Werdykt |
|---|---|---|---|---|
| [PyPortfolioOpt](https://github.com/PyPortfolio/PyPortfolioOpt) | 1.6.0 (2026-02-26) | MIT | Markowitz, Black-Litterman, HRP, risk parity (przez `EfficientFrontier`/`HRPOpt`), ograniczenia wag | ✅ |
| [quantstats](https://github.com/ranaroussi/quantstats) | 0.0.81 (2026-01-13) | Apache-2.0 | tearsheety, metryki, porównanie z benchmarkiem | ✅ (raporty w workerze; UI liczy podstawowe metryki w `core`) |
| empyrical-reloaded | 0.5.12 | Apache-2.0 | czyste funkcje metryk (Sharpe, Sortino, max DD, VaR) | ✅ jako funkcje referencyjne w testach `packages/core` |
| pyfolio-reloaded | 0.9.9 | Apache-2.0 | tearsheety (starsze) | ⛔ quantstats wystarcza |

Uwaga metodologiczna: TWR, XIRR, cost basis i P/L **muszą** być liczone w `packages/core` (TS) — to źródło prawdy dla UI, PWA i eksportów; Python liczy tylko to, czego nie da się sensownie zrobić w TS (optymalizacja, MC, backtest).

## 5. Tabele danych

[TanStack Table](https://github.com/TanStack/table) 9.2.4 (MIT, 31 KB gzip, headless) + TanStack Virtual 3.14.13 (MIT) — ✅ jedyny sensowny kandydat: headless (własne style, WCAG), wirtualizacja wierszy dla dziennika transakcji i screenera.

## 6. Uwierzytelnianie

| Opcja | Wersja | Licencja | 2FA TOTP | OAuth | RBAC/admin | Self-host | Werdykt |
|---|---|---|---|---|---|---|---|
| [Better Auth](https://github.com/better-auth/better-auth) | 1.7.5 | MIT | plugin `twoFactor` (TOTP, backup codes, trusted devices, lockout) | Google/GitHub wbudowane | plugin `admin` (role, ban, sesje) | tak (adapter Drizzle/Postgres) | ✅ **wybrany** — uwaga: logowania OAuth/passkey nie są domyślnie objęte 2FA (Z-04 w `00-przeglad/wymagania.md`, [ADR-004](ADR-004-postgres-better-auth-rls.md)) |
| Auth.js (NextAuth) | 5.x | ISC | brak wbudowanego TOTP | tak | brak | tak | ⛔ 2FA do napisania samemu |
| Keycloak | 26.x | Apache-2.0 | tak | tak | pełne | tak, ale Java ≈ 1 GB RAM | ⛔ za ciężki na współdzielony i5 |
| Supabase Auth | — | Apache-2.0 | tak (MFA) | tak | RLS | ciężki self-host (~10 kontenerów) | ⛔ wg decyzji Kroku 0 |

## 7. Panel administratora (nie od zera, ale w budżecie bundle'a)

| Opcja | Wersja | Licencja | Waga | Werdykt |
|---|---|---|---|---|
| [Refine](https://github.com/refinedev/refine) (`@refinedev/core`) | 5.0.12 | MIT | headless core ~40 KB; UI dowolne | ✅ **jeśli** panel urośnie; ładowany wyłącznie w `/admin` |
| react-admin | 5.15.3 | MIT | z MUI 250–400 KB | ⛔ |
| AdminJS | — | MIT | własny frontend, Express | ⛔ osobna aplikacja, duplikacja auth |
| Directus | — | BSL 1.1 / GPL dla małych org. | osobny serwer ≈ 500 MB RAM | ⛔ |
| Minimalny panel w apce (TanStack Table + formularze + endpointy `/admin/*` z OpenAPI) | — | — | ~0 KB dodatkowo | ✅ **rekomendacja dla MVP** (kilku użytkowników) — ADR-006 |

## 8. Realtime

SSE (`EventSource`, standard platformy, 0 KB) ✅ — dane są opóźnione/EOD, więc strumień jednokierunkowy co 1–15 min + alerty wystarcza; działa przez nginx/Caddy bez konfiguracji WS, wznawia się sam (`Last-Event-ID`). WebSocket ⛔ (dwukierunkowość niepotrzebna). Supabase Realtime ⛔.

## 9. Onboarding / samouczki

| Biblioteka | Wersja | Licencja | gzip | Werdykt |
|---|---|---|---|---|
| [driver.js](https://github.com/nilbuild/driver.js) | 1.8.0 | MIT | 7 KB | ✅ (framework-agnostic, dostępny z klawiatury) |
| Shepherd.js | 15.3.0 | **AGPL-3.0** | ~20 KB | ⛔ licencja |
| react-joyride | 3.2.0 | MIT | > 30 KB | ⛔ cięższy, tylko React |

## 10. Szkielet aplikacji i infrastruktura (wersje bieżące)

| Element | Wybór | Wersja | Licencja |
|---|---|---|---|
| Monorepo | Turborepo + pnpm | turbo 2.11.1 | MIT |
| Frontend | Next.js (App Router, RSC) + React | 16.3.5 / 19.3.0 | MIT |
| PWA | ~~Serwist (`@serwist/next`) 9.5.12~~ → **własny service worker** wg oficjalnego przewodnika PWA Next.js 16 (Krok 3, [ADR-008](ADR-008-pwa-i-integracje-mobilne.md)) | — | — |
| API | Hono + `@hono/zod-openapi` | 4.13.8 / 1.6.3 | MIT |
| Walidacja | Zod | 4.6.5 | MIT |
| ORM/migracje | Drizzle ORM | 0.45.2 | Apache-2.0 |
| Kolejka | BullMQ (Node) + `bullmq` (PyPI) | 6.3.7 / 3.2.3 | MIT |
| Push | `web-push` (VAPID) | 3.6.7 | MPL-2.0 |
| Pieniądze | `decimal.js` | 10.6.0 | MIT |
| Wydajność w CI | ~~Lighthouse CI (`@lhci/cli`) 0.15.1~~ → **Lighthouse 13.5** uruchamiany skryptem w CI (Krok 4: `@lhci/cli` bez wydań od 2025-06, zawiera Lighthouse 12.6.1) | 13.5.0 | Apache-2.0 |
| Kalendarz sesji | `pandas-market-calendars` (XWAR obsługiwany) | 5.4.0 | MIT |

## 11. Co budujemy sami (uzasadnienia jednoakapitowe)

- **`packages/core` (obliczenia finansowe)** — brak biblioteki TS liczącej TWR/XIRR/cost basis FIFO z wieloma walutami i polskim podatkiem; implementacje Python (empyrical) nie działają w PWA offline; wzory są proste, a ich poprawność musi być pod naszą kontrolą (testy referencyjne vs empyrical/TA-Lib).
- **Wskaźniki TA w TS** — j.w.; rozmiar < 300 linii, zero zależności.
- **`DataProvider` z fallbackami i cache** — Ghostfolio i OpenBB mają abstrakcje dostawców, ale w Angular/NestJS i Pythonie; przenosimy *projekt interfejsu*, nie kod (patrz `03-dane/strategia-cache.md`).
- **Parsery CSV/XLSX brokerów (XTB, mBank)** — brak gotowych parserów TS; formaty udokumentowane społecznościowo (podatekgieldy.pl); mały zakres.
- **Heatmapa/treemap** — komponent CSS zamiast 120+ KB ECharts.
- **Minimalny panel admina** — kilku użytkowników; formularze + tabela; Refine w rezerwie.
