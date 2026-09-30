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

## 2. Pomiary bazowe (2026-09-30)

**Framework — BL-033, pomiar 2026-09-30.** Bieżący produkcyjny build OligInvest: Next.js 16.3.5 + React 19.3.0, Turbopack, Node 24.21.0. Suma gzip -9 każdego unikalnego pliku, 1 KB w budżetach = 1 KiB = 1024 B. Polecenie odtworzenia po `pnpm turbo run build --filter=@oliginvest/web`: `pnpm --filter @oliginvest/web measure:baselines` ([skrypt](../../apps/web/scripts/measure-baselines.mjs)).

| Wejście bieżącego buildu | Bajty gzip | KiB |
|---|---:|---:|
| Wspólny bootstrap Next.js/React (`rootMainFiles` manifestu) | 129 471 | **126,44** |
| `/`: wszystkie zewnętrzne skrypty z HTML, bez `noModule` | 134 489 | **131,34** |
| `/ui-preview`: wszystkie zewnętrzne skrypty z HTML, bez `noModule` | 133 653 | **130,52** |
| Polyfille `noModule`, osobno (nowoczesne przeglądarki ich nie pobierają) | 39 520 | 38,59 |

`rootMainFiles` mierzy wspólny bootstrap z manifestu aktualnego buildu, nie całą stronę. `/` i `/ui-preview` są dziś technicznymi stronami M0, więc nie dowodzą rozmiaru docelowego pulpitu ani pełnej powłoki BL-121. Na `/` pozostaje 58,66 KiB do limitu 190 KiB. Next.js 16 nie wypisuje rozmiarów tras w wyniku `next build`, dlatego CI mierzy je własnym skryptem (§ 6.1).

**Biblioteki.** Zod i natywne UI zmierzono ponownie **2026-09-30**: esbuild 0.28.2, minifikacja, ESM, browser/es2022, gzip -9, React/React DOM jako zależności zewnętrzne. Trzy warianty Zod eksportują identyczne `strictObject({ symbol: string(), quantity: string() })`; UI eksportuje sześć nazwanych prymitywów przez publiczne wejście `@oliginvest/ui`. Pozostałe pozycje zachowują **historyczne pomiary z 2026-09-19**, nie były mierzone w BL-033.

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
| Zod: `import * as z` / `import { z }` / `zod/mini` | 4.6.5 | **24,19 / 90,48 / 4,35 KiB** (24 773 / 92 656 / 4 456 B) | tylko leniwe formularze; `{ z }` zakazany |
| Natywne `packages/ui`: Button, TextField, SelectField, Disclosure, ModalDialog, Popover | kod BL-012 | **2,16 KiB** (2 208 B) | HTML natywny; hydratacja dialogu/popovera w wyspie klienta |

**Radix nie jest używany ani zainstalowany w BL-012**, dlatego BL-033 mierzy faktyczne prymitywy natywne zamiast hipotetycznego importu Radix. Historyczne porównanie kandydatów pozostaje w [`architektura-ui.md`](architektura-ui.md) § 10. Pomiary powtarzamy po zmianie wersji głównej.

BL-016 wykrył, że formatery i18n importowały runtime `decimal.js` wyłącznie dla `isDecimal`; to podnosiło UI ponad 15 KiB. Import zastąpiono typem i sprawdzeniem znacznika instancji (tak jak obsługa klonów w `Decimal.isDecimal`), z zachowaniem walidacji tekstu i zakazu `number`. Bez zmian `packages/core`. Po korekcie `size-limit`: całe UI **4,25 KiB**, UI+i18n **5,61 KiB** (zaokrąglone; bundlowanie IIFE narzędzia, gzip -9 z korektą pustego projektu, inne wejście niż sześć prymitywów powyżej). Test buildu odrzuca kod arytmetyczny Decimal w przeglądarce.

## 3. Budżety per trasa (gzip)

**JS początkowy** = skrypty wskazane w HTML trasy (bez `noModule`). **Leniwe** = chunki doładowywane po hydratacji (dynamiczny import). **Razem** = wszystko pobrane do pełnej interaktywności typowego użycia ekranu.

| Trasa | JS początkowy | Leniwe (maks.) | Razem | Zakazane w chunkach początkowych |
|---|---|---|---|---|
| `/logowanie`, `/logowanie/2fa`, `/rejestracja`, `/konfiguracja-2fa`, `/akceptacja-regulaminu`, strony publiczne (`/regulamin`, `/prywatnosc`, `/zrodla-danych`) | ≤ 160 KB | — | ≤ 160 KB | TanStack Query, wykresy, Radix |
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
- `ETag` + `If-None-Match` i `Cache-Control: private, max-age=300` dla danych rynkowych (wykresy EOD, instrumenty); dane użytkownika z `no-store` (ASVS V14.3.2) — ich świeżość zapewniają pamięć zapytań i SSE.
- Prefetch linków Next.js ograniczony do nawigacji głównej (telefon: bez prefetchu tras ciężkich).

