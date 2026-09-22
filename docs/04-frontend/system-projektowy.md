# System projektowy

**Cel:** zdefiniować tokeny (kolory, typografia, odstępy, ruch), reguły formatowania liczb i dat w pl-PL, zasady wizualizacji danych finansowych oraz katalog komponentów domenowych OligInvest — z kontrastami policzonymi według WCAG, tak aby interfejs był czytelny, spójny i dostępny w motywie jasnym, ciemnym i w palecie dla daltonistów.

Powiązane: [`architektura-ui.md`](architektura-ui.md), [`dostepnosc.md`](dostepnosc.md), [`mapa-ekranow.md`](mapa-ekranow.md), [ADR-009](../09-decyzje/ADR-009-wykresy.md), NFR-06.01–NFR-06.03, FR-07.08.

## 1. Zasady

1. **Liczby są treścią główną** — krój maszynowy z cyframi tabelarycznymi, wyrównanie do prawej w kolumnach, zawsze z walutą lub jednostką.
2. **Kolor nigdy nie jest jedynym nośnikiem znaczenia** — zysk i strata mają znak (`+`/`-`), ikonę ▲/▼ i tekst dla czytników ekranu (NFR-06.02).
3. **Dwie palety zysku i straty** — domyślna (zielony/czerwony) i dla daltonistów (niebieski/pomarańczowy), wybierana w preferencjach (`plPalette`, FR-07.08).
4. **Motyw ciemny jest domyślny** — jasny i systemowy pozostają do wyboru (§ 7; decyzja właściciela 2026-09-22).
5. **Struktura z linii, nie z pudełek** — sekcje i wiersze rozdziela linia włosowa. Własne tło i cień mają wyłącznie warstwy nad treścią (arkusze, okna, menu); treść leży bezpośrednio na tle strony.
6. **Gęsto, ale czytelnie** — wysoka gęstość informacji jest funkcją aplikacji analitycznej. Czytelność dają rytm pionowy, hierarchia typograficzna i wyrównanie kolumn, a nie odstępy między kartami.
7. **Tokeny, nie wartości** — kolory, odstępy i typografia wyłącznie przez zmienne CSS zdefiniowane w `@theme` Tailwind 4 (`packages/ui`); oba motywy przez te same tokeny.
8. **Fonty systemowe** — zero pobierania fontów (LCP, prywatność, brak CDN).

## 2. Kolory

Kontrasty policzone wzorem WCAG 2.x (luminancja względna) 2026-09-22 względem tła strony `bg` danego motywu. Wymagania: tekst ≥ 4,5:1 (1.4.3), elementy graficzne i granice kontrolek ≥ 3:1 (1.4.11).

### 2.1 Tokeny podstawowe

| Token | Ciemny (domyślny) | Kontrast | Jasny | Kontrast | Użycie |
|---|---|---|---|---|---|
| `--color-bg` | `#0B0D0F` | — | `#FAFAF7` | — | tło strony i całej treści |
| `--color-panel` | `#0F1215` | — | `#FFFFFF` | — | wyłącznie warstwy nad treścią: arkusze, okna, menu |
| `--color-ink` | `#E8EAED` | 16,15 | `#14171A` | 17,21 | tekst podstawowy i liczby |
| `--color-muted` | `#98A1AA` | 7,43 | `#5A6169` | 6,00 | etykiety, opisy, osie, wartości zerowe |
| `--color-hairline` | `#22272C` | — | `#E3E2DB` | — | linie sekcji i wierszy (dekoracyjne, bez progu) |
| `--color-border` | `#7C848D` | 5,14 | `#6F7883` | 4,28 | granice pól formularzy i kontrolek |
| `--color-accent` | `#2AA198` | 6,16 | `#0E6E6E` | 5,78 | elementy interaktywne, linia wartości portfela |
| `--color-focus` | `#5AA9FF` | 7,93 | `#0A5FB4` | 6,07 | obrys fokusu (2 px + odsunięcie 2 px) |
| `--color-warning` | `#E3B341` | 10,00 | `#8A5A00` | 5,67 | dane nieaktualne, ostrzeżenia metodologiczne |
| `--color-danger` | `#FF6B61` | 6,98 | `#C4302B` | 5,28 | błędy formularzy, akcje nieodwracalne |

