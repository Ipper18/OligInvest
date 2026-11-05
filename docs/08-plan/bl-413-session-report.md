# BL-413 — stan 2026-11-05

**Cel:** zapisać stan redesignu UI w kierunku B ([ADR-017](../09-decyzje/ADR-017-jezyk-wizualny-panele.md)) po sesji układu: powłoka, Pozycje, filtry, wylogowanie i Start — `feat/ui-redesign-b`, draft [PR #53](https://github.com/Ipper18/OligInvest/pull/53). Status `w toku` do zielonego CI i wspólnego DoD.

## Wykonane

Stan wejściowy (afab3a9): tokeny B, komponenty `packages/ui` (panele, `LiveStatus`, `ErrorState`, `Explainer` „i”, plakietki ▲/▼), powłoka z jedną etykietą stanu, nawigacja tylko do istniejących sekcji, poprawiony wyścig offline Startu.

W tej sesji, według artboardów [`projekt-b/`](../04-frontend/projekt-b/b-tokens.css) (B-Start-*, B-Pozycje-*):

- **Powłoka:** marka w komórce panelu bocznego, ikony inline SVG (`aria-hidden`, nazwa z tekstu), podmenu Portfela (7 podstron) w panelu bocznym zamiast rzędu linków pod tytułem; na telefonie dolny pasek z ikonami i „chipy” podstron. Pozycje menu i ikony renderuje serwer (`shell-navigation.tsx`), klient zaznacza tylko bieżącą stronę — powłoka zmalała z 29,69 do 28,98 KiB.
- **Pozycje:** kafelki KPI (Wartość w PLN, Wynik niezrealizowany, Wynik dnia, Pozycje) nad gęstą tabelą (Instrument z tickerem/giełdą/rachunkiem, Ilość, Kurs z plakietką „nieaktualne”, Wartość w PLN, Koszt, Udział, Dziś, Wynik kwota + %, wiersz „Razem”); na telefonie karty z rozwijanymi szczegółami. Usunięto układ „tabela z jednym wierszem + Szczegóły pozycji + kafelki pod spodem”. Średni koszt, wynik w walucie instrumentu, efekt ceny i waluty — w zwijanym „Rozbicie wyniku i średni koszt” (bez utraty danych).
- **Filtry:** jeden przełącznik „Wszystkie rachunki” w prawym górnym rogu nagłówka strony (Start i ekrany portfela) obok akcji głównej; widok wyniku, grupowanie, typ, status i daty pod „Opcje widoku”. Jeden formularz GET: zmiana listy stosuje się od razu, „Zastosuj” zostaje dla dat i jako rezerwa.
- **Wylogowanie:** z nagłówka powłoki do Ustawienia → Konto, ta sama sekwencja (czyszczenie stanu, `/auth/action`, BroadcastChannel, wypisanie push).
- **Start:** tabela „Rachunki” na pełną szerokość (nie jest ucinana na 1280 px), panele wyrównane do góry, źródło danych pod tabelą.
- **Dane testowe:** syntetyczna pozycja ma ostatni kurs, udział, % wyniku i wynik dnia (świeża sesja) oraz kurs z plakietką „nieaktualne” (sesja nieaktualna).

## Naprawy po pierwszym przebiegu CI (2026-11-05)

- **CLS w Lighthouse (CI 0,181 przy progu 0,1 na `/`, `/portfel`, `/rynek/<id>`; `main` 0,000):** na wolnym runnerze `loading.tsx` maluje niski szkielet, stopka trafia na pierwszy ekran, a treść ze streamingu wypycha ją w dół. Lokalnie odtworzone przy dławieniu sieci (CLS 0,15–0,21, jedynym źródłem `footer.oi-footer`). Poprawka: `.oi-content { min-height: 100dvh }` — stopka jest poniżej pierwszego ekranu w obu stanach; po zmianie 0,001 także przy 600 ms opóźnienia i CPU ×6. Progu nie zmieniano.
- **`redesign.spec.ts` w jobie obrazów produkcyjnych:** syntetyczne sesje istnieją tylko na lokalnym serwerze testowym, a spec dziedziczył `E2E_BASE_URL` obrazów i trafiał na logowanie. Spec przypięty do `https://127.0.0.1:3197` jak `m2-ui.spec.ts`; lokalnie z `E2E_BASE_URL` ustawionym jak w CI 33/33 PASS.
- **Ctrl+Home/End w zwirtualizowanej tabeli Pozycji (> 100 pozycji):** dokończona poprawka Codexa — `VirtualTable` przewija przez `scrollToIndex`, bo natywne przewijanie celuje w szacowaną wysokość przed pomiarem wierszy; test „large positions” PASS w trzech silnikach. Commity Codexa (wirtualizacja powyżej 100 pozycji, geometria pasków jako atrybuty SVG pod ścisłym CSP) przejrzane — nie cofają zmian układu.
- **`[firefox-shell] mbank: upload…`:** nieodtworzony — lokalnie 5/5, 20/20 (oba importy ×10) i cały projekt ×3; w CI test przeszedł na kolejnych commitach z tym samym kodem ekranów. Ślad z CI: po „Wyszukaj instrument” nie wyszła akcja serwera (akcje Next.js są kolejkowane, a wcześniejsze odpytywanie `rows` po przejściu w `parsed` nie zakończyło się w śladzie). Wzorzec odpytywania jest w `main` bez zmian; bez retry i bez zmian timeoutów.
- **Historia gałęzi:** jeden commit na aktualnym `origin/main` (decyzja właściciela) — usuwa niezgodny z Conventional Commits `wip(ui)` i merge.

## Pominięte i dlaczego

- **„Historia wartości” na Starcie** — nie w tym zadaniu (polecenie właściciela). Uwaga: backend już istnieje — `GET /portfolio/history` (`getPortfolioHistory`, BL-302, PR #19); brakuje tylko ekranu. Zamiast nowego zadania backendowego dodano **BL-414** (panel w języku B na istniejącym API, zależności BL-302 i BL-413) — zaakceptowane przez właściciela 2026-11-05.
- **Kolumna „30 sesji” (sparkline)** — API pozycji nie zwraca serii; bez nowych endpointów.
- **„Ostatnie alerty” i „Stan danych”** — BL-409/BL-406; web nie ma jeszcze klienta alertów, a stan danych pokazują dziś linie `<DataFreshness/>` przy panelach.
- **Wyszukiwarka w nagłówku** (artboardy) — osobna funkcja, poza zakresem.

## Różnice wobec artboardów

| Element | Artboard | Implementacja |
|---|---|---|
| Nagłówek komputera | wyszukiwarka + stan | tylko `LiveStatus` (brak wyszukiwarki) |
| Podmenu Portfela | Pozycje, Operacje, Wyniki, Ryzyko, Alokacja, Dywidendy | istniejące podstrony: Pozycje, Operacje, Import operacji, Rachunki, Partie FIFO, Wynik zrealizowany, Alokacja |
| KPI Pozycji | Wartość, Wynik, Dziś, Pozycje | jak w artboardzie; „Wynik dnia” z istniejącego `GET /portfolio/day-change` (to samo co na Starcie) |
| Wiersz „Razem” | udział 100 %, dziś %, wynik % | tylko kwoty z `totals` (procenty wymagałyby obliczeń poza `packages/core`) |
| Kolumna „Dziś” | % zmiany | `priceChangeRatio` instrumentu z `GET /portfolio/day-change`; pole `Position.dayChange` istnieje w kontrakcie, ale API go nie wypełnia |
| Wynik w wierszu | kwota tekstem + % plakietką | obie wartości jako plakietki `<ChangeValue/>` |
| Telefon: „+” (FAB) | pływający przycisk | „Dodaj operację” w nagłówku obok przełącznika |
| Telefon: nagłówek | tytuł, wyszukiwanie, stan pod przełącznikiem | marka i `LiveStatus` w jednym wierszu nad tytułem |
| Start | wykres historii, alerty, stan danych | bez tych paneli (wyżej); Rachunki na pełną szerokość |
| Wartość nieaktualna | artboard pokazuje kwotę | „—” (twarda zasada); widoczny tylko ostatni kurs z plakietką |

## Weryfikacja

- Zrzuty przed i po (Chromium 1440×900, 1280×900, 360×800) oraz artboardy wyrenderowane Playwrightem — porównanie w tabeli wyżej i w PR.
- `lint typecheck test` (web, ui, i18n, contracts): 25/25 zadań PASS; teksty UI i `check-docs` PASS.
- Budżety (gzip -9, progi bez zmian): powłoka 29,01/30 KiB (przed sesją 29,69), Start 157,94/190, Pozycje 167,37/195, Ustawienia 159,74/185 — wszystkie trasy PASS; onboarding 188,06/190 KiB (przed 189,61), driver 7,12/8.
- Lighthouse z asercjami (lokalnie, po naprawie CLS): wszystkie metryki PASS, CLS 0,000–0,001.
- E2E lokalnie (Windows), pełne `pnpm exec playwright test`, chromium + webkit + firefox: 172 PASS / 5 SKIP (stan 2026-11-05; te same pominięcia co przed sesją), `redesign.spec.ts` z `E2E_BASE_URL` jak w jobie obrazów 33/33 PASS, bez retry i bez zmian timeoutów. Zmienione asercje: wylogowanie przez Ustawienia (shell-auth, mvp-real), Pozycje — tabela, plakietka „nieaktualne”, „Koszt nieznany” w tabeli i rozbiciu, opcje widoku przez formularz GET; nowe asercje układu w `redesign.spec.ts` (podmenu, chipy, karty, ikony, cele ≥ 44 px, tabela Rachunków bez przewijania na 1280 px). Test bez JavaScriptu odrzucony: trasy z `loading.tsx` bez JS nie renderują treści (istniejące ograniczenie streamingu), więc test sprawdza GET i „Zastosuj” z JS.

## Otwarte i granice

Decyzje właściciela (2026-11-05): BL-414 tylko na panel — zaakceptowane; wylogowanie tylko w Ustawieniach → Konto — na teraz; `Position.dayChange` bez zmian kontraktu w tym PR, osobne **BL-415** (API wypełnia pole albo je usuwamy); ekrany bez JavaScriptu (`loading.tsx`) — osobne **BL-416**; różnice wobec artboardów — zaakceptowane jak w tabeli. Bez nowych zależności, ADR i ryzyk; tokeny i § 2.1–2.2 `system-projektowy.md` bez zmian (test tokenów PASS). Odbiór na urządzeniach — BL-412. Nakład niezmierzony.
