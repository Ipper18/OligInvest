# System projektowy

**Cel:** zdefiniować tokeny (kolory, typografia, odstępy, ruch), reguły formatowania liczb i dat w pl-PL, zasady wizualizacji danych finansowych oraz katalog komponentów domenowych OligInvest — z kontrastami policzonymi według WCAG, tak aby interfejs był czytelny, spójny i dostępny w motywie jasnym, ciemnym i w palecie dla daltonistów.

Powiązane: [`architektura-ui.md`](architektura-ui.md), [`dostepnosc.md`](dostepnosc.md), [`mapa-ekranow.md`](mapa-ekranow.md), [ADR-009](../09-decyzje/ADR-009-wykresy.md), [ADR-017](../09-decyzje/ADR-017-jezyk-wizualny-panele.md), NFR-06.01–NFR-06.03, FR-07.08.

**Od 2026-10-29 obowiązuje język wizualny „panele monochromatyczne” (kierunek B, [ADR-017](../09-decyzje/ADR-017-jezyk-wizualny-panele.md)).** Projekt referencyjny: [`projekt-b/`](projekt-b/b-tokens.css). Zawiera tokeny `b-tokens.css`, CSS komponentów `b.css` i statyczne artboardy: Start, Pozycje i karta instrumentu na telefon i komputer, stany Startu, motyw jasny, paletę dla daltonistów oraz arkusz kontrastów. Prefiks `--b-` w plikach referencyjnych odpowiada tokenom `--color-*` w `packages/ui`. Zasady § 1, 3, 4 i 6 opisują stan docelowy; tabele § 2.1–2.2 opisują jeszcze kod, a tokeny docelowe są w § 2.5. Implementacja: BL-413.

## 1. Zasady

1. **Liczby są treścią główną** — krój maszynowy z cyframi tabelarycznymi, wyrównanie do prawej w kolumnach, zawsze z walutą lub jednostką.
2. **Kolor nigdy nie jest jedynym nośnikiem znaczenia** — zysk i strata mają znak (`+`/`-`), ikonę ▲/▼ i tekst dla czytników ekranu (NFR-06.02).
3. **Dwie palety zysku i straty** — domyślna (zielony/czerwony) i dla daltonistów (niebieski/pomarańczowy), wybierana w preferencjach (`plPalette`, FR-07.08).
4. **Motyw ciemny jest domyślny** — jasny i systemowy pozostają do wyboru (§ 7; decyzja właściciela 2026-09-22).
5. **Karty grupują znaczenie** — treść leży na kartach `panel` z ramką 1 px `line` i promieniem 12 px; wiersze wewnątrz karty rozdziela linia `line`. Cień ma wyłącznie przycisk „+” i warstwy nad treścią (arkusze, okna, menu). Do 2026-10-28 obowiązywała zasada „struktura z linii, nie z pudełek” (ADR-017).
6. **Kolor tylko w danych** — akcent jest monochromatyczny: przycisk główny, aktywne przełączniki i linia wartości portfela mają kolor tekstu (`primary`, `series`). Kolor niosą wyłącznie dane: zysk i strata, kategorie, ostrzeżenia. Przycisk nigdy nie wygląda jak zysk w żadnej palecie.
7. **Gęsto, ale czytelnie** — wysoka gęstość informacji jest funkcją aplikacji analitycznej. Karty grupują, a w ich wnętrzu czytelność dają rytm pionowy, hierarchia typograficzna i wyrównanie kolumn.
8. **Tokeny, nie wartości** — kolory, odstępy i typografia wyłącznie przez zmienne CSS zdefiniowane w `@theme` Tailwind 4 (`packages/ui`); oba motywy przez te same tokeny.
9. **Fonty systemowe** — zero pobierania fontów (LCP, prywatność, brak CDN).

## 2. Kolory

Kontrasty policzone wzorem WCAG 2.x (luminancja względna) 2026-09-22 względem tła strony `bg` danego motywu. Wymagania: tekst ≥ 4,5:1 (1.4.3), elementy graficzne i granice kontrolek ≥ 3:1 (1.4.11).

