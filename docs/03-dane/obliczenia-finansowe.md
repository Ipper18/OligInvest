# Obliczenia finansowe — definicje wzorów

**Cel:** jednoznacznie zdefiniować każdą liczbę finansową pokazywaną w OligInvest — wzór, jednostki, obsługę walut, zaokrąglenia, przypadki brzegowe i wektory testowe — tak, aby implementacja w `packages/core` (TS) i w workerze `analytics` (Python) dawała identyczne, sprawdzalne wyniki.

**Status: dokument normatywny.** Kod musi być z nim zgodny. Zmiana wzoru = zmiana tego dokumentu + aktualizacja [`wektory-testowe.json`](wektory-testowe.json) w tym samym PR. Wartości przykładów policzono skryptem (Decimal dla pieniędzy, float64 dla statystyk) i porównano z bibliotekami referencyjnymi: **empyrical-reloaded** (metryki ryzyka) i **TA-Lib 0.8.0** (wskaźniki) — zgodność co do 6 miejsc po przecinku.

Powiązane: [ADR-014](../09-decyzje/ADR-014-pieniadze-waluty-czas.md) (pieniądze, waluty, czas), [ADR-003](../09-decyzje/ADR-003-hybryda-obliczen-i-kolejki.md) (podział TS/Python), [`model-danych.md`](model-danych.md), [`formaty-importu.md`](formaty-importu.md), [`../11-zgodnosc-prawna.md`](../11-zgodnosc-prawna.md) (disclaimery, podstawy podatkowe).

> ⚠️ Widok podatkowy jest **informacyjny** — nie jest rozliczeniem podatkowym ani poradą podatkową (NFR-07.01). Podstawy prawne i interpretacje: [`../11-zgodnosc-prawna.md`](../11-zgodnosc-prawna.md) § 5.

---

## 0. Zasady ogólne

### 0.1 Typy i jednostki

| Typ | Reprezentacja w `packages/core` | W bazie | W API (JSON) | Uwagi |
|---|---|---|---|---|
| `Money` | `{ amount: Decimal, currency: 'PLN' \| 'USD' \| 'EUR' \| … }` | `NUMERIC(20,8)` + `CHAR(3)` | `{"amount": "1234.56", "currency": "PLN"}` | nigdy `number` |
| `Quantity` | `Decimal` | `NUMERIC(24,10)` | `"10"`, `"0.3069"` | ułamki akcji dozwolone |
| `Price` | `Decimal` + waluta notowania | `NUMERIC(20,8)` | ciąg | cena jednostkowa |
| `FxRate` | `{ base, quote, rate: Decimal, date, source }` | `NUMERIC(18,8)` | ciąg | `rate` = liczba jednostek `quote` za 1 `base` (np. USD→PLN 3.9800) |
| `Ratio` (stopa zwrotu, udział, wskaźnik) | `number` (float64) | `DOUBLE PRECISION` tylko dla metryk | liczba | przechowujemy **ułamki** (0.0123), nie procenty; UI mnoży × 100 |

Metryki statystyczne (zmienność, Sharpe, wskaźniki TA) liczymy w `float64` — to wielkości szacunkowe, nie rozliczeniowe. Kwoty rozliczeniowe (koszty, przychody, P/L, gotówka, wartości) — wyłącznie w `Decimal`.

### 0.2 Zaokrąglenia

- Obliczenia pośrednie: `decimal.js` z precyzją 34 cyfr, tryb `ROUND_HALF_EVEN`; **bez zaokrągleń pośrednich**.
- Prezentacja i zapis kwot rozliczeniowych: do jednostki waluty (2 miejsca dla PLN, USD, EUR), tryb `ROUND_HALF_UP`.
- Procenty w UI: 2 miejsca (`0,84 %`); małe wartości (< 0,01 %) jako `< 0,01 %`.
- Widok podatkowy: kwoty do grosza (informacyjnie). Zeznanie roczne zaokrągla podstawę i podatek do pełnych złotych (Ordynacja podatkowa) — OligInvest tego nie robi, bo nie liczy zeznań.

### 0.3 Czas i daty

- Znaczniki czasu w UTC (`timestamptz`); daty sesyjne w kalendarzu giełdy (`XWAR`: Europe/Warsaw, `XNYS`/`XNAS`: America/New_York).
- **Dzień wyceny** = dzień kalendarzowy w strefie Europe/Warsaw. Zamknięcie sesji USA z dnia *d* (czasu Nowego Jorku) przypisujemy do dnia wyceny *d*.
- Dni bez notowań (weekendy, święta): wycena na ostatnim dostępnym kursie (carry-forward), kurs walutowy — ostatnia opublikowana tabela.
- Konwencja dni dla XIRR: **ACT/365** (jak funkcja XIRR w arkuszach).
- Roczny współczynnik dla metryk dziennych: **252** dni sesyjnych.

### 0.4 Konwencje znaków

- **Przepływ zewnętrzny** `F` z perspektywy portfela: wpłata `+`, wypłata `−`. Przepływy wewnętrzne (kupno, sprzedaż, dywidenda, prowizja, podatek, przewalutowanie w ramach rachunku) **nie są** przepływami zewnętrznymi.
- W XIRR stosujemy perspektywę inwestora: wpłata `−`, wypłata `+`, wartość końcowa `+`.
- P/L dodatni = zysk.

### 0.5 Tolerancje testów

| Wielkość | Tolerancja |
|---|---|
| Kwoty rozliczeniowe (`packages/core`, Decimal) | dokładnie (0 po zaokrągleniu do grosza) |
| Stopy zwrotu (TWR, proste) | 1e-9 względnie |
| XIRR | 1e-6 absolutnie (w ułamku) |
| Metryki ryzyka vs empyrical-reloaded | 1e-6 |
| Wskaźniki vs TA-Lib | 1e-8 |
| Porównanie TS ↔ Python (te same wektory) | jak wyżej, w zależności od wielkości |

---

## 1. Model operacji (wejście wszystkich obliczeń)

Źródłem prawdy są **operacje** (`portfolio.transactions`, szczegóły w `model-danych.md`); pozycje, partie, gotówka i wyceny są **pochodne** i zawsze dają się odtworzyć z operacji.