Na `panel` kontrasty nie są niższe niż na `bg` (motyw ciemny: tekst 15,59, etykiety 7,17).

### 2.2 Zysk i strata

| Token | Ciemny | Kontrast | Jasny | Kontrast |
|---|---|---|---|---|
| `--color-gain` | `#3FB950` | 7,66 | `#1A7F37` | 4,86 |
| `--color-loss` | `#FF6B61` | 6,98 | `#C4302B` | 5,28 |
| `--color-gain` (daltoniści) | `#5AA9FF` | 7,93 | `#0A5FB4` | 6,07 |
| `--color-loss` (daltoniści) | `#F0913F` | 8,18 | `#A84B00` | 5,47 |
| `--color-flat` | = `--color-muted` | 7,43 | = `--color-muted` | 6,00 |

Paleta dla daltonistów przełącza się atrybutem `data-palette="colorblind"` na `<html>`; komponenty używają wyłącznie tokenów `gain`/`loss`/`flat`.

### 2.3 Kategorie (alokacja, porównania serii)

Paleta Okabe–Ito dobrana pod motyw ciemny, z ciemniejszymi wariantami dla motywu jasnego. Kolory kategorii są **elementem graficznym** (próg 3:1) — etykiety pisze się kolorem `ink` albo `muted`, nigdy kolorem serii.

| # | Ciemny (kontrast) | Jasny (kontrast) |
|---|---|---|
| 1 | `#56B4E9` (8,44) | `#0072B2` (4,96) |
| 2 | `#E69F00` (8,64) | `#D55E00` (3,70) |
| 3 | `#2AA198` (6,16) | `#0E6E6E` (5,78) |
| 4 | `#CC79A7` (6,36) | `#A34E86` (5,03) |
| 5 | `#F0E442` (14,72) | `#A66A00` (4,29) |
| 6 | `#D55E00` (5,03) | `#3A87B8` (3,76) |
| 7 | `#8FA3FF` (8,21) | `#8A7A00` (4,13) |
| 8 | `#98A1AA` (7,43) — „pozostałe” | `#5A6169` (6,00) — „pozostałe” |

Maks. 7 kategorii + „pozostałe”; segmenty wykresów rozdzielone 1 px tła; etykiety bezpośrednio przy segmentach; tabela alternatywna zawsze dostępna.

### 2.4 Kolory wykresów

| Wykres | Reguła |
|---|---|
| Świece | wzrost `gain`, spadek `loss` (wypełnienie i knot); wolumen w kolorze świecy z przezroczystością 40 % |
| Wartość portfela, krzywa kapitału | linia `accent`; wpłaty netto linią przerywaną `muted`; markery przepływów jako trójkąty z etykietą |
| Mikrowykres w wierszu (`<Sparkline/>`) | jedna linia 1,2 px w kolorze `gain`/`loss`/`flat` według zmiany w pokazywanym oknie; bez osi i bez wypełnienia |
| Obsunięcie („underwater”) | obszar `loss` z przezroczystością 30 % + linia `loss` |
| Wachlarz Monte Carlo i `<DistributionStrip/>` | jednobarwny (kategoria 1): pasmo 5–95 % przezroczystość 15 %, 25–75 % 30 %, mediana linią ciągłą `accent` — **nie** kolory zysku i straty (scenariusze nie są oceną) |
| Heatmapa | skala rozbieżna `loss` → `bg` → `gain`, 5 stopni na stronę, nasycenie wg `|zmiana|`, obcięcie na ±5 % (1D) i ±20 % (1M+); kolor tekstu kafelka dobierany automatycznie (≥ 4,5:1); etykieta zawsze ze znakiem i % |
| Benchmark | linia przerywana kategorii 2 |