### 2.1 Tokeny podstawowe

Tabele § 2.1–2.2 opisują tokeny zaimplementowane w `packages/ui/src/tokens.css` (test `packages/ui/test/tokens.test.mjs` porównuje je z kodem). Docelowe tokeny kierunku B są w § 2.5; BL-413 przenosi je do tych tabel razem ze zmianą kodu.

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

Paleta Okabe–Ito dobrana pod motyw ciemny, z ciemniejszymi wariantami dla motywu jasnego. Kolory kategorii są **elementem graficznym** (próg 3:1, liczony względem `panel`, na którym leżą wykresy) — etykiety pisze się kolorem `ink` albo `muted`, nigdy kolorem serii. Względem `panel` (2026-10-29) najniższe: ciemny 4,52 (kat. 6), jasny 3,87 (kat. 2).

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
| Wartość portfela, krzywa kapitału | linia `series` (kolor tekstu, 2 px); wpłaty netto linią przerywaną `muted`; markery przepływów jako trójkąty z etykietą |
| Mikrowykres w wierszu (`<Sparkline/>`) | jedna linia 1,2 px w kolorze `gain`/`loss`/`flat` według zmiany w pokazywanym oknie; bez osi i bez wypełnienia |
| Obsunięcie („underwater”) | obszar `loss` z przezroczystością 30 % + linia `loss` |
| Wachlarz Monte Carlo i `<DistributionStrip/>` | jednobarwny (kategoria 1): pasmo 5–95 % przezroczystość 15 %, 25–75 % 30 %, mediana linią ciągłą `series` — **nie** kolory zysku i straty (scenariusze nie są oceną) |
| Heatmapa | skala rozbieżna `loss` → `bg` → `gain`, 5 stopni na stronę, nasycenie wg `|zmiana|`, obcięcie na ±5 % (1D) i ±20 % (1M+); kolor tekstu kafelka dobierany automatycznie (≥ 4,5:1); etykieta zawsze ze znakiem i % |
| Benchmark | linia przerywana kategorii 2 |

Zasady ogólne: wykres słupkowy zawsze od zera; wykresy wartości bez zera na osi Y rysowane jako linia, nie obszar; podpisy osi i jednostki zawsze widoczne; źródło i czas danych pod wykresem (`<DataFreshness/>`); brak legendy, gdy wystarczają etykiety bezpośrednie; siatka to najwyżej 2–4 linie poziome w kolorze `line`.

### 2.5 Tokeny docelowe kierunku B (BL-413)

Nazwy bez prefiksu odpowiadają zmiennym `--color-*` w `packages/ui` i `--b-*` w [`projekt-b/b-tokens.css`](projekt-b/b-tokens.css). Do czasu BL-413 obowiązują w nowych projektach ekranów, nie w kodzie.

#### Tokeny podstawowe

Kontrast liczony względem `bg` i (po ukośniku) względem `panel` danego motywu (2026-10-29, [ADR-017](../09-decyzje/ADR-017-jezyk-wizualny-panele.md) § Weryfikacja). Tokeny tła nie mają progu.