| Typ (`type`) | Ilość instrumentu | Gotówka rachunku | Koszt nabycia | Przepływ zewnętrzny `F` |
|---|---|---|---|---|
| `BUY` | `+q` | `−(q·p·kurs + prowizja + koszt FX)` w walucie rachunku | tworzy partię | nie |
| `SELL` | `−q` | `+(q·p·kurs − prowizja − koszt FX)` | zużywa partie (FIFO) | nie |
| `DIVIDEND` | — | `+netto` (brutto − podatek u źródła) | — | nie |
| `INTEREST` | — | `+kwota` | — | nie |
| `FEE` | — | `−kwota` | — (koszt okresu) | nie |
| `TAX` | — | `−kwota` (np. podatek od odsetek, FTT) | — | nie |
| `DEPOSIT` / `WITHDRAWAL` | — | `+kwota` / `−kwota` | — | **tak** (`+` / `−`) |
| `CASH_TRANSFER_IN` / `_OUT` (między własnymi rachunkami) | — | `±kwota` | — | tak na poziomie rachunku, **nie** na poziomie portfela zbiorczego |
| `FX_CONVERSION` (wymiana walut w rachunku) | — | `−kwota A` i `+kwota B` | — | nie |
| `SPLIT` (współczynnik `k`) | `q → q·k` | — | koszt bez zmian | nie |
| `SECURITY_TRANSFER_IN` / `_OUT` | `±q` | — | przenosi partie z pierwotną datą i kosztem | tak (wartość rynkowa w dniu transferu) na poziomie rachunku |
| `ADJUSTMENT` (kategoria, np. `cfd_pl`, `corporate_action`, `correction`) | — | `±kwota` | — | nie — wynik okresu w kategorii „inne” (np. wynik CFD z importu XTB, Z-15) |

Kolejność przetwarzania w obrębie dnia: według `executed_at` (lub `trade_date` + `sequence`), przy remisie — `SPLIT` przed transakcjami tego dnia, potem według `id` (UUIDv7, rosnąco).

---

## 2. Przeliczenia walut

Oznaczenia: `p` — cena w walucie notowania `CCY_i`; `CCY_a` — waluta rachunku; `mid(d)` — kurs rynkowy środkowy; `nbp(d)` — kurs średni NBP (tabela A) z dnia `d`; `prev_bd(d)` — ostatni dzień roboczy **przed** `d`.

### 2.1 Widok ekonomiczny (domyślny)

Kwoty w walucie rachunku po **faktycznym** kursie zastosowanym przez brokera:

$$\text{kurs}_{\text{broker}} = \begin{cases} \text{mid}\cdot(1 + m) & \text{kupno waluty (zakup instrumentu)} \\ \text{mid}\cdot(1 - m) & \text{sprzedaż waluty (sprzedaż instrumentu, dywidenda)} \end{cases}$$

gdzie `m` — marża przewalutowania brokera. **XTB** (Tabela opłat i prowizji z 29.06.2026): przewalutowanie przy transakcjach na instrumentach w innej walucie niż rachunek — 0,5 % kursu mid; przewalutowanie przy przelewie między rachunkami w różnych walutach — 0,5 % (0,8 % w weekendy i święta). **mBank eMakler**: rozliczenie wyłącznie w PLN, przewalutowanie przez brokera zagranicznego po kursie mid ± 0,1 % (za: dokumentacja parsera ike-terminal, zweryfikowana na eksportach — `formaty-importu.md`).

Pierwszeństwo źródeł kursu dla operacji z importu: (1) kurs lub kwoty w obu walutach zapisane w eksporcie, (2) kurs implikowany `|kwota_rozliczenia| / (q·p)`, (3) `nbp(d)` z oznaczeniem `fx_source = 'nbp_fallback'`.

Koszt przewalutowania (część ekonomiczna): `koszt_FX = q · p · mid · m` — jest częścią kosztu nabycia (kupno) lub pomniejsza przychód (sprzedaż).

### 2.2 Widok podatkowy (informacyjny)

Na podstawie art. 11a ust. 1–2 ustawy o PIT (przeliczenie przychodów i kosztów w walutach obcych po kursie średnim NBP z ostatniego dnia roboczego poprzedzającego dzień przychodu/kosztu) i art. 24 ust. 10 (FIFO dla papierów wartościowych, odrębnie dla każdego rachunku):

$$\text{koszt}_{\text{PLN}}^{\text{pod}} = q\cdot p \cdot \text{nbp}(\text{prev\_bd}(d_{\text{kupna}})) + \text{prowizja}\cdot \text{nbp}(\text{prev\_bd}(d_{\text{kupna}}))$$
$$\text{przychód}_{\text{PLN}}^{\text{pod}} = q\cdot p \cdot \text{nbp}(\text{prev\_bd}(d_{\text{sprzedaży}})) - \text{prowizja}\cdot \text{nbp}(\text{prev\_bd}(d_{\text{sprzedaży}}))$$

- Dzień przychodu i kosztu (`d_kupna`, `d_sprzedaży` we wzorach) = **dzień rozliczenia transakcji** (`settle_date`, przeniesienie własności — art. 17 ust. 1ab pkt 1 ustawy o PIT; interpretacja Dyrektora KIS z 29.03.2024, sygn. 0114-KDIP3-1.4011.1149.2023.1.AK; tak samo liczy XTB — [`../11-zgodnosc-prawna.md`](../11-zgodnosc-prawna.md) § 5). Gdy import nie podaje daty rozliczenia, wyliczamy ją z `trade_date` i kalendarza rynku: USA — T+1 (od 28.05.2024, wcześniej T+2); GPW i pozostałe rynki UE — T+2, od 11.10.2027 T+1 (rozporządzenie (UE) 2025/2075). ❓ Dni, w których giełda działa, a system rozliczeń nie (np. niektóre święta federalne w USA), wymagają kalendarza rozliczeń — w MVP wpisy admina w `market.trading_calendar` (`notes`), weryfikacja przed M1. Parametr `tax_date_basis = settlement|trade` (domyślnie `settlement`; `trade` tylko do porównań).
- **Koszt przewalutowania brokera w widoku podatkowym** (decyzja właściciela 2026-09-19): marży brokera nie dodajemy do kosztu podatkowego — widok pokazuje ją jako **osobny koszt** (`fxCosts` = część kosztów przewalutowania partii zużytych przy sprzedaży + koszt przewalutowania przy sprzedaży). Ustawienie użytkownika `tax_include_fx_fee` (domyślnie `false`) wlicza ją do kosztu; zmiana przelicza wyłącznie widok podatkowy (dane pochodne), a widok ekonomiczny zawsze zawiera ten koszt. Brak jednolitej praktyki — [`../11-zgodnosc-prawna.md`](../11-zgodnosc-prawna.md) § 5.3.
- Rachunki IKE/IKZE: widok podatkowy pokazuje „nie dotyczy” (brak rozliczenia bieżącego).

