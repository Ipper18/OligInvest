# ADR-017: Język wizualny „panele monochromatyczne” (kierunek B)

**Cel:** zapisać zmianę języka wizualnego interfejsu z „linii włosowych bez pudełek” na karty z ramką 1 px, kolorem wyłącznie w danych i bezszeryfową hierarchią, tak aby redesign ekranów (BL-413) i ekrany M4 miały jedno źródło zasad.

- **Status:** zaakceptowana (wybór właściciela 2026-10-29: „B w całości”)
- **Data:** 2026-10-29
- **Decydent:** właściciel projektu
- **Powiązane wymagania:** NFR-06.01, NFR-06.02, FR-07.08, FR-01.15, NFR-07.01

## Kontekst

Po pierwszym uruchomieniu lokalnego demo (2026-10-26) właściciel ocenił interfejs jako nieintuicyjny i przestarzały. Konkretne problemy: gołe tabele bez grupowania, duże pola „?” przy każdej metryce, sprzeczne etykiety stanu połączenia („Aktualizacje wstrzymane” obok „Wstrzymaj aktualizacje”), „0,00 zł” przy nieaktualnych danych i nawigacja do niezbudowanych sekcji. Aplikacja ma służyć codziennie na telefonie (iPhone, PWA) także początkującym inwestorom.

Projekt powstał w Claude Design na podstawie briefu z twardymi zasadami: MiFID II, świeżość danych, „—” zamiast zera, kolor nigdy jedynym nośnikiem znaczenia, WCAG 2.2 AA, fonty systemowe, formaty pl-PL, budżet JS powłoki 30 KiB. Powstały dwa kierunki na tych samych danych fikcyjnych: 3 ekrany × 2 rozmiary, stany Startu, paleta dla daltonistów i motyw jasny.

## Rozważane opcje

| Opcja | Zalety | Wady | Koszt / licencja |
|---|---|---|---|
| A. „Ewolucja”: linie włosowe, nagłówki szeryfowe, etykiety 10 px wersalikami | Tokeny i komponenty już istnieją; większa pojemność listy pozycji (komputer 14 wierszy, telefon 7) | Nadal odbierany jako przestarzały; grupy treści wyznaczają tylko linie i odstępy, co jest trudniejsze dla początkujących | 0 zł; CSS ok. 5,2 KB gzip |
| B. „Panele monochromatyczne”: karty z ramką 1 px, kolor tylko w danych, etykiety 12 px zwykłą wielkością liter, zmiany jako plakietki ze znakiem i ▲/▼, objaśnienia pod ikoną „i” | Wyraźne grupy treści; przycisk główny nigdy nie myli się z zyskiem (akcent monochromatyczny); większe cele dotykowe z natury | Mniejsza pojemność (komputer 9 wierszy pozycji, telefon 6); przebudowa każdego komponentu i zrzutów wizualnych; nowe tokeny | 0 zł; CSS trzech ekranów ok. 3,6 KB gzip; 0 KB JS |

## Decyzja

Wybieramy **B**. Rozstrzyga kryterium czytelności dla codziennego użycia na telefonie i dla początkujących. Wszystkie twarde zasady pozostają spełnione: zakazy MiFID, disclaimery, świeżość danych, formaty, budżet JS i dostępność.

Zmiany w [`../04-frontend/system-projektowy.md`](../04-frontend/system-projektowy.md) (§ 1 zasady 5–7, § 2.4, nowa § 2.5 z tokenami docelowymi, § 3, § 4, § 6; tabele § 2.1–2.2 zostają opisem kodu do BL-413, bo test `packages/ui/test/tokens.test.mjs` porównuje je z `tokens.css`):

- treść leży na kartach `panel` z ramką 1 px `line` i promieniem 12 px; jeden cień tylko dla przycisku „+” i arkuszy;
- akcent jest monochromatyczny: przycisk główny i linia wartości portfela w kolorze tekstu; kolory (zysk/strata, kategorie, ostrzeżenie) wyłącznie w danych;
- nowe tokeny: `panel-2`, `line`, `primary`, `on-primary`, `warning-bg`, `gain-bg`, `loss-bg`, `series`; tło motywu jasnego `#F1F0EB`; zysk w motywie jasnym `#18783A`;
- nagłówki bezszeryfowe (krój szeryfowy znika), etykiety 12 px zwykłą wielkością liter, liczby nadal krojem maszynowym z cyframi tabelarycznymi;
- `<Explainer/>` jako ikona „i” (24 px, na dotyku 44 px), `<ChangeValue/>` także jako plakietka, `<StatTile/>` jako karta; nowe komponenty `LiveStatus`, `AllocationBar`, `RangeBar`, `Sheet`, `ErrorState`;
- znak minus to łącznik U+002D, zgodnie z formaterami `packages/i18n`.

Projekt referencyjny jest w [`../04-frontend/projekt-b/`](../04-frontend/projekt-b/b-tokens.css): tokeny, CSS komponentów i 15 statycznych artboardów HTML z danymi fikcyjnymi, bez skryptów. To wzorzec wyglądu, nie kod produkcyjny: implementacja używa tokenów `@theme` w `packages/ui` i komponentów z § 6.

## Konsekwencje

- Pozytywne: jedno źródło zasad dla redesignu i ekranów M4 (BL-406, ekran PAT z BL-407, BL-409); naprawione problemy z demo (stan „—” zamiast „0,00 zł”, jedna etykieta stanu z jedną akcją, dyskretne objaśnienia, nawigacja tylko do istniejących sekcji).
- Negatywne / dług: mniejsza gęstość listy pozycji na komputerze. Jeśli portfel urośnie powyżej ok. 9 pozycji, wariant gęsty tabeli wróci jako osobna decyzja, bez zmiany tokenów. Trzeba przebudować komponenty `packages/ui`, test kontrastu tokenów (trzy tła: `bg`, `panel`, `panel-2`) i zrzuty wizualne.
- Zadania: **BL-413** (tokeny, komponenty, powłoka, Start, Pozycje, karta instrumentu); BL-406 i BL-409 oraz ekran tokenów PAT powstają już w tym języku. Ekrany M3 (BL-556, BL-560) czekają na BL-413.

## Weryfikacja

Kontrasty tokenów z [`projekt-b/b-tokens.css`](../04-frontend/projekt-b/b-tokens.css) policzono niezależnie wzorem WCAG 2.x (2026-10-29) dla czterech wariantów (ciemny, ciemny dla daltonistów, jasny, jasny dla daltonistów). Sprawdzono teksty `ink`, `muted`, `gain`, `loss`, `warning`, `danger` i `focus` na `bg`, `panel` i `panel-2`, plakietki na tłach `*-bg`, `on-primary` na `primary` (≥ 4,5:1) oraz `border` i kolory kategorii (≥ 3:1). Brak par poniżej progu; najniższe: ciemny 5,54:1 (`danger` na `panel-2`), jasny 4,78:1 (`loss` na `loss-bg`).

Teksty artboardów przeszukano listą `packages/i18n/src/compliance/forbidden-phrases.pl.json`: 0 trafień. Nie znaleziono `0,00 zł` jako wartości zastępczej, fontów zewnętrznych ani znaku U+2212. Pomiary pojemności i celów dotykowych pochodzą z narzędzia projektowego (Chromium) i nie zostały **ZWERYFIKOWANE** na iPhonie. Sprawdza je BL-413 (zrzuty wizualne, axe) oraz BL-412 (urządzenia).
