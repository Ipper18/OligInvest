# Lighthouse LCP `/portfel` — diagnoza skoków 1355/1805/2005 ms i poprawka

**Cel:** wyjaśnić, dlaczego PR #56 (backend BL-215) mierzył w CI LCP `/portfel` ok. 2000 ms przy ok. 1355 ms na `main`, i opisać poprawkę przyczyny wraz z dowodami lokalnymi — bez zmiany progów, profilu, dławienia i bez ponowień.

**2026-11-06**, gałąź `fix/lighthouse-lcp-portfel` od `origin/main` (`34e355c`), worktree Claude Code. Wymaganie: NFR-01.01 (LCP < 2,0 s, laboratorium: Lighthouse, profil mobilny, mediana z 3). Bez ID backlogu — poprawka bramki `web`.

## 1. Wnioski w skrócie

1. **PR #56 nie jest przyczyną.** Ta sama skwantowana rozbieżność występuje na czystym `main` i na `/` (Start). Lokalnie `main` dawał na `/portfel` 1352/1803/1991/2131 ms, PR #56 — 1352/1353/1803/2132 ms (§ 3). W lokalnym buildzie PR #56 zmienia w `apps/web` wyłącznie nazwy (hashe) chunków: 13 chunków pierwszego wczytania `/portfel` ma tę samą kolejność i te same rozmiary co na `main` (558 558 B nieskompresowane, `route-bundle-stats.json`), a multizbiór rozmiarów wszystkich 47 chunków jest identyczny. Różnica +0,01 KiB z CI dotyczy podtras `/portfel/*`.
2. **Mechanizm:** Lighthouse `simulate` (Lantern) buduje graf LCP z obserwowanego, nieprzydławionego śladu. Do grafu trafia każde żądanie zakończone przed obserwowanym LCP i każdy skrypt wykonany przed nim (`getFirstPaintBasedGraph`: optymistyczny i pesymistyczny graf LCP traktują wszystkie żądania nie-obrazowe jako blokujące). Na serwerze lokalnym chunki z `<head>` docierają po 10–30 ms, czyli w tym samym oknie co pierwsza klatka. Treść `/portfel` jest strumieniowana w granicy `Suspense` z `(app)/loading.tsx`, a React 19.2 odsłania ją (`$RC` → `$RV`) w pierwszym `requestAnimationFrame` — FCP = LCP = pierwsza klatka. Wynik zależy więc od tego, co zdążyło się pobrać i wykonać przed prezentacją tej klatki (faza vsync, 10–33 ms po `Commit`).
3. **Tryby (kwanty) wyniku** — każdy to inny zestaw węzłów w grafie (§ 4):
   - **≈ 1352 ms** — dokument + 11 chunków z `<head>` bez chunku frameworka (`react-dom`, 72 KB); jego ewaluacja (> 10 ms, osobny węzeł CPU) zaczęła się po LCP, więc Lantern go wyklucza;
   - **≈ 1503/1652/1803 ms** — dodatkowo chunk frameworka (+300 ms transferu przy 1,6 Mb/s) i kolejne chunki na tym samym połączeniu HTTP/2 (+150 ms każdy);
   - **≥ 2000 ms (2005/2057/2131 ms)** — pierwsza klatka dopiero **po** starcie hydratacji; do grafu wchodzi wtedy praca, którą powłoka uruchamia w efekcie hydratacji: dynamiczny import `@oliginvest/contracts/browser` (Zod + schematy realtime, 62 KB / 18 KB gzip, +300 ms), `GET /api/v1/stream`, `PUT …/instruments` i trzy akcje serwera `POST /portfel` (odświeżenie pozycji/gotówki/dnia po ramce `ready` z `resumed: false`).
4. **Przyczyna do poprawy w produkcie:** w trybie ≥ 2000 ms LCP przekracza próg wyłącznie przez pracę powłoki niepotrzebną do pierwszego widoku. Dane z SSR są świeże (`staleTime` 30 s), a natychmiastowe odświeżenie po `ready` dubluje właśnie pobrane zapytania.

## 2. Poprawka

