# Wydajność — budżety, strategia ładowania, egzekwowanie w CI

**Cel:** ustalić mierzalne budżety wydajności OligInvest (Core Web Vitals, JavaScript per trasa, czasy API), oprzeć je na pomiarach frameworka i bibliotek, rozpisać co renderuje serwer, co klient, a co strumień dla każdej trasy oraz opisać, jak CI blokuje regresje (NFR-01.01–NFR-01.09).

Powiązane: [`architektura-ui.md`](architektura-ui.md), [`mapa-ekranow.md`](mapa-ekranow.md), [`system-projektowy.md`](system-projektowy.md), [`../02-api/realtime.md`](../02-api/realtime.md), [ADR-009](../09-decyzje/ADR-009-wykresy.md), [`../01-architektura/stack-technologiczny.md`](../01-architektura/stack-technologiczny.md) § 9.

## 1. Cele

| Metryka | Próg | Gdzie mierzona | Wymaganie |
|---|---|---|---|
| LCP | < 2,0 s (p75) | laboratorium: Lighthouse, profil mobilny, mediana z 3 przebiegów; teren: RUM | NFR-01.01 |
| INP | < 200 ms (p75) | teren: RUM (Lighthouse w laboratorium nie mierzy INP — zastępczo **TBT < 200 ms**) | NFR-01.01 |
| CLS | < 0,1 (p75) | laboratorium + RUM (RUM tylko w przeglądarkach Chromium — § 7) | NFR-01.01 |
| JS początkowy trasy | < 200 KB gzip | skrypt raportu tras w CI (§ 6.1) | NFR-01.02 |
| Biblioteki wykresów i onboardingu poza `/` | 0 bajtów w chunkach `/` | skrypt raportu tras (markery bibliotek) | NFR-01.03 |
| Punkty serii | ≤ 3 000 | test API | NFR-01.04 |
| Odczyty API | p95 < 300 ms, bez wywołań zewnętrznych | test obciążeniowy na serwerze docelowym | NFR-01.05 |
| Opóźnienie SSE | < 2 s od zapisu | test integracyjny | NFR-01.06 |
| Wpływ analiz na API | p95 odczytów rośnie o ≤ 20 % podczas MC | test obciążeniowy | NFR-01.07 |
| Zasoby | VM ≤ 6 GB RAM / 3 vCPU przy ≤ 5 użytkownikach | test obciążeniowy | NFR-01.08 |

## 2. Pomiary bazowe (2026-09-19)

**Framework.** Minimalna aplikacja Next.js 16.3.5 + React 19.3.0 (App Router, jedna strona z jednym komponentem klienckim), skrypty z wygenerowanego HTML, gzip -9:

| Builder | JS dla nowoczesnych przeglądarek | Polyfille `noModule` (niepobierane przez nowoczesne przeglądarki) |
|---|---|---|
| Turbopack (domyślny w Next.js 16) | **130,1 KB** | 38,5 KB |
| webpack (`next build --webpack`) | **127,7 KB** | 38,5 KB |

Wniosek: z budżetu 200 KB **framework zużywa ok. 130 KB**; na powłokę aplikacji i kod trasy zostaje ok. **70 KB**. Next.js 16 nie wypisuje już rozmiarów tras w wyniku `next build`, dlatego CI mierzy je własnym skryptem (§ 6.1).

**Biblioteki** (esbuild, minifikacja, ESM, gzip -9, React jako zależność zewnętrzna; import typowego API):

| Biblioteka | Wersja | gzip | Gdzie wolno |
|---|---|---|---|
| Lightweight Charts (świece, histogram, linia) | 5.2.1 | 54,0 KB | leniwie: karta instrumentu |
| uPlot | 1.6.32 | 22,5 KB | leniwie: historia portfela, obsunięcia, wyniki analiz |
| TanStack Query | 5.103.1 | 10,7 KB | powłoka aplikacji |
| TanStack Table (wszystkie eksporty — górna granica) | 9.2.4 | 32,7 KB | leniwie: sortowanie/filtry tabel |
| TanStack Virtual | 3.14.13 | 7,6 KB | leniwie: listy > 100 wierszy |
| driver.js | 1.8.0 | 7,1 KB | leniwie: onboarding |
| openapi-fetch | 0.17.0 | 2,5 KB | powłoka aplikacji |
| web-vitals | 6.2.2 | 3,2 KB | po zdarzeniu `load` (poza budżetem początkowym) |
| decimal.js | 10.6.0 | 12,6 KB | **nie w przeglądarce** (UI nie liczy pieniędzy) |
| Zod: `import * as z` / `import { z }` / `zod/mini` | 4.6.5 | 25,3 / 89,9 / 5,2 KB | tylko leniwe formularze; `{ z }` zakazany |
| Radix: 6 komponentów łącznie (dropdown, popover, tooltip, toast, tabs, slider) | 1.x–2.x | 41,7 KB | tylko leniwie ([`architektura-ui.md`](architektura-ui.md) § 10) |

