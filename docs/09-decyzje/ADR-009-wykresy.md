# ADR-009: Wykresy — TradingView Lightweight Charts (świece) + uPlot (serie), heatmapa w CSS

**Cel:** zapisać wybór bibliotek wykresów i zasady ich ładowania tak, aby wykresy były płynne na telefonie i mieściły się w budżecie JS.

- **Status:** zaakceptowana
- **Data:** 2026-09-18
- **Decydent:** właściciel projektu
- **Powiązane wymagania:** FR-01.03–FR-01.06, FR-01.10, FR-02.05, FR-02.10, FR-03.09, FR-04.02, NFR-01.02–NFR-01.04, NFR-06.01

## Kontekst

Kryterium ze specyfikacji: świece + wolumen + 10 lat danych + płynność na telefonie; canvas/WebGL zamiast SVG na dużych seriach; brak eager-loadingu bibliotek wykresów; budżet initial JS < 200 KB gzip. Potrzebne są też wykresy liniowe/obszarowe (krzywa kapitału, obsunięcia, wachlarz percentyli MC) i heatmapa sektorowa.

## Rozważane opcje (rozmiary gzip z bundlephobia, 2026-09-18)

| Biblioteka | gzip | Renderer | Świece + wolumen | Duże serie | Uwagi |
|---|---|---|---|---|---|
| **Lightweight Charts 5.2** | 60 KB | canvas | natywnie | tak | Apache-2.0; licencja wymaga atrybucji TradingView |
| **uPlot 1.6** | 21 KB | canvas | przez wtyczkę (bez wolumenu z pudełka) | bardzo szybki | MIT |
| ECharts 6.1 | 359 KB (pełny) | canvas/SVG | tak | tak | za ciężki na budżet |
| Recharts / visx | 40+ KB / modułowy | SVG | słabo / DIY | nie | SVG nie skaluje się do tysięcy elementów |

## Decyzja

- **Lightweight Charts** dla wykresów instrumentów (świece, wolumen, nakładki SMA/EMA/Bollinger, panele RSI/MACD/ATR). Atrybucję TradingView zapewniamy zgodnie z licencją (logo atrybucji wbudowane w wykres lub wpis na stronie „Źródła danych i licencje” — decyzja z Kroku 6: oba sposoby naraz, [`../11-zgodnosc-prawna.md`](../11-zgodnosc-prawna.md) § 6).
- **uPlot** dla serii liniowych i obszarowych: wartość portfela, obsunięcia („underwater”), wachlarz percentyli, porównanie z benchmarkiem, sparkline.
- **Heatmapa sektorowa i treemap alokacji**: własny komponent CSS Grid (bez biblioteki), z pełną alternatywą tabelaryczną i obsługą klawiatury.
- Obie biblioteki **ładowane dynamicznie** wyłącznie na trasach z wykresami; wrappery w `packages/ui` z jednolitymi tokenami kolorów (paleta przyjazna daltonistom) i opisem tekstowym/tabelą danych dla czytników ekranu (NFR-06.01).
- **Decymacja po stronie serwera** do ≤ 3 000 punktów (agregacja świec do W/M, dla linii algorytm LTTB); wskaźniki liczone w `packages/core` na danych pełnych przed decymacją.

## Konsekwencje

- Pozytywne: ~81 KB gzip łącznie, tylko na trasach wykresów; płynność na telefonie; spójność kolorów.
- Negatywne: dwie biblioteki o różnych API (ukryte za wrapperami); heatmapa do napisania (prosty komponent).
- Zadania: wrappery wykresów (M1: świece; M3: uPlot), heatmapa (M5a), budżety tras w `size-limit`.

## Weryfikacja

Na profilu mobilnym Lighthouse: wykres 10 lat danych dziennych renderuje się bez długich zadań > 50 ms; chunki trasy `/` nie zawierają bibliotek wykresów (NFR-01.03).