### 2.3 Wycena bieżąca pozycji zagranicznych

`wartość_PLN(t) = q · cena(t) · kurs(t)`, gdzie `kurs(t)` = ostatnia opublikowana tabela A NBP (publikacja ok. 12:15); przed publikacją — tabela z poprzedniego dnia roboczego (oznaczone `fx_as_of`). Źródło zapasowe: ECB/Frankfurter (oznaczone w UI).

---

## 3. Koszt nabycia i partie

### 3.1 Tworzenie partii (`BUY`)

Partia `L` w walucie rachunku (widok ekonomiczny) i w PLN (widok podatkowy):

$$\text{koszt}_L = q\cdot p\cdot \text{kurs}_{\text{broker}} + \text{prowizja} + \text{inne opłaty transakcyjne (np. FTT)}$$

Koszt jednostkowy `c_L = koszt_L / q`. Data nabycia partii = `trade_date` (kolejność FIFO); w widoku podatkowym kurs NBP dobieramy do `settle_date` (§ 2.2).

### 3.2 FIFO (domyślne)

Sprzedaż `q_s` zużywa partie danego instrumentu **na tym samym rachunku** w kolejności rosnącej daty nabycia (remis: kolejność przetwarzania z § 1). Dla każdej zużytej części `q_j ≤ pozostałe(L_j)`:

$$\text{koszt\_zużyty} = \sum_j q_j\cdot c_{L_j} \qquad \text{P/L}_{\text{zreal}} = \text{przychód netto} - \text{koszt\_zużyty}$$

Sprzedaż większa niż dostępna ilość = błąd danych (import oznacza wiersz `error: short_position`; brak krótkiej sprzedaży w modelu).

### 3.3 Średnia ważona (widok informacyjny)

$$\bar c = \frac{\sum_{L \in \text{otwarte}} \text{koszt}_L^{\text{pozostały}}}{\sum_{L} q_L^{\text{pozostałe}}} \qquad \text{P/L}_{\text{zreal}}^{\text{śr}} = \text{przychód netto} - q_s\cdot \bar c$$

Średnia jest przeliczana po każdym zakupie; sprzedaż nie zmienia `c̄` pozostałych sztuk.

### 3.4 Split / scalenie

Współczynnik `k` (split 4:1 → `k = 4`; scalenie 1:10 → `k = 0.1`): dla każdej otwartej partii `q_L ← q_L·k`, `c_L ← c_L / k`, `koszt_L` bez zmian, data nabycia bez zmian. Ułamki powstałe przy scaleniu rozliczane gotówką (`cash_in_lieu`) jak sprzedaż ułamka.

### 3.5 Przeniesienie papierów między rachunkami

`SECURITY_TRANSFER_OUT` z rachunku A i `SECURITY_TRANSFER_IN` na rachunek B (powiązane `related_transaction_id`) przenoszą **partie z pierwotną datą i kosztem** (FIFO liczone per rachunek — po przeniesieniu partie należą do B).

### 3.6 Edycja operacji

Każda zmiana operacji z datą `d` unieważnia i przelicza partie, pozycje i wyceny od `d` (zadanie `recompute`, [ADR-003](../09-decyzje/ADR-003-hybryda-obliczen-i-kolejki.md)).

### 3.7 Przykład A — FIFO, waluta, przewalutowanie, split (wektor `A_fifo_fx`)

Rachunek PLN w XTB, instrument AAPL (USD). Kursy fikcyjne, wyłącznie ilustracyjne. Marża FX `m = 0,5 %`, prowizja 0.

| Operacja | Zawarcie / rozliczenie | q | p (USD) | mid | kurs brokera | Koszt / przychód ekonomiczny (PLN) | NBP z dnia przed rozliczeniem | Koszt / przychód podatkowy (PLN) |
|---|---|---|---|---|---|---|---|---|
| T1 BUY | 2025-03-03 / 03-04 | 10 | 240,00 | 3,9800 | 3,99990 | 9 599,76 (w tym FX 47,76) | 3,9750 | 9 540,00 |
| T2 BUY | 2025-06-02 / 06-03 | 5 | 200,00 | 3,7500 | 3,76875 | 3 768,75 (w tym FX 18,75) | 3,7450 | 3 745,00 |
| T3 SELL | 2025-09-02 / 09-03 | 12 | 230,00 | 3,6500 | 3,63175 | 10 023,63 | 3,6550 | 10 087,80 |

FIFO: sprzedaż zużywa 10 szt. z T1 (9 599,76) + 2 szt. z T2 (1 507,50) → koszt 11 107,26 PLN.

| Wynik | Wartość |
|---|---|
| P/L zrealizowany — ekonomiczny | **−1 083,63 PLN** |
| w tym efekt ceny (przy średnim kursie zużytych partii) | −158,68 PLN |
| w tym efekt walutowy | −924,95 PLN |
| P/L zrealizowany — podatkowy (informacyjnie) | **−950,20 PLN** |
| Koszty przewalutowania przypisane do sprzedaży — w widoku podatkowym osobno (`fxCosts`) | 105,63 PLN (T1 47,76 + 2/5 z T2 7,50 + przy sprzedaży 50,37) |
| P/L podatkowy przy ustawieniu `tax_include_fx_fee = true` | −1 055,83 PLN |
| Średnia ważona: koszt jednostkowy / P/L | 891,234 PLN/szt. / −671,18 PLN (inny wynik niż FIFO — dlatego FIFO jest domyślne) |
| Pozostało po sprzedaży | 3 szt. z T2, koszt 2 261,25 PLN |
| Po splicie 4:1 | 12 szt., koszt 2 261,25 PLN, 188,4375 PLN/szt. |