- `apps/web/src/shell/after-first-paint.ts`: `afterFirstPaint(run)` uruchamia pracę po wpisie `first-contentful-paint` z `PerformanceObserver` (`buffered: true` — także gdy FCP nastąpił przed hydratacją). Bez Paint Timing — od razu (dotychczasowe zachowanie); karta, która nie rysuje (tło) — po 3 s; anulowanie przy odmontowaniu/wylogowaniu. Od § 8 także czekanie na zniknięcie szkieletu trasy po FCP.
- `apps/web/src/shell/providers.tsx`: import schematów realtime i `connectStream` (a w konsekwencji `ready` → odświeżenie zapytań i `PUT …/instruments`) czekają na `afterFirstPaint`. Logika ramek, wylogowania i pollingu bez zmian.
- Wpis FCP jest dostarczany po zaprezentowaniu klatki, więc każde żądanie z tej bramki zaczyna się po obserwowanym LCP i nie wchodzi do grafu Lantern (dla `/portfel` FCP = LCP). Dla użytkownika: żądania te nie konkurują o łącze z chunkami pierwszego widoku; aktualizacje na żywo startują po pierwszym wyświetleniu zamiast w trakcie hydratacji.
- Dokumentacja: `wydajnosc.md` § 5 (zasada) i § 6.3 (wrażliwość Lantern), `realtime.md` § 6 pkt 1 (moment startu strumienia), `ryzyka.md` **R-53**.

Odrzucone warianty (z pomiarem):

- **Usunięcie `(app)/loading.tsx`** (treść bez `Suspense`, odpowiedź po danych): gorzej — 1802 ms w 6 z 8 przebiegów, 2154 ms raz. Cały dokument przychodzi naraz, parser odkrywa chunki później względem treści, a pierwsza klatka przegrywa wyścig częściej.
- **Odroczenie do zdarzenia `load`:** niewystarczające — w trybie ≥ 2000 ms `load` (98–124 ms) wypada przed obserwowanym LCP (160–189 ms).
- **Zmiana progów, profilu, dławienia, liczby przebiegów lub ponowienia:** zakazane przez właściciela; nie stosowane.

Poza zakresem (zmierzone, bez wpływu na graf): `PwaRegistration` po `load` (≈ 1 KB), leniwy `metric-headings` (0,4 KB), chunk granicy błędu Next (0,9 KB), prefetch `Link` do `/portfel/operacje/nowa` (startuje po LCP).

## 3. Pomiary rozkładu (skrypt diagnostyczny, `/portfel`, pojedyncze przebiegi)

Ten sam profil co `lighthouse-assert.mjs` (mobilny, `simulate`, ta sama przeglądarka i serwer TLS/HTTP2), ale każdy przebieg osobno, z zapisem śladu. Windows 11, Chromium z Playwright, 2026-11-06. W tych seriach pierwszy przebieg w świeżej przeglądarce był najwolniejszy (przypuszczalnie zimne cache przeglądarki — **NIEZWERYFIKOWANE**).

| Wariant | Przebiegi LCP (ms) | Maks. |
|---|---|---:|
| `main` (seria 1) | 1991, 1353, 1353, 1803, 1803 | 1991 |
| `main` (seria 2, ze śladami) | 2131, 1352, 1803, 1352, 1803, 1802 | 2131 |
| `main`, trasa `/` | 1981, 1652, 1352, 1652, 1652, 1352 | 1981 |
| PR #56 (`b1fb1d7`) | 2132, 1353, 1352, 1803, 1353 | 2132 |
| `main` bez `(app)/loading.tsx` (odrzucone) | 2154, 1802, 1802, 1802, 1802, 1802, 1352, 1803 | 2154 |
| **poprawka** | **1806**, 1352, 1352, 1802, 1802, 1802, 1352, 1352, 1352, 1802 | **1806** |

## 4. Graf Lantern — porównanie przebiegów (`main`)

Odtworzone z zapisanego śladu i `devtoolsLog` przez `LanternLargestContentfulPaint` z Lighthouse 13.5 (wynik identyczny z audytem).

| Przebieg | Obs. LCP | Węzły grafu ponad FCP (≈ 970 ms) | LCP |
|---|---:|---|---:|
| szybki | 58 ms | 11 chunków `<head>` (ścieżka krytyczna: 36 KB + 18 KB) | 1352 |
| średni | 69 ms | + `react-dom` 72 KB i jego ewaluacja (zaczęła się 10 ms przed prezentacją klatki) | 1803 |
| wolny | 189 ms | + Zod/contracts 18 KB, `/api/v1/stream`, `PUT …/instruments`, 3 × `POST /portfel` (akcje serwera), leniwe chunki hydratacji | 2131 |
| poprawka, wolny | 160 ms | jak „średni”; Zod/contracts (178 ms), strumień (189 ms) i akcje (201–220 ms) po LCP | 1806 |

## 5. Weryfikacja `lighthouse-assert.mjs --assert`

Pełne `pnpm --filter @oliginvest/web exec node scripts/lighthouse-assert.mjs --assert` (Lighthouse 13.5, mobilny, `simulate`, mediana z 3), 5 rund naprzemiennie (round-robin) na 4 drzewach, każde ze świeżym buildem produkcyjnym. Windows 11, Chromium z Playwright, 2026-11-06. Wartości: mediana LCP w ms z każdej rundy (zaokrąglona).