Pomiary powtarza w M0 zadanie „raport rozmiarów” — liczby w tym dokumencie aktualizujemy przy każdej zmianie wersji głównej.

## 3. Budżety per trasa (gzip)

**JS początkowy** = skrypty wskazane w HTML trasy (bez `noModule`). **Leniwe** = chunki doładowywane po hydratacji (dynamiczny import). **Razem** = wszystko pobrane do pełnej interaktywności typowego użycia ekranu.

| Trasa | JS początkowy | Leniwe (maks.) | Razem | Zakazane w chunkach początkowych |
|---|---|---|---|---|
| `/logowanie`, `/logowanie/2fa`, `/rejestracja/[token]`, `/konfiguracja-2fa` | ≤ 160 KB | — | ≤ 160 KB | TanStack Query, wykresy, Radix |
| `/` (Start) | ≤ 190 KB | uPlot 23 KB (po LCP) | ≤ 230 KB | Lightweight Charts, uPlot, driver.js (NFR-01.03), Radix |
| `/portfel`, `/portfel/*` | ≤ 195 KB | tabela + wirtualizacja 41 KB, menu 31 KB, uPlot 23 KB | ≤ 290 KB | wykresy, Radix, Zod |
| `/rynek/[instrumentId]` | ≤ 190 KB | Lightweight Charts 54 KB, wyszukiwarka 24 KB | ≤ 280 KB | Radix, Zod |
| `/rynek/screener`, `/rynek/heatmapa` | ≤ 195 KB | tabela + wirtualizacja 41 KB | ≤ 250 KB | wykresy, Zod |
| `/analizy`, `/analizy/*` | ≤ 195 KB | uPlot 23 KB, Zod 26 KB, zakładki + suwak 19 KB | ≤ 270 KB | Lightweight Charts |
| `/alerty`, `/alerty/*` | ≤ 190 KB | Zod 26 KB | ≤ 220 KB | wykresy |
| `/nauka`, `/nauka/*` | ≤ 180 KB | driver.js 8 KB | ≤ 190 KB | wykresy, Zod |
| `/ustawienia/*` | ≤ 185 KB | — | ≤ 190 KB | wykresy |
| `/admin/*` | ≤ 200 KB | tabela 41 KB, menu 31 KB, zakładki 9 KB | ≤ 290 KB | — (poza nawigacją użytkowników) |

Powłoka aplikacji `(app)` (TanStack Query, klient API, SSE, nawigacja, formatery, słownik komunikatów PL) ma własny budżet **≤ 30 KB** ponad framework — kontrolowany przez `size-limit` (§ 6.2).

## 4. Co renderuje serwer, klient i strumień

Wszystkie strony są renderowane dynamicznie (CSP z nonce — [`architektura-ui.md`](architektura-ui.md) § 5).

| Trasa | Serwer (RSC, HTML) | Streaming (`Suspense`) | Klient (hydratacja / leniwie) | SSE |
|---|---|---|---|---|
| `/logowanie` i trasy auth | cały formularz | — | walidacja natywna, wysyłka | — |
| `/` | powłoka, kafelki wartości i wyniku dnia (element LCP) | pozycje top, alokacja, historia, alerty | aktualizacje kafelków; wykres historii (uPlot) po LCP | wycena, kursy |
| `/portfel` | tabela pozycji (pierwsza strona) jako HTML | sumy, ekspozycja walutowa | sortowanie i filtry (TanStack Table) po interakcji; wirtualizacja > 100 wierszy | wycena |
| `/portfel/operacje` | pierwsza strona listy | — | filtry w URL, kursor „więcej”, formularz w `<dialog>` | wycena |
| `/portfel/import/[importId]` | podsumowanie i uzgodnienie | wiersze | rozstrzyganie wierszy, zatwierdzenie | `portfolio.import.parsed` |
| `/portfel/wyniki`, `/ryzyko`, `/alokacja`, `/dywidendy` | tabele metryk z założeniami | wykresy jako dane | wykresy uPlot / pierścień CSS (leniwie) | wycena |
| `/rynek/[instrumentId]` | nagłówek z kursem, zmianą i świeżością (LCP), statystyki | newsy, kalendarz | wykres świecowy (Lightweight Charts) po LCP; wskaźniki na żądanie | kursy instrumentu |
| `/rynek/heatmapa` | siatka kafelków w HTML + CSS (bez biblioteki) | — | przełączniki okresu i rozmiaru | — |
| `/rynek/screener` | formularz kryteriów, ostatni zestaw | wyniki | tabela z wirtualizacją | — |
| `/analizy/nowa/[typ]` | formularz z wartościami domyślnymi i limitami | — | walidacja złożona (Zod leniwie), podgląd założeń | — |
| `/analizy/[runId]` | status, założenia, tabele wyników | — | wykresy wyniku (uPlot) | `analytics.run.*` |
| `/alerty/*` | listy i formularz | — | kreator reguły | `alerts.alert.triggered` |
| `/nauka/*` | treść MDX (zero JS dla treści) | — | onboarding (driver.js) na żądanie | — |
| `/admin/*` | tabele pierwszej strony | wskaźniki stanu | akcje, sortowanie, filtry | stan kolejek (odpytywanie 10 s) |