---

## 4. Wynik (P/L)

### 4.1 Niezrealizowany

$$\text{P/L}_{\text{niezreal}} = \sum_{L\ \text{otwarte}} \left(q_L \cdot \text{cena}(t)\cdot \text{kurs}(t) - \text{koszt}_L^{\text{pozostały}}\right)$$

Procent: `P/L_niezreal / koszt_pozostały`.

### 4.2 Rozbicie na efekt ceny i efekt walutowy (FR-02.06)

Dla pozycji w walucie `CCY_i ≠ PLN`, z kosztem w walucie instrumentu `K_i` i efektywnym kursem nabycia `r_0 = koszt_PLN / K_i`:

$$\text{efekt ceny} = (\text{wartość}_{CCY_i} - K_i)\cdot r_0 \qquad \text{efekt walutowy} = \text{P/L}_{\text{PLN}} - \text{efekt ceny}$$

Suma obu efektów = P/L w PLN (tożsamość; test).

### 4.3 Dywidendy i podatek u źródła (FR-02.08) — przykład G (wektor `G_dividend`)

100 akcji × 0,25 USD brutto; podatek u źródła 15 %; rachunek PLN (kurs brokera 3,68 × (1 − 0,5 %)); NBP D-1 = 3,6900.

| Pozycja | Wartość |
|---|---|
| Brutto / podatek u źródła / netto (USD) | 25,00 / 3,75 / 21,25 |
| Wpływ na rachunek — widok ekonomiczny | **77,81 PLN** |
| Brutto w PLN — widok podatkowy | 92,25 PLN |
| 19 % od brutto / zaliczenie podatku u źródła | 17,53 / 13,84 PLN |
| Szacowana dopłata (informacyjnie) | **3,69 PLN** |

Stopa dywidendy od kosztu = suma dywidend brutto z 12 miesięcy / koszt nabycia pozycji.

### 4.4 Pozostałe pozycje gotówkowe

Odsetki od wolnych środków (`INTEREST`) i podatek od nich (`TAX`), opłaty (`FEE`), podatki transakcyjne (FTT — `TAX` powiązany z transakcją lub część kosztu partii) wchodzą do wyniku okresu jako osobne kategorie; nie zmieniają kosztu nabycia (poza FTT przypisanym do zakupu).

---

## 5. Wycena, wartość, wynik dnia

$$V_a(t) = \sum_i q_i(t)\cdot \text{cena}_i(t)\cdot \text{kurs}_{CCY_i\to CCY_a}(t) + \text{gotówka}_a(t)$$

Wartość portfela zbiorczego w PLN: `V(t) = Σ_a V_a(t)·kurs_{CCY_a→PLN}(t)`. Każda wycena niesie `as_of` = najstarszy znacznik czasu użytej ceny lub kursu (do FR-01.15).

**Wycena dzienna** (`portfolio.valuations_daily`): po zamknięciu sesji, kursy zamknięcia (EOD) i tabela A NBP z tego dnia (dla dni bez tabeli — ostatnia dostępna).

### 5.1 Wynik dnia (FR-02.09) — przykład F (wektor `F_day_change`)

$$\Delta_{\text{dzień}} = V(t) - V(\text{zamknięcie } D{-}1) - F_{\text{dzień}}$$

Przykład: 53 120,55 − 52 340,10 − 500,00 (wpłata dziś) = **280,45 PLN (0,54 %)**; procent względem `V(D−1)`.

---

## 6. Stopy zwrotu

### 6.1 Prosta
`R = (V_koniec − V_początek − ΣF) / V_początek` — tylko jako pomocnicza; nie jest miarą porównywalną między okresami z przepływami.

### 6.2 TWR — stopa ważona czasem (FR-03.06)

Dzienna metoda łańcuchowa. **Konwencja:** przepływ zewnętrzny z dnia `d` księgujemy na **początku** dnia `d` (przed zmianą cen tego dnia):

$$r_d = \frac{V_d}{V_{d-1} + F_d} - 1 \qquad \text{TWR}_{[0,T]} = \prod_{d=1}^{T}(1 + r_d) - 1$$

- Pierwszy dzień z wpłatą początkową: `V_0 = 0`, `F_1 = wpłata` → `r_1 = V_1 / F_1 − 1`.
- Dzień z `V_{d−1} + F_d ≤ 0` (np. wypłata całości): okres zamykamy, kolejny zaczyna się od nowej wpłaty (łańcuch kontynuowany).
- Annualizacja tylko dla okresów ≥ 365 dni: `(1 + TWR)^{365/dni} − 1`; dla krótszych pokazujemy wartość skumulowaną.

### 6.3 MWR / XIRR (FR-03.06)

Stopa `x` spełniająca (ACT/365, perspektywa inwestora):

$$\sum_{k} \frac{CF_k}{(1 + x)^{(t_k - t_0)/365}} = 0$$

gdzie `CF_k` to wpłaty (−), wypłaty (+) i wartość końcowa (+) w dniu końca okresu; wartość początkowa (jeśli okres nie zaczyna się od zera) wchodzi jako wpłata w `t_0`.

Algorytm: Newton-Raphson od `x₀ = 0,1` (maks. 100 iteracji, tolerancja 1e-12), przy braku zbieżności — bisekcja na przedziale `[−0,9999; 10]`. Brak zmiany znaku → wynik `null` („nie da się wyznaczyć”). Okresy < 30 dni: XIRR niepokazywany (niestabilny).

### 6.4 Przykład B — TWR a XIRR (wektor `B_twr_xirr`)