| Token | Ciemny (domyślny) | Kontrast | Jasny | Kontrast | Użycie |
|---|---|---|---|---|---|
| `bg` | `#0B0D0F` | — | `#F1F0EB` | — | tło strony |
| `panel` | `#161A1F` | — | `#FFFFFF` | — | karty z treścią, dolny pasek, panel boczny, arkusze |
| `panel-2` | `#1F252B` | — | `#F5F4EF` | — | tło wewnątrz karty: nagłówek tabeli, przełączniki, pole wyszukiwania, szkielet |
| `line` | `#262D34` | — | `#E2E1DA` | — | ramka kart i linie wierszy (dekoracyjne, bez progu) |
| `ink` | `#E8EAED` | 16,15 / 14,50 | `#14171A` | 15,77 / 17,99 | tekst podstawowy i liczby |
| `muted` | `#98A1AA` | 7,43 / 6,67 | `#5A6169` | 5,50 / 6,27 | etykiety, opisy, osie, wartości zerowe, „—” |
| `border` | `#7C848D` | 5,14 / 4,61 | `#6F7883` | 3,92 / 4,48 | granice pól formularzy i kontrolek (próg 3:1) |
| `primary` | `#E8EAED` | 16,15 / 14,50 | `#14171A` | 15,77 / 17,99 | przycisk główny, aktywny przełącznik, przycisk „+” |
| `on-primary` | `#0B0D0F` | 16,15 na `primary` | `#FFFFFF` | 17,99 na `primary` | tekst i ikona na `primary` |
| `series` | = `ink` | 16,15 / 14,50 | = `ink` | 15,77 / 17,99 | linia wartości portfela i krzywej kapitału |
| `focus` | `#5AA9FF` | 7,93 / 7,12 | `#0A5FB4` | 5,56 / 6,35 | obrys fokusu (2 px + odsunięcie 2 px) |
| `warning` | `#E3B341` | 10,00 / 8,98 | `#8A5A00` | 5,19 / 5,93 | dane nieaktualne, ostrzeżenia metodologiczne |
| `warning-bg` | `#2B2413` | `warning` 7,91 | `#FBF1DC` | `warning` 5,28 | tło plakietki „nieaktualne” i banera danych |
| `danger` | `#FF6B61` | 6,98 / 6,26 | `#C4302B` | 4,84 / 5,52 | błędy formularzy, akcje nieodwracalne |

Na `panel-2` najniższy kontrast tekstu wynosi 5,54:1 (`danger`, ciemny). Token `accent` (`#2AA198`/`#0E6E6E`) nie jest już używany w interfejsie; wartość zostaje jako kategoria 3 (§ 2.3).

#### Zysk i strata

| Token | Ciemny | Kontrast `bg` / `panel` / tło plakietki | Jasny | Kontrast `bg` / `panel` / tło plakietki |
|---|---|---|---|---|
| `gain` | `#3FB950` | 7,66 / 6,88 / 6,27 | `#18783A` | 4,86 / 5,55 / 4,89 |
| `loss` | `#FF6B61` | 6,98 / 6,26 / 6,07 | `#C4302B` | 4,84 / 5,52 / 4,78 |
| `gain-bg` | `#12261A` | — | `#E7F4EA` | — |
| `loss-bg` | `#2C1715` | — | `#FCEBE9` | — |
| `gain` (daltoniści) | `#5AA9FF` | 7,93 / 7,12 / 6,55 | `#0A5FB4` | 5,56 / 6,35 / 5,43 |
| `loss` (daltoniści) | `#F0913F` | 8,18 / 7,35 / 6,77 | `#A84B00` | 5,01 / 5,72 / 5,03 |
| `gain-bg` (daltoniści) | `#13213A` | — | `#E6EEF9` | — |
| `loss-bg` (daltoniści) | `#2D1E10` | — | `#FBEEE4` | — |
| `flat` | = `muted` | 7,43 | = `muted` | 5,50 |

Paleta dla daltonistów przełącza się atrybutem `data-palette="colorblind"` na `<html>`; komponenty używają wyłącznie tokenów `gain`/`loss`/`flat` i ich teł `*-bg`. Zielony motywu jasnego zmieniono z `#1A7F37` na `#18783A` (ADR-017): na jaśniejszym tle `#F1F0EB` stary dawał 4,45:1.

## 3. Typografia

```css
/* packages/ui/src/tokens.css — fragment ilustracyjny (kierunek B, ADR-017) */
@theme {
  --font-sans: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Helvetica Neue", Arial, sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  --text-xs: 0.75rem; --text-sm: 0.875rem; --text-base: 1rem; --text-lg: 1.125rem;
  --text-title: 1.375rem; --text-hero: 2.125rem; --text-hero-xl: 2.75rem;
  --color-bg: #0B0D0F; --color-panel: #161A1F; --color-line: #262D34; --color-ink: #E8EAED;
  --color-primary: #E8EAED; --color-on-primary: #0B0D0F; --color-series: #E8EAED;
}
:root[data-theme="light"] { --color-bg: #F1F0EB; --color-panel: #FFFFFF; --color-line: #E2E1DA; --color-ink: #14171A; }
.num { font-family: var(--font-mono); font-variant-numeric: tabular-nums lining-nums; letter-spacing: -0.01em; }
.label { font-size: var(--text-xs); font-weight: 500; color: var(--color-muted); }
```