| Wariant (commit) | `/logowanie` | `/` | `/portfel` | `/rynek/[id]` | Wynik |
|---|---|---|---|---|---|
| `main` (`34e355c`) | 1733, 1734, 1733, 1734, 1742 | 1652, 1652, 1653, 1652, 1653 | 1352, 1353, 1802, 1353, 1353 | 1802, 1802, 1802, 1352, 1502 | 5 × PASS |
| PR #56 (`b1fb1d7`) | 1735, 1735, 1732, 1731, 1737 | 1652, 1652, 1652, 1652, 1653 | 1802, 1803, 1353, 1352, 1353 | 1502, 1802, 1802, 1802, 1803 | 5 × PASS |
| **poprawka** (`70f96f8`) | 1653, 1734, 1737, 1732, 1354 | 1352, 1652, 1353, 1352, 1653 | 1802, 1352, 1803, 1803, 1353 | 1802, 1802, 1802, 1352, 1803 | 5 × PASS |
| **poprawka + PR #56** (scalenie `f6be352`) | 1738, 1731, 1734, 1736, 1745 | 1352, 1652, 1652, 1353, 1652 | 1802, 1802, 1802, 1353, 1353 | 1802, 1802, 1352, 1803, 1353 | 5 × PASS |

TBT ≤ 35 ms i CLS 0 we wszystkich 240 wierszach asercji (20 uruchomień × 4 trasy × 3 audyty) — wszystkie PASS.

Interpretacja (uczciwie):