| Data | Wartość przed przepływem | Przepływ `F` |
|---|---|---|
| 2025-01-01 | 0 | +10 000 |
| 2025-04-01 | 10 800 | +5 000 |
| 2025-07-01 | 15 200 | −2 000 |
| 2025-12-31 | 14 100 (koniec) | — |

Stopy podokresów: +8,000000 %, −3,797468 %, +6,818182 %. **TWR = 10,982739 %**, **XIRR = 8,658843 %** (wpłata 5 000 tuż przed spadkiem obniża wynik inwestora — to różnica, którą aplikacja ma tłumaczyć użytkownikowi, FR-06.02).

### 6.5 Porównanie z benchmarkiem (FR-03.07)

- **TWR benchmarku** — z serii cen (w PLN: cena × kurs), ta sama konwencja dni.
- **„Te same przepływy w benchmarku”:** każdy przepływ `F_d` kupuje (lub sprzedaje) `F_d / P_bench,PLN(d)` jednostek benchmarku; wynik: wartość końcowa i XIRR symulacji obok portfela. Benchmark bez kosztów transakcyjnych (założenie jawne).

### 6.6 Waluta stopy zwrotu
TWR/XIRR liczone w PLN (domyślnie) lub w walucie rachunku — z wycen i przepływów w tej walucie; parametr `currency` w API.

---

## 7. Obsunięcia (FR-03.09) — przykład C (wektor `C_drawdown`)

$$\text{DD}(t) = \frac{V^*(t)}{\max_{s \le t} V^*(s)} - 1$$

gdzie `V*` to indeks wartości z TWR (wartość skorygowana o przepływy), nie surowa wartość — inaczej wypłata wyglądałaby jak strata. Max drawdown = `min_t DD(t)`; czas trwania = od szczytu do dołka; czas odrabiania = od dołka do powrotu powyżej szczytu (lub „nie odrobiono”).

Przykład: indeks 100, 110, 105, 120, 90, 95, 130, 125 → **max DD = −25 %** (szczyt indeks 3, dołek 4, odrobienie 6); zgodne z empyrical.

---

## 8. Metryki ryzyka (FR-03.10) — przykład D (wektor `D_risk`)

Wejście: dzienne stopy zwrotu `r_t` z indeksu TWR (w PLN); `N` obserwacji; `P = 252`. Minimalna próba: 60 obserwacji — poniżej metryka oznaczona „mało danych”.

| Metryka | Definicja | Przykład D (20 obserwacji) |
|---|---|---|
| Zmienność roczna | `σ_r·√P`, `σ_r` — odchylenie standardowe próbkowe (`n−1`) | 12,6941 % |
| Sharpe | `mean(r − r_f) / std(r − r_f) · √P`; `r_f` dzienna: `(1 + R_f)^{1/P} − 1` | 1,885912 (R_f = 0); 1,501523 (R_f = 5 %) |
| Sortino | `mean(r − MAR)·P / (DD·√P)`, `DD = √(mean(min(r − MAR, 0)²))` po **wszystkich** obserwacjach, MAR = 0 | 2,793216 |
| Beta / korelacja | `cov(r, b)/var(b)` (n−1) / Pearson | 1,302072 / 0,996597 |
| VaR 95 % 1D historyczny | `−percentyl₅(r)` (interpolacja liniowa) | 1,2150 % |
| CVaR 95 % 1D | `−mean(r | r ≤ percentyl₅)` | 1,5000 % |
| VaR 95 % 1D parametryczny | `−(mean − 1,6449·σ)` (rozkład normalny) | 1,2203 % |
| Calmar | `CAGR / |max DD|` | — |

- **Stopa wolna od ryzyka** jest zawsze pokazywanym założeniem. Domyślnie: dla PLN — stopa referencyjna NBP wprowadzana przez admina jako szereg z datami obowiązywania; dla USD — rentowność 3M bonów skarbowych z FRED (`DGS3MO`). ❓ Źródło szeregu stopy referencyjnej NBP w formie API — do ustalenia w M3 (w razie braku: wpis ręczny).
- VaR skalowany do innych horyzontów regułą `√h` tylko z ostrzeżeniem („zakłada niezależność dziennych zwrotów”).
- Metryki liczone w `packages/core`; `analytics` liczy je tylko w raportach symulacji i jest weryfikowany tymi samymi wektorami.

---

## 9. Wskaźniki techniczne (FR-01.05) — przykład E (wektor `E_indicators_talib`)

Definicje zgodne z **TA-Lib 0.8.0** (w trybie domyślnym); `packages/core` musi dawać identyczne wartości (tolerancja 1e-8) i identyczny okres rozruchu (`null` na początku serii):

| Wskaźnik | Definicja | Pierwsza wartość (indeks w serii od 0) |
|---|---|---|
| SMA(n) | średnia arytmetyczna `n` ostatnich zamknięć | `n−1` |
| EMA(n) | `α = 2/(n+1)`; **ziarno = SMA(n) z pierwszych `n` wartości**; potem `EMA_t = α·C_t + (1−α)·EMA_{t−1}` | `n−1` (w przykładzie EMA5 = SMA5 = 44,104 na indeksie 4) |
| RSI(n) | wygładzanie Wildera: pierwsze średnie wzrostów/spadków = średnie arytmetyczne z pierwszych `n` zmian, potem `avg_t = (avg_{t−1}·(n−1) + x_t)/n`; `RSI = 100 − 100/(1 + avgGain/avgLoss)` | `n` |
| MACD(f, s, sig) | `EMA_f − EMA_s`; sygnał = `EMA_sig(MACD)`; histogram = MACD − sygnał; TA-Lib zwraca wszystkie trzy od tego samego indeksu | `s − 1 + sig − 1` (dla 3/6/3: 7) |
| Bollinger(n, k) | środek = SMA(n); pasma = środek ± `k·σ`, **σ populacyjne** (dzielnik `n`) | `n−1` |
| ATR(n) | `TR_t = max(H−L, |H−C_{t−1}|, |L−C_{t−1}|)`; pierwsze ATR = średnia `n` pierwszych TR (od indeksu 1), potem wygładzanie Wildera | `n` |
| Volume Profile (przybliżony, P3) | wolumen dnia rozłożony równomiernie na przedział [L, H] w koszyki cenowe | — |