| Rola | Krój | Uwagi |
|---|---|---|
| Liczby, kwoty, kursy, daty w tabelach | `--font-mono`, klasa `.num` | cyfry tabelaryczne — kolumny nie rozjeżdżają się przy aktualizacji kursów |
| Tytuł ekranu | `--font-sans`, 22 px, waga 650 | bezszeryfowy od ADR-017; krój szeryfowy usunięty |
| Nagłówek karty | `--font-sans`, 15 px, waga 600 | — |
| Etykiety pól, kolumn i metryk | `--font-sans`, klasa `.label` | 12 px zwykłą wielkością liter, waga 500, kolor `muted` (wcześniej 10 px wersaliki) |
| Tekst interfejsu, opisy, disclaimery | `--font-sans` | 13–16 px, interlinia 1,5 |

- Wartość główna ekranu (wartość portfela, kurs instrumentu): 34 px (44 px na komputerze), krój maszynowy, interlinia 1,1, waga 650. Wartości w kartach KPI 18 px, waga 600; w wierszach 14 px; opisy 12 px.
- **Pola formularzy ≥ 16 px** (mniejsza czcionka powoduje automatyczne powiększanie strony przez Safari na iOS przy fokusie).
- Maks. szerokość tekstu ciągłego 70 znaków; rozmiary w `rem` (WCAG 1.4.4).
- Krój maszynowy jest systemowy, więc gdy wariant tabelaryczny nie jest dostępny, `font-variant-numeric` degraduje się bezpiecznie — wyrównanie zapewnia dodatkowo stała szerokość kolumny liczbowej.

## 4. Odstępy, siatka, kształty, ruch

| Kategoria | Wartości |
|---|---|
| Odstępy | skala 4 px: 4, 8, 12, 16, 20, 24, 32, 48 |
| Gęstość | wiersz listy pozycji min. 64 px (telefon), wiersz tabeli ok. 44 px (komputer); karta 16 px odstępu wewnętrznego (12 × 16 px w wariancie zwartym), 12 px (telefon) i 16 px (komputer) między kartami |
| Punkty łamania | 360 (min.), 640, 768, 1024 (nawigacja boczna), 1280, 1536 px |
| Promienie | 12 px karty i banery, 10 px przyciski i wnętrza kart, 18 px przycisk „+”, 9999 px plakietki, przełączniki, pole wyszukiwania i lista wyboru, 0 px wiersze |
| Cienie | **brak w treści i na kartach** (karty wyróżnia ramka `line`); jeden poziom wyłącznie dla przycisku „+” i warstw nad treścią (arkusze, okna, menu) |
| Obramowania | ramka kart i linie wierszy 1 px `line`; `border` tylko dla kontrolek (≥ 3:1) |
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

BL-012: publiczne formatery `packages/i18n` przyjmują wartości dziesiętne jako `string | Decimal`, z odrzuceniem `number` także w runtime. `Intl.NumberFormat` otrzymuje ciąg bez konwersji, z `halfExpand` (ROUND_HALF_UP); waluty obce używają kodu ISO. `formatDate` przyjmuje datę sesyjną bez strefy, `formatDateTime` i `formatTime` wymagają znacznika ze strefą albo `Date`. Testy w Node 24.21.0 obejmują dużą kwotę przekraczającą bezpieczny zakres `number`, zaokrąglenia, precyzje i zmianę czasu. Lokalne uzupełnienie deklaracji `Intl.format` odzwierciedla obsługę ciągów przez ECMA-402; nie zmienia wartości w runtime.

## 6. Komponenty domenowe (`packages/ui`)