## 5. Techniki

**LCP**
- HTML z danymi pierwszego widoku z serwera (RSC + streaming); element LCP to tekst (wartość portfela, kurs), nie obraz ani wykres.
- Fonty systemowe (brak pobierania fontów), brak obrazów w pierwszym widoku, CSS Tailwind jako jeden mały plik.
- TTFB: renderowanie w HomeLabie, dane z bazy i `valkey-cache` (bez zewnętrznych API — NFR-01.05); HTTP/2 i kompresja zstd/brotli w Caddy.

**INP**
- Brak długich zadań > 50 ms: filtry i sortowanie w `startTransition`, wyszukiwarka z opóźnieniem 200 ms, listy > 100 wierszy wirtualizowane.
- Aktualizacje z SSE łączone (maks. 1 na 5 s dla kursów — [`realtime.md`](../02-api/realtime.md) § 4) i wykonywane w `requestAnimationFrame` dla wykresów.
- Ciężkie obliczenia wyłącznie po stronie serwera (analizy w workerze Python); w przeglądarce tylko formatowanie.

**CLS**
- Szkielety o docelowych wymiarach; kontenery wykresów z `aspect-ratio`; banery stanu (nieaktualne dane, offline) jako nakładka lub w zarezerwowanym miejscu.
- Cyfry tabelaryczne — aktualizacja kursu nie zmienia szerokości kolumn.

**Dane**
- Serie decymowane na serwerze do ≤ 3 000 punktów (świece: agregacja OHLC do interwału; linie: LTTB), kolumnowe tablice liczb (`konwencje-api.md` § 3).
- `ETag` + `If-None-Match` dla danych użytkownika i wykresów EOD; `Cache-Control: private, max-age=300` dla wykresów dziennych.
- Prefetch linków Next.js ograniczony do nawigacji głównej (telefon: bez prefetchu tras ciężkich).

## 6. Egzekwowanie w CI

### 6.1 Raport JS per trasa

Next.js 16 nie podaje rozmiarów tras w wyniku buildu, więc `apps/web/scripts/route-budgets.mjs` (zadanie M0):

1. uruchamia `next start` na buildzie produkcyjnym z bazą z danymi testowymi i sesją użytkownika testowego (sesja z `mfa_verified_at`, tworzona skryptem seedującym wyłącznie w CI);
2. pobiera HTML każdej trasy z tabeli § 3, zbiera skrypty bez `noModule`, liczy gzip -9;
3. szuka w chunkach początkowych markerów zakazanych bibliotek (charakterystyczne nazwy klas CSS lub ciągi licencji — ustalane w M0);
4. porównuje z `apps/web/budgets.json` i publikuje tabelę w podsumowaniu zadania GitHub Actions; przekroczenie = czerwony build (NFR-01.02, NFR-01.03).

```json
{
  "compression": "gzip-9",
  "routes": {
    "/logowanie": { "initialKb": 160, "forbid": ["query", "charts", "radix"] },
    "/": { "initialKb": 190, "totalKb": 230, "forbid": ["lightweight-charts", "uplot", "driver.js", "radix"] },
    "/portfel": { "initialKb": 195, "totalKb": 290, "forbid": ["charts", "radix", "zod"] },
    "/rynek/{fixtureInstrumentId}": { "initialKb": 190, "totalKb": 280, "forbid": ["radix", "zod"] }
  }
}
```

### 6.2 size-limit dla pakietów współdzielonych

`size-limit` 14 pilnuje punktów wejścia, które trafiają do wielu tras — regresja jest widoczna w PR, zanim wpłynie na trasę:

```json
[
  { "name": "powłoka (app): klient API + SSE + formatery", "path": "src/shell/index.ts", "limit": "30 KB", "gzip": true, "ignore": ["react", "react-dom", "next"] },
  { "name": "packages/ui — komponenty domenowe", "path": "../../packages/ui/src/index.ts", "limit": "15 KB", "gzip": true, "ignore": ["react", "react-dom"] },
  { "name": "wykres świecowy (leniwy)", "path": "src/charts/candles.tsx", "limit": "58 KB", "gzip": true, "ignore": ["react", "react-dom"] },
  { "name": "wykres serii (leniwy)", "path": "src/charts/series.tsx", "limit": "25 KB", "gzip": true, "ignore": ["react", "react-dom"] }
]
```

`size-limit` domyślnie liczy brotli — `"gzip": true` utrzymuje zgodność z budżetami w gzip.

### 6.3 Lighthouse w CI

Lighthouse 13.5 uruchamiany programowo (bez `@lhci/cli`, który nie jest rozwijany od 2025-06 — [`stack-technologiczny.md`](../01-architektura/stack-technologiczny.md) § 10). Domyślny profil Lighthouse = telefon z symulowanym dławieniem sieci i CPU. Trasy: `/logowanie`, `/`, `/portfel`, `/rynek/{fixtureInstrumentId}`.

```js
// apps/web/scripts/lighthouse-assert.mjs — fragment ilustracyjny
import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';

const ROUTES = ['/logowanie', '/', '/portfel', `/rynek/${process.env.FIXTURE_INSTRUMENT_ID}`];
const LIMITS = { 'largest-contentful-paint': 2000, 'total-blocking-time': 200, 'cumulative-layout-shift': 0.1 };
const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless=new'] });
let failed = false;
for (const route of ROUTES) {
  const runs = [];
  for (let i = 0; i < 3; i++) {
    const { lhr } = await lighthouse(`${process.env.BASE_URL}${route}`, {
      port: chrome.port, output: 'json', onlyCategories: ['performance'],
      extraHeaders: { Cookie: process.env.LH_SESSION_COOKIE ?? '' },
    });
    runs.push(lhr);
  }
  for (const [audit, limit] of Object.entries(LIMITS)) {
    const median = runs.map((r) => r.audits[audit].numericValue).sort((a, b) => a - b)[1];
    if (median > limit) { failed = true; console.error(`${route} ${audit}: ${median} > ${limit}`); }
  }
}
await chrome.kill();
process.exit(failed ? 1 : 0);
```

## 7. Pomiar w terenie (RUM)

- `web-vitals` 6.2 ładowany dynamicznie po zdarzeniu `load`; `onLCP`, `onINP`, `onCLS`, `onFCP`, `onTTFB` → paczka wysyłana `navigator.sendBeacon` na `POST /api/v1/rum/web-vitals` (bez identyfikatora użytkownika; trasa jako wzorzec bez identyfikatorów).
- Panel `/admin/rum`: p75 per trasa i klasa urządzenia (`adminGetRumSummary`), retencja 90 dni.
- **Ograniczenia (README `web-vitals` 6.2.2):** `onCLS` działa tylko w Chromium; INP i LCP także w Safari; metryki nawigacji „miękkich” (przejścia klienckie w App Router) tylko w Chromium 151+. Na iPhonie RUM mierzy więc LCP i INP pierwszego wczytania, bez CLS — CLS na iOS kontrolujemy testami w laboratorium i przeglądem.

## 8. Konflikty wydajności z funkcjami (NFR-01.09)

| Konflikt | Rozstrzygnięcie |
|---|---|
| CSP z nonce ⇒ brak renderowania statycznego i PPR | Akceptujemy: prawie każda strona zależy od użytkownika. Alternatywa: eksperymentalne SRI (osobny ADR przy problemach z TTFB). |
| Framework zużywa ~130 KB z 200 KB | Powłoka ≤ 30 KB, Radix i Zod tylko leniwie, tabele renderowane na serwerze z leniwym sortowaniem. |
| Świece 10 lat (≈ 2 500 sesji) na telefonie | Decymacja na serwerze, Lightweight Charts na canvas po LCP (ADR-009). |
| Screener na całym rynku GPW | Obliczenia i filtrowanie w `api` (dane z bazy), klient dostaje stronę wyników. |
| Heatmapa | HTML + CSS grid zamiast biblioteki wykresów (0 KB JS). |
| Onboarding | driver.js leniwie, tylko przy pierwszym logowaniu lub na żądanie. |
| Panel admina „nie od zera” | Minimalny panel w aplikacji (ADR-006), ładowany wyłącznie w `/admin`. |
| Offline shell | Tylko zasoby statyczne w cache service workera; migawka danych w IndexedDB na żądanie użytkownika. |