- **Lokalnie mediana z 3 nie odtwarza porażki z CI** — także bez poprawki (`main`, PR #56). Tryb ≥ 2000 ms trafia się lokalnie w ok. 1 na 5–6 pojedynczych przebiegów (głównie pierwszy w świeżej przeglądarce, § 3), więc mediana z 3 rzadko go łapie. Runner CI jest wolniejszy (TBT 106–131 ms wobec 33–46 ms lokalnie, przebieg PR #56 `42290440173`), więc pierwsza klatka częściej przegrywa ze startem hydratacji — stąd 2005/2057/2067/2131 ms w CI.
- Mediany 1352 ↔ 1802 ms na `/portfel` i `/rynek` to wyścig chunku frameworka (§ 1 pkt 3). Poprawka go nie dotyczy i nie zmienia ich rozkładu — zmienia wyłącznie ogon ≥ 2000 ms.
- Dowodem skuteczności poprawki jest więc § 3–4 (pojedyncze przebiegi z odtworzonym grafem Lantern: maks. 2131 → 1806 ms; w wolnym przebiegu po poprawce praca powłoki leży po LCP), a ta seria potwierdza brak regresji na wszystkich czterech trasach, także po scaleniu z PR #56.
- Ostateczne potwierdzenie daje CI tego PR i ponowny przebieg PR #56 po scaleniu `main` z poprawką.

## 6. Pozostałe kontrole

Kroki zadania `web` z `.github/workflows/web.yml` (bez Lighthouse, wykonanego w § 5), lokalnie na `70f96f8`:

| Kontrola | Wynik |
|---|---|
| `pnpm check:ui-text` | PASS |
| `pnpm --filter @oliginvest/web test:boundary` | PASS |
| `pnpm turbo run lint typecheck test build --filter=@oliginvest/web --filter=@oliginvest/ui --filter=@oliginvest/i18n` | PASS (web: 20 plików, 57 testów, w tym 5 nowych `after-first-paint.test.mjs`) |
| `pnpm --filter @oliginvest/web test:performance` | PASS |
| `pnpm size`, `pnpm budgets` | PASS (`/portfel` 167,61 / 195 KiB — bez zmian względem `main`, poprawka nie dodaje kodu do pierwszego wczytania poza kilkuset bajtami) |
| Playwright `chromium`, `chromium-shell` | 58 passed, 1 skipped — m.in. „connection status and the pause/resume button agree” (strumień SSE łączy się po FCP) |
| Playwright `webkit-shell`, `firefox-shell` | 50 passed, 2 skipped |
| `git grep` sekretów z `CLAUDE.md` | brak nowych trafień (4 istniejące, syntetyczne wartości w testach — poza zmianą) |

## 7. Pytanie do właściciela, odchylenia, ryzyka

- **Margines:** po poprawce najgorszy zaobserwowany tryb to ≈ 1806 ms (z chunkiem frameworka). Zostaje ok. 190 ms zapasu; każdy nowy chunk początkowy ≥ 18 KB gzip albo nowa praca przed FCP może go zjeść (R-53). Liczby przebiegów nie zwiększałem. **Pytanie otwarte:** czy przy kolejnym skoku rozważyć medianę z 5 przebiegów (wymaga ADR/zmiany `wydajnosc.md` § 1 i § 6.3)? Uzasadnienie za: rozkład jest wielomodalny, mediana z 3 jest wrażliwa na jeden wolny przebieg. Przeciw: dłuższe CI (+2 przebiegi × 4 trasy) i ryzyko maskowania regresji.
- Bez zmian progów, profilu, dławienia i ponowień. Bez nowych zależności i bez zmian kontraktów API.
- Konflikt przy scaleniu z PR #56: oba PR zmieniają wiersz podsumowania w `ryzyka.md` (licznik ryzyk); numer R-53 zostawia R-52 dla PR #56.
- Skrypty diagnostyczne (pomiar pojedynczych przebiegów ze śladem, odtworzenie grafu Lantern) pozostały poza repozytorium — jednorazowe.

## 8. Regresja e2e po pierwszej wersji poprawki (2026-11-07)

CI PR #59 (`e2e` przebieg `42294791069`, `images` przebieg `42294791166`) — po jednej porażce w `apps/web/e2e/redesign.spec.ts`; `main` w 10 ostatnich przebiegach `e2e` zielony. Oba przypadki to wyścigi, które odroczony start strumienia uwidocznił; lokalnie (szybsza maszyna) 110/110 przebiegów przeszło, więc przyczynę ustaliłem ze śladów Playwright z CI i odtworzyłem deterministycznie (tymczasowy spec, nie w repozytorium).

1. **webkit, `:294` (offline Start):** ślad pokazuje `PUT /api/v1/stream/connections/{id}/instruments` wysłane po ramce `ready`, przerwane przez `context.setOffline(true)`. `catch` w `providers.tsx` ustawiał wtedy `"polling"` („Aktualizacje co minutę”), nadpisując `"offline"` z transportu. Poprawka: przy przerwanym żądaniu stan zależy od `navigator.onLine` — tak samo jak w `sse/transport.ts`. Odtworzenie (żądanie wstrzymane przez `page.route` do chwili po przejściu offline): stary `catch` — 2/2 FAIL z „Aktualizacje co minutę”; nowy — 6/6 PASS (chromium, webkit, firefox).
2. **firefox, `:215` (Start empty):** React 19.2 (`$RT` w skrypcie powłoki, `$RC`) odsłania strumieniowaną treść **najwcześniej 300 ms po pierwszej klatce**. Pierwsza wersja poprawki startowała strumień po FCP, a FCP to tu malowanie szkieletu `loading.tsx`; strumień zdążał przejść w „na żywo” przed odsłonięciem treści, więc test widział naraz szkielet `div.oi-kpis[aria-hidden]` i jeszcze ukryty `dl.oi-kpis` (w `div[hidden]` segmentu). Szkielet nie zostaje w DOM po odsłonięciu — treść nie była jeszcze odsłonięta. Poprawka: `afterFirstPaint` czeka po FCP także na zniknięcie szkieletu trasy (`[data-loading-fallback]` w `Skeleton`, `MutationObserver`), z dotychczasowym limitem 3 s. Odtworzenie (rozgrzany cache JS, dławiony tylko dokument, chromium): tylko FCP — strumień 913–978 ms vs odsłonięcie 1083–1153 ms (3/3 FAIL); FCP + szkielet — strumień 4–10 ms po odsłonięciu (6/6 PASS na `/` i `/portfel`).

Dla Lighthouse bez zmian: gdy treść przychodzi przed pierwszą klatką (FCP = LCP), szkieletu już nie ma i start następuje zaraz po FCP. Dla użytkownika na wolnym łączu lepiej: SSE, Zod i odświeżenia nie konkurują z odsłonięciem treści. Testy e2e i ich asercje bez zmian; bez ponowień i dłuższych limitów czasu.

Weryfikacja po poprawce regresji (lokalnie, Windows 11, 2026-11-07):

| Kontrola | Wynik |
|---|---|
| `redesign.spec.ts`, chromium + firefox + webkit, `--repeat-each=5` | 165/165 passed (po 55 na silnik), bez flaky |
| `lighthouse-assert.mjs --assert` × 2 | PASS; `/portfel` 1352,6 i 1353,5 ms; `/` 1352,4 i 1503,1 ms; `/logowanie` 1731,4 i 1740,6 ms; `/rynek/[id]` 1502,5 i 1802,8 ms; TBT ≤ 55 ms, CLS 0 |
| `check:ui-text`, `test:boundary`, lint/typecheck/test/build (web, ui, i18n), `test:performance`, `size`, `budgets`, `check:docs`, `check:repository` | PASS (web 60 testów, w tym 8 `after-first-paint`; ui 13) |
| `git grep` sekretów z `CLAUDE.md` | brak nowych trafień |