Zasady ogólne: wykres słupkowy zawsze od zera; wykresy wartości bez zera na osi Y rysowane jako linia, nie obszar; podpisy osi i jednostki zawsze widoczne; źródło i czas danych pod wykresem (`<DataFreshness/>`); brak legendy, gdy wystarczają etykiety bezpośrednie; siatka to najwyżej 2–4 linie poziome w kolorze `hairline`.

## 3. Typografia

```css
/* packages/ui/src/tokens.css — fragment ilustracyjny */
@theme {
  --font-sans: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Helvetica Neue", Arial, sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  --font-serif: "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif;
  --text-2xs: 0.625rem; --text-xs: 0.75rem;  --text-sm: 0.875rem; --text-base: 1rem;
  --text-lg: 1.125rem;  --text-xl: 1.25rem;  --text-2xl: 1.5rem;  --text-3xl: 2.375rem;
  --color-bg: #0B0D0F;  --color-ink: #E8EAED; --color-accent: #2AA198;
}
:root[data-theme="light"] { --color-bg: #FAFAF7; --color-ink: #14171A; --color-accent: #0E6E6E; }
.num { font-family: var(--font-mono); font-variant-numeric: tabular-nums lining-nums; letter-spacing: -0.01em; }
.label { font-size: var(--text-2xs); letter-spacing: 0.09em; text-transform: uppercase; color: var(--color-muted); }
```

| Rola | Krój | Uwagi |
|---|---|---|
| Liczby, kwoty, kursy, daty w tabelach | `--font-mono`, klasa `.num` | cyfry tabelaryczne — kolumny nie rozjeżdżają się przy aktualizacji kursów |
| Nagłówki ekranów i sekcji tytułowych | `--font-serif`, waga 600 | jedyne miejsce dla szeryfu; buduje charakter bez pobierania fontu |
| Etykiety pól, kolumn i sekcji | `--font-sans`, klasa `.label` | 10 px wersaliki z rozstrzeleniem 0,09 em, kolor `muted` |
| Tekst interfejsu, opisy, disclaimery | `--font-sans` | 13–16 px, interlinia 1,5 |

- Wartość główna ekranu (wartość portfela, kurs instrumentu): `--text-3xl`, interlinia 1,05, waga 600.
- **Pola formularzy ≥ 16 px** (mniejsza czcionka powoduje automatyczne powiększanie strony przez Safari na iOS przy fokusie).
- Maks. szerokość tekstu ciągłego 70 znaków; rozmiary w `rem` (WCAG 1.4.4).
- Krój maszynowy jest systemowy, więc gdy wariant tabelaryczny nie jest dostępny, `font-variant-numeric` degraduje się bezpiecznie — wyrównanie zapewnia dodatkowo stała szerokość kolumny liczbowej.

## 4. Odstępy, siatka, kształty, ruch

| Kategoria | Wartości |
|---|---|
| Odstępy | skala 4 px: 4, 8, 12, 16, 20, 24, 32, 48 |
| Gęstość | wiersz tabeli 32 px (komputer) i 44 px (dotyk); sekcja 12–20 px odstępu wewnętrznego, rozdzielona linią `hairline` 1 px |
| Punkty łamania | 360 (min.), 640, 768, 1024 (nawigacja boczna), 1280, 1536 px |
| Promienie | 0 px sekcje i wiersze, 2 px pola formularzy, 4 px przyciski, 9999 px wyłącznie wskaźniki punktowe (kropka stanu) |
| Cienie | **brak w treści**; jeden poziom wyłącznie dla warstw nad treścią (arkusze, okna, menu) w obu motywach |
| Obramowania | linia włosowa 1 px `hairline` między sekcjami i wierszami; `border` tylko dla kontrolek |
| Warstwy (`z-index`) | treść 0, nawigacja 10, arkusze i okna 20, powiadomienia 30 |
| Cele dotykowe | ≥ 44 × 44 px na telefonie (wytyczne Apple), ≥ 24 × 24 px wszędzie (WCAG 2.2, 2.5.8) |
| Ruch | 120 ms (hover/focus), 200 ms (panele), 300 ms (arkusze); `prefers-reduced-motion: reduce` → brak animacji wykresów i przejść |
| Obszary bezpieczne | `env(safe-area-inset-*)` dla dolnej nawigacji i arkuszy (iPhone z wycięciem, tryb standalone) |