| Komponent | Odpowiedzialność | Dostępność | Obowiązkowy na |
|---|---|---|---|
| `<MoneyValue/>` | formatuje `Money`; wariant pełny i kompaktowy | pełna wartość w `title`/opisie przy formie kompaktowej | wszystkie kwoty |
| `<ChangeValue/>` | zmiana kwotowa lub procentowa: znak, ▲/▼, kolor `gain`/`loss`/`flat`; wariant plakietki na tle `gain-bg`/`loss-bg` | ikona `aria-hidden`, tekst dla czytnika „wzrost o …” / „spadek o …” | wszystkie zmiany i P/L |
| `<DataFreshness/>` | źródło, czas, opóźnienie, flaga `stale` z przyczyną (`DataMeta`) | tekst, nie tylko ikona; `role="status"` przy zmianie na nieaktualne | każdy widok danych rynkowych i wyceny (FR-01.15) |
| `<AssumptionsBlock/>` | założenia analizy (dane, okno, model, koszty, podatki, ziarno) | rozwijane `<details>`, domyślnie otwarte przy pierwszym wyświetleniu | wyniki analiz FR-04 (NFR-07.02) |
| `<Disclaimer/>` | treść z [`../11-zgodnosc-prawna.md`](../11-zgodnosc-prawna.md) § 4.3 wg klucza i wersji | zwykły tekst, nie obrazek | analizy, screener, alerty, eksporty (NFR-07.01) |
| `<Explainer/>` | ikona „i” (24 px, na dotyku cel 44 px) przy etykiecie metryki: definicja, jak czytać, pułapki, link do glosariusza | przycisk z nazwą dostępną „Co oznacza …”, treść w `popover` | każda metryka i wskaźnik (FR-06.02) |
| `<ChartFrame/>` | tytuł, opis, przełącznik „tabela”, `<DataFreshness/>`, leniwe ładowanie biblioteki | opis tekstowy trendu, tabela alternatywna | każdy wykres (NFR-06.01) |
| `<StatTile/>` | karta KPI: etykieta z `<Explainer/>`, wartość, zmiana jako plakietka, stan ładowania | etykieta powiązana z wartością | dashboard, podsumowania |
| `<DataTable/>` | tabela HTML z serwera; sortowanie i wirtualizacja doładowywane leniwie | `<th scope>`, `aria-sort` | pozycje, operacje, screener |
| `<StepUpDialog/>` | kod TOTP dla działań wrażliwych i ponowienie żądania | fokus w polu kodu, `autocomplete="one-time-code"` | tokeny PAT, eksport, admin |
| `<StaleBanner/>`, `<OfflineBanner/>` | stan danych i sieci dla całego ekranu | `role="status"` | powłoka aplikacji |
| `<Sparkline/>` | mikrowykres okna 30 sesji w wierszu pozycji; kolor `gain`/`loss`/`flat` według zmiany w tym oknie | `aria-hidden` — wartość i zmiana są w tekście wiersza | lista pozycji, watchlisty |
| `<DistributionStrip/>` | pasek rozkładu wyniku analizy: zakres 5–95 %, wewnątrz 25–75 %, kreska mediany, podpisy wartości brzegowych | tekst „od … do …, mediana …” oraz tabela percentyli obok | podsumowania analiz FR-04 |
| `<EmptyState/>`, `<Skeleton/>` | brak danych z następnym krokiem; szkielet o wymiarach docelowych | szkielet `aria-hidden`, `aria-busy` na kontenerze | wszystkie listy i sekcje |
| `<LiveStatus/>` | jeden stan połączenia SSE z jedną akcją („Aktualizacje na żywo · Wstrzymaj”, „Aktualizacje wstrzymane · Wznów”, „Łączenie z aktualizacjami”) | `role="status"`; kropka `aria-hidden`; akcja z pełną nazwą dostępną | powłoka (nagłówek ekranu) |
| `<AllocationBar/>` | poziomy pasek udziałów (maks. 7 kategorii + „pozostałe”) z etykietami i procentami pod segmentami | pasek `aria-hidden`, wartości w tekście | Start (ekspozycja walutowa), alokacja |
| `<RangeBar/>` | położenie kursu w zakresie 52 tygodni z wartościami brzegowymi | tekst „kurs w N% zakresu” | karta instrumentu |
| `<Sheet/>` | arkusz od dołu (telefon) albo panel boczny (komputer): wskaźniki, formularz operacji, szczegóły | `<dialog>`, fokus w środku, zamknięcie klawiszem Esc | karta instrumentu, operacje |
| `<ErrorState/>` | błąd z identyfikatorem żądania i akcją „Spróbuj ponownie” | `role="alert"` przy pierwszym wyświetleniu | wszystkie sekcje z danymi |