Ostatnie wartości przykładu (20 zamknięć): SMA5 = 46,06; EMA5 = 45,99605362; RSI14 = 57,91502067; MACD(3,6,3) = −0,06356172 / sygnał 0,01949539; Bollinger(5,2): 46,57303021 / 46,06 / 45,54696979; ATR5 = 1,02719988.

**Zasada dla wykresów i alertów:** wskaźniki liczymy na **pełnych** danych (przed decymacją) i na cenach skorygowanych o splity; alerty i backtesty używają tych samych funkcji (FR-05.02, § 12.7).

---

## 10. Atrybucja wyniku (FR-03.08)

Dzienny wkład pozycji `i`: `c_{i,d} = w_{i,d−1} · r_{i,d}` (waga z końca poprzedniego dnia, stopa w PLN). Dla pozycji zagranicznej `1 + r^{PLN} = (1 + r^{lok})(1 + r^{FX})` → wkład rozbity na cenę (`w·r^{lok}`), walutę (`w·r^{FX}`) i składnik mieszany (`w·r^{lok}·r^{FX}`). Wkłady okresu łączymy geometrycznie metodą Cariño; residuum (zaokrąglenia) pokazujemy jawnie jako „łączenie”. Grupowanie: pozycja, sektor, waluta, klasa aktywów.

---

## 11. Statystyki skuteczności decyzji (FR-03.12)

Jednostka analizy: **zamknięta pozycja** (od pierwszego zakupu do sprzedaży do zera, FIFO).

| Statystyka | Wzór |
|---|---|
| Trafność `p` | liczba pozycji z P/L netto > 0 / liczba pozycji |
| Średni zysk / strata | średnia P/L netto pozycji zyskownych / stratnych |
| Expectancy | `p·śr_zysk − (1 − p)·|śr_strata|` |
| Profit factor | `Σ zysków / |Σ strat|` |
| R-multiple | `P/L / planowane ryzyko` (jeśli ryzyko zapisano w dzienniku) |
| Czas trzymania | mediana dni |

Próba < 20 pozycji → „mało danych”. UI rozdziela **ocenę procesu** (zgodność z tezą i planem z dziennika) od **wyniku** — dobra decyzja może przynieść stratę.

---

## 12. Analizy przyszłości — metodologia (FR-04)

Reguła nadrzędna (FR-04.01): każdy wynik to **rozkład** z blokiem założeń (dane, okno, model, koszty, podatki, ziarno losowe, wersja algorytmu), przedziałami, sekcją „ograniczenia” i disclaimerem. Zakaz prognoz punktowych i języka rekomendacji.

### 12.1 Monte Carlo (FR-04.02)

- **Jednostka symulacji:** portfel w PLN, krok miesięczny, horyzont 1–40 lat.
- **Mapowanie na klasy aktywów (domyślnie):** pozycje są mapowane na „proxy” o długiej historii (np. akcje GPW → WIG, akcje USA → S&P 500, gotówka → stopa wolna od ryzyka), bo historia pojedynczych spółek jest krótka i obciążona. Mapowanie edytowalne i zawsze widoczne.
- **Modele:** (a) *bootstrap stacjonarny* (Politis–Romano) miesięcznych stóp zwrotu **w PLN** (zachowuje korelacje i część autokorelacji; średnia długość bloku 6 mies.); (b) *parametryczny*: wielowymiarowy rozkład t-Studenta (ν = 5) z parametrami z historii lub z długoterminowych założeń wprowadzonych przez admina.
- **Okno historii:** domyślnie ≥ 20 lat dla proxy; przy krótszej historii — ostrzeżenie i obowiązkowa tabela wrażliwości.
- **Przepływy:** wpłaty/wypłaty (kwota, częstotliwość, indeksacja inflacją); podatek Belki od zrealizowanych zysków na rachunkach zwykłych (uproszczenie: podatek od stopy zwrotu przy wypłacie — jawne założenie); IKE/IKZE bez podatku do wypłaty.
- **Inflacja:** stała (parametr) lub scenariusz; wyniki nominalne i realne.
- **Wynik:** percentyle 5/25/50/75/95 wartości w czasie (wachlarz), `P(V_T ≥ cel)`, rozkład maksymalnego obsunięcia na ścieżkach, ryzyko sekwencji dla planu wypłat. Lewy ogon pokazywany jako pierwszy; mediana opisana „połowa scenariuszy poniżej”.
- **Tabela wrażliwości (obowiązkowa):** wyniki przy średniej rocznej −2 p.p. i +2 p.p. oraz przy oknie „ostatnie 10 lat” vs „całość”.
- **Odtwarzalność:** ziarno PRNG (PCG64), wersje bibliotek, zakres dat i identyfikatory serii zapisane z wynikiem.
- **Limity:** ≤ 10 000 ścieżek, ≤ 40 lat, czas ≤ 60 s.

### 12.2 Optymalizacja portfela (FR-04.03)

- **Domyślnie metody bez oczekiwanych stóp zwrotu:** minimalna wariancja i HRP; kowariancja z shrinkage Ledoit–Wolf; tylko pozycje długie; limit wagi 20 % na instrument (40 % przy < 5 instrumentach).
- **Max-Sharpe / efektywna granica:** dostępne jawnie, z ostrzeżeniem o błędzie estymacji; oczekiwane stopy z shrinkage (np. do średniej przekrojowej) lub z CAPM, nigdy „surowe średnie z 3 lat” bez ostrzeżenia.
- **Black–Litterman:** prior = wagi benchmarku (dla GPW ❓ wagi indeksów z GPW Benchmark lub wagi równe — oznaczone); poglądy użytkownika z pewnością (Ω) jawnie wpisaną.
- **Niepewność:** resampling (bootstrap historii, 200 powtórzeń) → przedziały 5–95 % dla każdej wagi; wagi pokazujemy jako przedziały, nie jako „wynik optymalny”.
- **Wynik jest analizą, nie zaleceniem**: przejście do kalkulatora rebalancingu wymaga świadomego kliknięcia i pokazuje koszty.