Ikony: kontur 1,6 px, rozmiar 18–20 px; nigdy jako dekoracja — tylko tam, gdzie zastępują słowo albo są jedyną treścią przycisku (wtedy `aria-label`).

## 5. Formatowanie liczb, walut i dat (pl-PL)

Wyłącznie `Intl` z `packages/i18n` (formatery tworzone raz i buforowane). Wyniki zweryfikowane w Node 25.1 (ICU 77.1) 2026-09-19:

| Przypadek | Wywołanie | Wynik |
|---|---|---|
| Kwota < 10 000 | `NumberFormat('pl-PL', {style:'currency', currency:'PLN'})` | `1234,56 zł` (bez separatora tysięcy — reguła CLDR dla pl) |
| Kwota ≥ 10 000 | jw. | `12 345,67 zł` (spacja niełamiąca U+00A0) |
| Zmiana ze znakiem | `signDisplay: 'exceptZero'` | `+280,45 zł`, `-280,45 zł` |
| Waluta obca | `currency: 'USD'` | `1234,50 USD` (kod ISO, nie `$`) |
| Procent | `style:'percent', minimumFractionDigits: 2` | `0,54%` (bez spacji) |
| Duże liczby w kafelkach | `notation:'compact', maximumFractionDigits: 1` | `1,5 mln` |
| Data | `DateTimeFormat('pl-PL', {dateStyle:'short'})` | `18.09.2026` |
| Data i czas | `dateStyle:'medium', timeStyle:'short', timeZone:'Europe/Warsaw'` | `18 wrz 2026, 15:42` |

| Wielkość | Precyzja wyświetlania |
|---|---|
| Kwoty w PLN i walutach | 2 miejsca |
| Kursy akcji | precyzja notowania (GPW zwykle 2, groszówki do 4) — z danych instrumentu |
| Ilości | do 4 miejsc, bez zer końcowych (ułamkowe akcje XTB) |
| Stopy zwrotu, zmiany | 2 miejsca (heatmapa: 1) |
| Sharpe, Sortino, beta | 2 miejsca |
| Kursy walut | 4 miejsca (tabela NBP ma 4) |

Czas: znaczniki pokazywane w strefie użytkownika z etykietą źródła i opóźnienia („15:42 · opóźnione 15 min · Yahoo”); dane EOD jako data sesji („zamknięcie 18.09.2026”). Czas względny (`Intl.RelativeTimeFormat`, „5 min temu”) tylko jako uzupełnienie dokładnego czasu.

## 6. Komponenty domenowe (`packages/ui`)

