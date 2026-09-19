# System projektowy

**Cel:** zdefiniować tokeny (kolory, typografia, odstępy, ruch), reguły formatowania liczb i dat w pl-PL, zasady wizualizacji danych finansowych oraz katalog komponentów domenowych OligInvest — z kontrastami policzonymi według WCAG, tak aby interfejs był czytelny, spójny i dostępny w motywie jasnym, ciemnym i w palecie dla daltonistów.

Powiązane: [`architektura-ui.md`](architektura-ui.md), [`dostepnosc.md`](dostepnosc.md), [`mapa-ekranow.md`](mapa-ekranow.md), [ADR-009](../09-decyzje/ADR-009-wykresy.md), NFR-06.01–NFR-06.03, FR-07.08.

## 1. Zasady

1. **Liczby są treścią główną** — cyfry tabelaryczne, wyrównanie do prawej w tabelach, zawsze z walutą lub jednostką.
2. **Kolor nigdy nie jest jedynym nośnikiem znaczenia** — zysk i strata mają znak (`+`/`-`), ikonę ▲/▼ i tekst dla czytników ekranu (NFR-06.02).
3. **Dwie palety zysku i straty** — domyślna (zielony/czerwony, zgodna z przyzwyczajeniami) i dla daltonistów (niebieski/pomarańczowy), wybierana w preferencjach (`plPalette`, FR-07.08).
4. **Tokeny, nie wartości** — kolory, odstępy i typografia wyłącznie przez zmienne CSS zdefiniowane w `@theme` Tailwind 4 (`packages/ui`); ciemny motyw przez te same tokeny.
5. **Fonty systemowe** — zero pobierania fontów (LCP, prywatność, brak CDN).

## 2. Kolory

Kontrasty policzone wzorem WCAG 2.x (luminancja względna) 2026-09-19. Wymagania: tekst ≥ 4,5:1 (1.4.3), elementy graficzne i granice kontrolek ≥ 3:1 (1.4.11). Tło strony `bg`, tło kart i wykresów `surface`.

### 2.1 Tokeny podstawowe

| Token | Jasny | Ciemny | Min. kontrast (jasny / ciemny) | Użycie |
|---|---|---|---|---|
| `--color-bg` | `#F5F6F8` | `#0E1116` | — | tło strony |
| `--color-surface` | `#FFFFFF` | `#171B22` | — | karty, tabele, wykresy |
| `--color-text` | `#1B1F24` | `#E6EDF3` | 15,31 / 14,61 | tekst podstawowy |
| `--color-text-muted` | `#57606A` | `#9DA7B3` | 5,91 / 7,08 | opisy, etykiety osi, wartości zerowe |
| `--color-border` | `#7A838E` | `#6E7681` | 3,55 / 3,76 | granice pól formularzy i kontrolek |
| `--color-divider` | `#D0D7DE` | `#30363D` | — (dekoracyjne) | linie siatki, separatory |
| `--color-focus` | `#0A5FB4` | `#5AA9FF` | 5,87 / 7,03 | obrys fokusu (2 px + odsunięcie 2 px) |
| `--color-warning` | `#8A5A00` | `#E3B341` | 5,48 / 8,87 | dane nieaktualne, ostrzeżenia metodologiczne |
| `--color-danger` | `#C4302B` | `#FF6B61` | 5,10 / 6,19 | błędy formularzy, akcje nieodwracalne |

### 2.2 Zysk i strata

| Token | Paleta domyślna (jasny / ciemny) | Paleta dla daltonistów (jasny / ciemny) | Min. kontrast |
|---|---|---|---|
| `--color-gain` | `#1A7F37` / `#3FB950` | `#0A5FB4` / `#5AA9FF` | 4,70 (domyślna, jasny na `bg`) |
| `--color-loss` | `#C4302B` / `#FF6B61` | `#A84B00` / `#F0913F` | 5,10 |
| `--color-flat` | = `--color-text-muted` | = `--color-text-muted` | 5,91 |

Wszystkie pary spełniają 4,5:1 dla tekstu na `bg` i `surface` w obu motywach. Paleta dla daltonistów przełącza się atrybutem `data-palette="colorblind"` na `<html>`; komponenty używają wyłącznie tokenów `gain`/`loss`/`flat`.

### 2.3 Kategorie (alokacja, porównania serii)

Na bazie palety Okabe–Ito (odróżnialnej przy najczęstszych formach daltonizmu), w motywie jasnym z ciemniejszymi wariantami barw, które na białym tle miały < 3:1 (pomarańczowa 2,25, błękitna 2,31, żółta 1,32).

| # | Jasny (kontrast na `surface`) | Ciemny (kontrast na `surface`) |
|---|---|---|
| 1 | `#0072B2` (5,19) | `#56B4E9` (7,48) |
| 2 | `#D55E00` (3,87) | `#E69F00` (7,67) |
| 3 | `#009E73` (3,42) | `#009E73` (5,05) |
| 4 | `#CC79A7` (3,06) | `#CC79A7` (5,64) |
| 5 | `#A66A00` (4,48) | `#F0E442` (13,06) |
| 6 | `#3A87B8` (3,93) | `#D55E00` (4,46) |
| 7 | `#8A7A00` (4,32) | `#8FA3FF` (7,28) |
| 8 | `#5F6B78` (5,44) — „pozostałe” | `#9DA7B3` (7,08) — „pozostałe” |

Maks. 7 kategorii + „pozostałe”; segmenty wykresów rozdzielone 2 px koloru `surface`; etykiety bezpośrednio przy segmentach; tabela alternatywna zawsze dostępna.

### 2.4 Kolory wykresów