### 12.3 Testy warunków skrajnych (FR-04.04)

Scenariusze historyczne (definicje konfiguracyjne w `analytics.stress_scenarios`, edytowalne przez admina):

| Klucz | Okres | Opis |
|---|---|---|
| `gfc_2008` | 2008-09-01 → 2009-03-09 | kryzys finansowy |
| `covid_2020` | 2020-02-19 → 2020-03-23 | krach pandemiczny |
| `inflation_2022` | 2022-01-03 → 2022-10-12 | inflacja i podwyżki stóp |

Metoda: stopy zwrotu proxy w oknie (w PLN, z kursami NBP), zastosowane do bieżących wag; brak historii instrumentu → jawne proxy; pokrycie < 80 % wartości → odmowa z wyjaśnieniem. Scenariusze hipotetyczne: szok indeksu (−X %), szok kursu USD/PLN (±Y %), szok korelacji (korelacje → 0,9) — z mapą wrażliwości (beta pozycji do czynnika).

### 12.4 „Co jeśli” (FR-04.05)

Porównanie „przed/po” na tym samym oknie (domyślnie 3 lata tygodniowo): zmienność, max DD, udział największej pozycji, średnia korelacja, udział walut. Brak prognoz zwrotu.

### 12.5 Kalkulator rebalancingu (FR-04.06) — przykład H (wektor `H_rebalance`)

Wejście: wagi docelowe `t_i` (suma 1), pasmo tolerancji (domyślnie ±5 p.p.), tryb (`full` / `buy_only`), nowa gotówka, minimalna wartość zlecenia, podzielność (całe akcje GPW; ułamki tylko gdy broker obsługuje), model kosztów (§ 12.7), rachunek (skutek podatkowy FIFO dla sprzedaży na rachunku zwykłym).

Algorytm: (1) `W = Σ V_i + gotówka`; (2) instrumenty z `|w_i − t_i| ≤ pasmo` pomijamy; (3) `full`: transakcja `t_i·W − V_i`; `buy_only`: nowa gotówka rozdzielana proporcjonalnie do dodatnich luk `max(0, t_i·W − V_i)`; (4) zaokrąglenie do podzielności (kupno w dół, sprzedaż do najbliższej), resztę gotówki ponownie przydzielamy; (5) koszty i szacowany podatek; (6) wagi po transakcjach. **Blokada:** brak uzgodnionego importu w ostatnich 7 dniach lub otwarte różnice uzgodnienia → kalkulator pokazuje ostrzeżenie i nie generuje listy (wynik przeglądu `strategy-critique`, § 13.2).

Przykład: A 7 000 / B 3 000, cel 60/40 → `full`: A −1 000, B +1 000; `buy_only` z nową gotówką 2 000 → A +200, B +1 800 → 60,00 % / 40,00 %.

### 12.6 Kalkulator celu (FR-04.09)

Wyszukiwanie binarne miesięcznej wpłaty `c`, dla której `P(V_T ≥ cel) ≥ p` w symulacji MC (te same ścieżki losowe dla każdego `c` — metoda wspólnych liczb losowych); wynik dla `p` = 50 / 75 / 90 %.

### 12.7 Backtest (FR-04.08)

| Element | Reguła |
|---|---|
| Dane | EOD; ceny skorygowane o splity dla sygnałów, ceny surowe + zdarzenia korporacyjne do rozliczeń |
| **Uniwersum point-in-time** | GPW: z dziennych plików archiwum GPW (zawierają spółki później wycofane) — uniwersum na dzień `d` = spółki notowane w `d`; USA: brak darmowego uniwersum historycznego → domyślnie tylko ETF/indeksy, dla spółek obowiązkowe ostrzeżenie o survivorship bias |
| Wykonanie | sygnał z zamknięcia `d` → realizacja po **otwarciu `d+1`** (archiwum GPW i Yahoo podają kurs otwarcia) |
| Wielkość pozycji | reguła jawna (równe wagi / stała frakcja / cel zmienności); bez dźwigni; Kelly ≤ 0,25 lub wyłączony |
| Płynność | pozycja ≤ 5 % mediany obrotu dziennego z 20 sesji; instrumenty z medianą obrotu < 100 tys. PLN wykluczone |
| Koszty — prowizja | XTB: 0 % do 100 000 EUR miesięcznego obrotu, potem 0,2 % (min. 10 EUR); inni brokerzy — tabela konfiguracyjna |
| Koszty — przewalutowanie | 0,5 % kursu mid na każdą konwersję (kupno i sprzedaż instrumentu w USD na rachunku PLN ≈ 1 % za cykl) |
| Koszty — poślizg | połowa spreadu wg koszyka płynności (mediana obrotu dziennego): ≥ 10 mln PLN → 0,05 %; 1–10 mln → 0,15 %; 0,1–1 mln → 0,50 % (parametry konfigurowalne; ❓ skalibrować na danych w M5b) |
| Podatki | opcjonalnie 19 % od zrealizowanych zysków na rachunku zwykłym (rozliczenie roczne, bez przenoszenia strat między latami w MVP — uproszczenie jawne) |
| Walidacja | podział in-sample / out-of-sample (domyślnie 70/30, bez tasowania) + walk-forward (okno dopasowania 3 lata, test 1 rok, krok 1 rok); optymalizacja parametrów **tylko** wewnątrz okien dopasowania |
| Przeuczenie | raport liczby testowanych kombinacji `N`; **Deflated Sharpe Ratio** (Bailey, López de Prado 2014); flaga, gdy wynik OOS < 60 % wyniku IS; domyślny tryb „bez optymalizacji” |
| Reżimy | tabela wyników per okres (m.in. 2008, 2011, 2020, 2022, 2023–2024) i per stan rynku (trend wzrostowy/spadkowy/boczny) |
| Test anty-look-ahead | automatyczny: modyfikacja danych po dniu `d` nie może zmienić sygnałów ≤ `d` |

**Deflated Sharpe Ratio** (dla `N` prób, `T` obserwacji, skośności `γ₃` i kurtozy `γ₄` zwrotów strategii, nieannualizowanego `SR̂`):