| Komponent | Odpowiedzialność | Dostępność | Obowiązkowy na |
|---|---|---|---|
| `<MoneyValue/>` | formatuje `Money`; wariant pełny i kompaktowy | pełna wartość w `title`/opisie przy formie kompaktowej | wszystkie kwoty |
| `<ChangeValue/>` | zmiana kwotowa lub procentowa: znak, ▲/▼, kolor `gain`/`loss`/`flat` | ikona `aria-hidden`, tekst dla czytnika „wzrost o …” / „spadek o …” | wszystkie zmiany i P/L |
| `<DataFreshness/>` | źródło, czas, opóźnienie, flaga `stale` z przyczyną (`DataMeta`) | tekst, nie tylko ikona; `role="status"` przy zmianie na nieaktualne | każdy widok danych rynkowych i wyceny (FR-01.15) |
| `<AssumptionsBlock/>` | założenia analizy (dane, okno, model, koszty, podatki, ziarno) | rozwijane `<details>`, domyślnie otwarte przy pierwszym wyświetleniu | wyniki analiz FR-04 (NFR-07.02) |
| `<Disclaimer/>` | treść z [`../11-zgodnosc-prawna.md`](../11-zgodnosc-prawna.md) § 4.3 wg klucza i wersji | zwykły tekst, nie obrazek | analizy, screener, alerty, eksporty (NFR-07.01) |
| `<Explainer/>` | „?” przy metryce: definicja, jak czytać, pułapki, link do glosariusza | przycisk z nazwą dostępną „Co oznacza …”, treść w `popover` | każda metryka i wskaźnik (FR-06.02) |
| `<ChartFrame/>` | tytuł, opis, przełącznik „tabela”, `<DataFreshness/>`, leniwe ładowanie biblioteki | opis tekstowy trendu, tabela alternatywna | każdy wykres (NFR-06.01) |
| `<StatTile/>` | kafelek KPI: etykieta, wartość, zmiana, stan ładowania | etykieta powiązana z wartością | dashboard, podsumowania |
| `<DataTable/>` | tabela HTML z serwera; sortowanie i wirtualizacja doładowywane leniwie | `<th scope>`, `aria-sort` | pozycje, operacje, screener |
| `<StepUpDialog/>` | kod TOTP dla działań wrażliwych i ponowienie żądania | fokus w polu kodu, `autocomplete="one-time-code"` | tokeny PAT, eksport, admin |
| `<StaleBanner/>`, `<OfflineBanner/>` | stan danych i sieci dla całego ekranu | `role="status"` | powłoka aplikacji |
| `<Sparkline/>` | mikrowykres okna 30 sesji w wierszu pozycji; kolor `gain`/`loss`/`flat` według zmiany w tym oknie | `aria-hidden` — wartość i zmiana są w tekście wiersza | lista pozycji, watchlisty |
| `<DistributionStrip/>` | pasek rozkładu wyniku analizy: zakres 5–95 %, wewnątrz 25–75 %, kreska mediany, podpisy wartości brzegowych | tekst „od … do …, mediana …” oraz tabela percentyli obok | podsumowania analiz FR-04 |
| `<EmptyState/>`, `<Skeleton/>` | brak danych z następnym krokiem; szkielet o wymiarach docelowych | szkielet `aria-hidden`, `aria-busy` na kontenerze | wszystkie listy i sekcje |

Ikony: `lucide-react` (ISC), import pojedynczych ikon; ikony obok tekstu są dekoracyjne (`aria-hidden`), ikony samodzielne mają nazwę dostępną.

## 7. Motywy

- **`dark` domyślnie** (decyzja właściciela 2026-09-22); do wyboru `light` i `system` (FR-07.08). Serwer renderuje `data-theme` i `data-palette` na `<html>` na podstawie preferencji — bez skryptu inline, więc bez migania motywu i bez wyjątku w CSP. Dla `system` rozstrzyga media query `prefers-color-scheme`.
- Ekrany przed zalogowaniem i strony publiczne (regulamin, informacja o danych, źródła danych) renderują się w motywie ciemnym.
- `color-scheme: dark light` (natywne kontrolki i paski przewijania w odpowiednim motywie); `<meta name="theme-color">` z tokenu `bg` dla obu schematów (pasek statusu PWA).

## 8. Weryfikacja

- **Test kontrastu tokenów w CI:** skrypt czyta tokeny z `packages/ui` i sprawdza progi z § 2 (tekst 4,5:1, grafika i granice 3:1) dla obu motywów i obu palet; spadek poniżej progu = czerwony build.
- **Test wizualny:** zrzuty kluczowych ekranów w motywie ciemnym (domyślnym), jasnym i z paletą dla daltonistów.
- **Test fontów w CI:** w `packages/ui` i `apps/web` nie ma reguł `@font-face` ani odwołań do zewnętrznych hostów fontów (zasada 8 z § 1).
- **Przegląd ręczny** raz na etap: symulacja deuteranopii i protanopii w narzędziach deweloperskich Chrome (Rendering → Emulate vision deficiencies).