Ikony: `lucide-react` (ISC), import pojedynczych ikon; ikony obok tekstu są dekoracyjne (`aria-hidden`), ikony samodzielne mają nazwę dostępną.

BL-012 udostępnia `DataFreshness`, `AssumptionsBlock` i `Disclaimer`. Świeżość rozróżnia notowanie opóźnione, datę sesji EOD i kurs NBP; opóźnienie pochodzi z `DataMeta`, przyczyny ze słownika TXT. Stały region `status` służy do ogłoszenia nieaktualności. `AssumptionsBlock` wymaga podsumowania i treści szczegółów, domyślnie jest otwarty; ekran analizy odpowiada za komplet założeń z LAW § 4.2. `Disclaimer` wymaga klucza i wersji, odrzuca niezgodną wersję. Pozostałe komponenty domenowe z tabeli powstają wraz z odpowiednimi ekranami, poza zakresem BL-012.

## 7. Motywy

BL-011: strona techniczna używa lokalnych ciasteczek `oi-test-theme` i `oi-test-palette` wyłącznie do demonstracji tokenów. Serwer waliduje wybór i ustawia atrybuty HTML; przełącznik zmienia je bez przeładowania. Brak preferencji lub błędna wartość oznacza dark/standard. Nie jest to profil konta: synchronizacja między urządzeniami z FR-07.08 oraz wymuszenie ciemnego motywu na ekranach przed zalogowaniem należą do M1. Tokeny są eksportowane z `@oliginvest/ui/tokens.css` i konsumowane przez Tailwind 4; fonty wyłącznie systemowe.

- **`dark` domyślnie** (decyzja właściciela 2026-09-22); do wyboru `light` i `system` (FR-07.08). Serwer renderuje `data-theme` i `data-palette` na `<html>` na podstawie preferencji — bez skryptu inline, więc bez migania motywu i bez wyjątku w CSP. Dla `system` rozstrzyga media query `prefers-color-scheme`.
- Ekrany przed zalogowaniem i strony publiczne (regulamin, informacja o danych, źródła danych) renderują się w motywie ciemnym.
- `color-scheme: dark light` (natywne kontrolki i paski przewijania w odpowiednim motywie); `<meta name="theme-color">` z tokenu `bg` dla obu schematów (pasek statusu PWA).

## 8. Weryfikacja

- **Test kontrastu tokenów w CI:** skrypt czyta tokeny z `packages/ui` i sprawdza progi z § 2 (tekst 4,5:1, grafika i granice 3:1) dla obu motywów i obu palet; spadek poniżej progu = czerwony build.
- **Test wizualny:** zrzuty kluczowych ekranów w motywie ciemnym (domyślnym), jasnym i z paletą dla daltonistów.
- **Test fontów w CI:** w `packages/ui` i `apps/web` nie ma reguł `@font-face` ani odwołań do zewnętrznych hostów fontów (zasada 9 z § 1).
- **Przegląd ręczny** raz na etap: symulacja deuteranopii i protanopii w narzędziach deweloperskich Chrome (Rendering → Emulate vision deficiencies).

Decyzja M1-4a (2026-10-11): domyślna wartość `theme` w bazie i fallback API to `dark`. Migracja zmienia wyłącznie DEFAULT; zapisane wartości użytkowników pozostają bez zmian, także `system`.