| Wykres | Reguła |
|---|---|
| Świece | wzrost `gain`, spadek `loss` (wypełnienie i knot); wolumen w kolorze świecy z przezroczystością 40 % |
| Wartość portfela, krzywa kapitału | linia `--color-text` lub kategoria 1; wpłaty netto linią przerywaną `text-muted`; markery przepływów jako trójkąty z etykietą |
| Obsunięcie („underwater”) | obszar `loss` z przezroczystością 30 % + linia `loss` |
| Wachlarz Monte Carlo | jednobarwny (kategoria 1): pasmo 5–95 % przezroczystość 15 %, 25–75 % 30 %, mediana linią ciągłą — **nie** kolory zysku/straty (scenariusze nie są oceną) |
| Heatmapa | skala rozbieżna `loss` → `surface` → `gain`, 5 stopni na stronę, nasycenie wg `|zmiana|`, obcięcie na ±5 % (1D) i ±20 % (1M+); kolor tekstu kafelka dobierany automatycznie (czarny/biały wg luminancji, ≥ 4,5:1); etykieta zawsze ze znakiem i % |
| Benchmark | linia przerywana kategorii 2 |

Zasady ogólne: wykres słupkowy zawsze od zera; wykresy wartości bez zera na osi Y rysowane jako linia, nie obszar; podpisy osi i jednostki zawsze widoczne; źródło i czas danych pod wykresem (`<DataFreshness/>`); brak legendy, gdy wystarczają etykiety bezpośrednie.

## 3. Typografia

```css
/* packages/ui/src/tokens.css — fragment ilustracyjny */
@theme {
  --font-sans: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Helvetica Neue", Arial, sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  --text-xs: 0.75rem;   --text-sm: 0.875rem;  --text-base: 1rem;   --text-lg: 1.125rem;
  --text-xl: 1.25rem;   --text-2xl: 1.5rem;   --text-3xl: 1.875rem;
  --color-bg: #F5F6F8;  --color-surface: #FFFFFF;  --color-text: #1B1F24;
  --color-gain: #1A7F37; --color-loss: #C4302B;  --color-focus: #0A5FB4;
}
[data-theme="dark"] { --color-bg: #0E1116; --color-surface: #171B22; --color-text: #E6EDF3; }
[data-palette="colorblind"] { --color-gain: #0A5FB4; --color-loss: #A84B00; }
.num { font-variant-numeric: tabular-nums lining-nums; }
```

- Tekst podstawowy 16 px; **pola formularzy ≥ 16 px** (mniejsza czcionka powoduje automatyczne powiększanie strony przez Safari na iOS przy fokusie).
- Interlinia 1,5 dla tekstu, 1,2 dla wartości w kafelkach; maks. szerokość tekstu ciągłego 70 znaków.
- Wszystkie kolumny i wartości liczbowe: klasa `num` (cyfry tabelaryczne — kolumny się nie „rozjeżdżają” przy aktualizacji kursów).
- Rozmiary w `rem` — respektują ustawienia powiększenia tekstu w przeglądarce (WCAG 1.4.4).

## 4. Odstępy, siatka, kształty, ruch

| Kategoria | Wartości |
|---|---|
| Odstępy | skala 4 px: 4, 8, 12, 16, 24, 32, 48, 64 |
| Punkty łamania | 360 (min.), 640, 768, 1024 (nawigacja boczna), 1280, 1536 px |
| Promienie | 4 px (pola), 8 px (karty), 9999 px (pigułki) |
| Cienie | 2 poziomy (karta, warstwa nad treścią); w motywie ciemnym zastępowane jaśniejszym `surface` |
| Warstwy (`z-index`) | treść 0, nawigacja 10, arkusze i okna 20, powiadomienia 30 |
| Cele dotykowe | ≥ 44 × 44 px na telefonie (wytyczne Apple), ≥ 24 × 24 px wszędzie (WCAG 2.2, 2.5.8) |
| Ruch | 120 ms (hover/focus), 200 ms (panele), 300 ms (arkusze); `prefers-reduced-motion: reduce` → brak animacji wykresów i przejść |
| Obszary bezpieczne | `env(safe-area-inset-*)` dla dolnej nawigacji i arkuszy (iPhone z wycięciem, tryb standalone) |

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
| `<EmptyState/>`, `<Skeleton/>` | brak danych z następnym krokiem; szkielet o wymiarach docelowych | szkielet `aria-hidden`, `aria-busy` na kontenerze | wszystkie listy i sekcje |

Ikony: `lucide-react` (ISC), import pojedynczych ikon; ikony obok tekstu są dekoracyjne (`aria-hidden`), ikony samodzielne mają nazwę dostępną.

## 7. Motywy

- `system` (domyślnie), `light`, `dark` z preferencji użytkownika (FR-07.08). Serwer renderuje `data-theme` i `data-palette` na `<html>` na podstawie preferencji — bez skryptu inline, więc bez migania motywu i bez wyjątku w CSP. Dla `system` rozstrzyga media query `prefers-color-scheme`.
- `color-scheme: light dark` (natywne kontrolki i paski przewijania w odpowiednim motywie); `<meta name="theme-color">` z tokenu `bg` dla obu schematów (pasek statusu PWA).

## 8. Weryfikacja

- **Test kontrastu tokenów w CI:** skrypt czyta tokeny z `packages/ui` i sprawdza progi z § 2 (tekst 4,5:1, grafika i granice 3:1) dla obu motywów i obu palet; spadek poniżej progu = czerwony build.
- **Test wizualny:** zrzuty kluczowych ekranów w motywie jasnym, ciemnym i z paletą dla daltonistów.
- **Przegląd ręczny** raz na etap: symulacja deuteranopii i protanopii w narzędziach deweloperskich Chrome (Rendering → Emulate vision deficiencies).