## 6. Egzekwowanie w CI

### 6.1 Raport JS per trasa

Implementacja M0 (BL-016): `pnpm budgets` uruchamia produkcyjny build przez `next start` i syntetyczny endpoint health z testów BL-011. Nie tworzy pozornej sesji MFA: logowanie i dane domenowe powstaną w M1. Konfiguracja obejmuje wszystkie wzorce z § 3; istniejące strony wykrywa manifest buildu, a niewdrożone wzorce raportuje jako **OCZEKUJE**, nie PASS. `/ui-preview` jest techniczną próbką BL-012 z limitem jak `/`. Każda nowa strona bez przypisanego budżetu przerywa kontrolę. Trasy dynamiczne wymagają wartości `PERF_FIXTURES` (JSON: nazwa parametru → syntetyczny identyfikator). `BASE_URL` pozwala sprawdzić już uruchomione środowisko, `LH_SESSION_COOKIE` przekazuje sesję testową bez zapisywania jej w raporcie. Przekierowania, błędy HTTP i brak skryptów są błędami pomiaru.

Jednostka tabel: **1 KB = 1024 bajty (KiB)**, zgodnie z pomiarami gzip -9. Sumujemy każdy zewnętrzny skrypt JS wskazany przez HTML tylko raz, bez `noModule`; nie doliczamy prefetch/preload ani danych RSC w skryptach inline. Pomiar nie dowodzi budżetu „Razem” ani rozmiarów leniwych po interakcjach — te wymagają scenariuszy ekranów M1. Limity te pozostają zapisane w konfiguracji. Globalnie obowiązuje również ścisłe `< 200 KB` z NFR-01.02.

Markery tekstowe: Lightweight Charts — `lightweight-charts` / `TradingView, Inc.`; uPlot — `u-over` / `u-under`; driver.js — `driver-popover` / `driver-active`; Radix — `data-radix-` / `radix-ui`; Query — `queryHash` wraz z `queryKey`; Zod — `ZodError` / `ZodObject` / `invalid_type` wraz z `unrecognized_keys`. Testy negatywne sprawdzają wykrywanie i progi. Po zmianie wersji bibliotek trzeba zweryfikować markery na zminifikowanym wyjściu; to kontrola regresji, nie pełna identyfikacja pochodzenia kodu.

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

W M0 `pnpm size` sprawdza istniejące wejścia `packages/ui` (15 KiB) oraz wspólny zestaw UI i i18n (30 KiB jako część przyszłej powłoki). React i Next są zewnętrzne; zależności formatowania są wliczone. Pełna powłoka z API/SSE/nawigacją zostanie dołączona w BL-121, a wejścia wykresów przy ich implementacji. Brak tych wejść nie jest wynikiem PASS ich przyszłych budżetów.

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

W M0 `pnpm lighthouse` wykonuje po trzy przebiegi istniejących tras z listy poniżej i raportuje mediany LCP/TBT/CLS; przekroczenia są raportem, bez blokowania CI. Błąd uruchomienia, przekierowanie, brak audytu lub niepoprawna wartość zawsze blokują kontrolę. `pnpm lighthouse:assert` włącza twarde progi i wymaga wszystkich czterech tras (brama M1). Równość progowi także oznacza przekroczenie, zgodnie ze ścisłymi nierównościami § 1. Przeglądarka pochodzi z instalacji Playwright albo `CHROME_PATH`; skrypt nie pobiera jej samodzielnie. Raporty Markdown trafiają do podsumowania GitHub Actions, bez cookies i surowych raportów zawierających nagłówki.

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

- `web-vitals` 6.2 ładowany dynamicznie po zdarzeniu `load` **wyłącznie przy zgodzie na diagnostykę** (FR-07.12; bez zgody żadnych pomiarów, więc próba RUM jest mniejsza, a głównym kryterium pozostaje laboratorium z § 6.3); `onLCP`, `onINP`, `onCLS`, `onFCP`, `onTTFB` → paczka wysyłana `navigator.sendBeacon` na `POST /api/v1/rum/web-vitals` (bez identyfikatora użytkownika; trasa jako wzorzec bez identyfikatorów).
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