$$\text{DSR} = \Phi\!\left(\frac{(\widehat{SR} - SR_0)\sqrt{T-1}}{\sqrt{1 - \gamma_3\widehat{SR} + \frac{\gamma_4 - 1}{4}\widehat{SR}^2}}\right),\quad SR_0 = \sqrt{V[\{SR_n\}]}\left((1-\gamma)\Phi^{-1}\!\left(1-\tfrac{1}{N}\right) + \gamma\,\Phi^{-1}\!\left(1-\tfrac{1}{N e}\right)\right)$$

gdzie `γ ≈ 0,5772` (stała Eulera–Mascheroniego), `V[{SR_n}]` — wariancja Sharpe'ów testowanych wariantów. DSR < 0,95 → komunikat „wynik nieodróżnialny od szczęścia przy tej liczbie prób”.

---

## 13. Przegląd metodologiczny (skille krytyczne, §6.4 specyfikacji)

Projekt funkcji z § 12 przejrzano skillami `backtest-review` i `strategy-critique` (2026-09-19). Wnioski zostały wprowadzone do reguł powyżej.

### 13.1 `backtest-review` — werdykt: **FIX** (po uzupełnieniach: zasadny)

| Punkt | Wynik przeglądu | Wprowadzona poprawka |
|---|---|---|
| Look-ahead | brak konwencji wykonania | zamknięcie `d` → otwarcie `d+1`; test anty-look-ahead; wskaźniki przyczynowe |
| Survivorship | uniwersum = dzisiejsze spółki | uniwersum point-in-time z archiwum GPW; ostrzeżenie dla USA |
| Przeuczenie | sam limit 500 kombinacji nie wystarcza | raport `N`, DSR, flaga OOS/IS, walk-forward, domyślnie bez optymalizacji |
| Koszty | brak spreadu/poślizgu, FX liczony raz | koszyki płynności, FX przy obu konwersjach, próg 100 tys. EUR, podatek |
| Reżimy | nieokreślone | obowiązkowa tabela per okres i stan rynku |
| Pozycjonowanie | do doprecyzowania | jawna reguła, bez dźwigni, Kelly ≤ 0,25 |
| Wykonanie | brak limitu płynności | ≤ 5 % mediany obrotu, wykluczenie niepłynnych |

### 13.2 `strategy-critique` — ocena ryzyka: **MEDIUM** (ryzyko behawioralne i regulacyjne, nie finansowe z dźwigni)

| Ryzyko | Mitygacja w tym dokumencie |
|---|---|
| Krótka historia (hossa) zawyża medianę MC | proxy z długą historią, okno ≥ 20 lat, tabela wrażliwości (§ 12.1) |
| Max-Sharpe maksymalizuje błąd estymacji | domyślnie min-variance/HRP, shrinkage, limity wag, przedziały wag (§ 12.2) |
| Pominięcie ryzyka USD/PLN | symulacje w PLN na zwrotach przeliczonych kursami NBP (§ 12.1, § 12.3) |
| Błędne dane (nieskorygowany split) zatruwają próbkę | blokada analiz na seriach z otwartymi problemami jakości (§ 14) |
| Test skrajny „znika” przez brak historii | jawne proxy, próg pokrycia 80 % (§ 12.3) |
| Percentyle czytane jak obietnica | lewy ogon pierwszy, język rozkładów, disclaimer (§ 12.1) |
| Pominięcie podatku zawyża procent składany | podatek Belki w modelu dla rachunków zwykłych (§ 12.1, § 12.7) |
| Rebalancing na nieuzgodnionych danych | blokada przy starym imporcie lub różnicach uzgodnienia (§ 12.5) |
| Brak nauki na decyzjach | powiązanie uruchomień analiz z dziennikiem transakcji (`analytics_runs.journal_entry_id`) |

Pytania do właściciela rozstrzygnięte domyślnie (do zmiany decyzją w ADR): (1) MC domyślnie na proxy z długą historią + wrażliwość; (2) max-Sharpe nie jest domyślny; (3) rebalancing blokowany przy nieuzgodnionych danych.

---

## 14. Jakość danych jako warunek obliczeń (NFR-08.04, skill `data-scrub`)

Każda seria EOD przechodzi przy zapisie kontrole; wynik trafia do `market.data_quality_issues`, a seria z problemem `BLOCK` nie jest używana w analizach FR-04 (UI pokazuje powód):

| Kontrola | Warunek | Ważność |
|---|---|---|
| Integralność OHLC | `L ≤ min(O, C)`, `H ≥ max(O, C)`, `L ≤ H`, wolumen ≥ 0 | BLOCK |
| Duplikaty i monotoniczność | jedna świeca na (instrument, data) | BLOCK |
| Luki | brak świecy w dniu sesyjnym wg `trading_calendar` przy notowaniu instrumentu | WARN |
| Świece „martwe” | wolumen 0 i `O = H = L = C` przez > 5 sesji | WARN |
| Skoki | `|r| > 25 %` bez zdarzenia korporacyjnego tego dnia | BLOCK do wyjaśnienia (admin: potwierdź / oznacz split) |
| Wolumen | > 20× mediany z 30 sesji | INFO |
| Waluta / ISIN | zmiana waluty lub ISIN instrumentu | BLOCK |

---

## 15. Wektory testowe

Plik [`wektory-testowe.json`](wektory-testowe.json) zawiera dane wejściowe i oczekiwane wyniki przykładów A–H (klucze `A_fifo_fx`, `B_twr_xirr`, `C_drawdown`, `D_risk`, `E_indicators_talib`, `F_day_change`, `G_dividend`, `H_rebalance`). W M1 przenosimy go do `packages/test-vectors/`; testy Vitest (`packages/core`) i pytest (`apps/analytics`) czytają ten sam plik i stosują tolerancje z § 0.5. Nowy wzór = nowy wektor.

Zależności referencyjne do testów: TA-Lib ≥ 0.8.0 i **empyrical-reloaded ≥ 0.5.12** (starsze wersje odwołują się do `np.NINF`, usuniętego w NumPy 2.0 — zweryfikowano 2026-09-19).
