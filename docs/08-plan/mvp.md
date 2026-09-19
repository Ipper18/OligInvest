# MVP — najmniejszy użyteczny zakres (etap M1)

**Cel:** określić bezlitośnie, co musi działać w pierwszej wersji używanej na co dzień, co świadomie odkładamy i co wycinamy najpierw, gdy etap się przeciąga — tak, aby MVP dało się skończyć i sprawdzić na realnym wyciągu XTB.

Powiązane: [`roadmapa.md`](roadmapa.md) § 3 (kryteria wyjścia M1), [`backlog.md`](backlog.md) § 2 (zadania `BL-101`–`BL-156`), [`../00-przeglad/wizja-produktu.md`](../00-przeglad/wizja-produktu.md) § 8 (miary sukcesu), [`../00-przeglad/wymagania.md`](../00-przeglad/wymagania.md) (priorytety P0).

## 1. Hipoteza

Po zaimportowaniu wyciągu z XTB właściciel widzi w PLN poprawną wartość portfela, zysk lub stratę (zrealizowane i niezrealizowane) oraz wynik dnia — na telefonie, w mniej niż 2 sekundy — i przestaje sprawdzać to w arkuszu i w aplikacji brokera.

Sprawdzamy ją po 4 tygodniach używania (§ 5). Jeśli się nie potwierdzi, kolejne etapy zmieniamy, zanim zaczniemy M2.

## 2. W zakresie

MVP ma dwie bramy ([`roadmapa.md`](roadmapa.md) § 3): **brama A** — aplikacja gotowa do codziennego użytku przez właściciela (ok. 86 d), **brama B** — wymogi prawne i operacyjne przed zaproszeniem innych osób (ok. 17 d). Wiersz „wymagane przed zaproszeniem innych” należy w większości do bramy B.

| Obszar | Wymagania | Co dokładnie |
|---|---|---|
| Konto i bezpieczeństwo | FR-07.01, FR-07.02, FR-07.04, FR-07.06 (model ról), FR-07.10, FR-07.12 | rejestracja z zaproszenia z akceptacją regulaminu, hasło (Argon2id, wycieki), obowiązkowy TOTP i kody zapasowe, reset hasła, role `user`/`pro`/`admin`, bramki MFA i regulaminu, step-up |
| — wymagane przed zaproszeniem innych | FR-07.05, FR-07.08 (motyw, paleta), FR-07.09, NFR-03.10 | lista sesji i wylogowanie zdalne; tryb jasny/ciemny i paleta dla daltonistów (NFR-06.02); eksport i usunięcie konta; e-mail o nowym urządzeniu |
| Administracja minimalna | FR-08.01 (zaproszenia, role), FR-08.05 (zapis audytu), FR-08.10 | powłoka `/admin` z zaproszeniami i rolami; polecenia CLI z [`../06-bezpieczenstwo/plan-reagowania.md`](../06-bezpieczenstwo/plan-reagowania.md) § 4 |
| Portfel | FR-02.01–FR-02.04, FR-02.07, FR-02.09 | rachunki (zwykły/IKE/IKZE), pozycje, gotówka per waluta, wycena opóźniona/EOD przez SSE, P/L zrealizowany FIFO w widoku ekonomicznym i podatkowym, wynik dnia |
| Operacje | FR-03.01 (XTB), FR-03.03, FR-03.05 (FIFO) | import XTB z podglądem, mapowaniem, deduplikacją i uzgodnieniem; ręczne operacje; partie FIFO |
| Rynek | FR-01.01–FR-01.03, FR-01.14, FR-01.15 | wyszukiwarka, karta instrumentu, wykres świecowy EOD z wolumenem, kursy NBP, status i wiek danych |
| Zgodność | FR-04.01 (komponenty), NFR-07.01, NFR-07.03, NFR-07.04 | `<Disclaimer/>`, `<DataFreshness/>`, `<AssumptionsBlock/>` gotowe od początku; strona „Źródła danych i licencje”; dane tylko dla zalogowanych |
| Jakość | NFR P0 | budżety wydajności w CI, RLS, CSP z nonce, WCAG 2.1 AA (axe + VoiceOver), testy wzorów na wektorach, kopie zapasowe z pierwszym testem odtworzenia |

## 3. Poza MVP (świadomie)

| Funkcja | Dlaczego nie teraz | Etap |
|---|---|---|
| Import mBank (FR-03.02) | właściciel używa głównie XTB; drugi parser nie zmienia hipotezy | M2 |
| Wskaźniki techniczne, watchlisty, indeksy (FR-01.05, FR-01.08, FR-01.09) | wykres świecowy wystarcza do sprawdzenia pozycji | M2 |
| Alokacja, ekspozycja walutowa, widok dywidend, historia wartości (FR-02.05, FR-02.06, FR-02.08, FR-02.10) | dywidendy i tak wchodzą z importu do gotówki i P/L; osobne widoki to wygoda | M2–M3 |
| Wyjaśnienia kontekstowe, glosariusz i onboarding (FR-06.02, FR-06.03, FR-06.01) | MVP ma krótkie opisy pól; pełne wyjaśnienia razem ze wskaźnikami | M2 |
| TWR, XIRR, benchmark, obsunięcia (FR-03.06, FR-03.07, FR-03.09) | wymagają historii wycen z kilku miesięcy — zbieramy ją od M1 | M3 |
| Analizy przyszłości (FR-04.02–FR-04.09) | największe ryzyko metodologiczne i regulacyjne; najpierw poprawne dane | M3, M5b |
| Alerty, instalowalna PWA, push, tokeny PAT, Skróty (FR-05, FR-07.07, FR-09) | aplikacja działa w przeglądarce telefonu; „w kieszeni” to osobny etap | M4 |
| Pełny panel admina i tryb demo (FR-08.02–FR-08.09, FR-06.04) | kilku znanych użytkowników — administrator zaprasza i pomaga osobiście | M5a |
| OAuth, migawka offline, passkeys (FR-07.03, FR-09.02, FR-07.11) | dodatkowe ryzyka bez wpływu na hipotezę | M5b, później |

## 4. Cięcia awaryjne

Jeśli M1 przekroczy estymację o więcej niż 30 %, wycinamy w tej kolejności (każde cięcie zapisujemy w backlogu jako odchylenie):

1. Wykres świecowy tylko w interwale 1D (bez agregacji 1W/1M).
2. Wyszukiwarka tylko w lokalnym katalogu instrumentów (bez dopytywania dostawcy w tle).
3. Notowania intraday z Yahoo wyłączone flagą — wycena z EOD, z etykietą.
4. Ręczne operacje ograniczone do: kupno, sprzedaż, dywidenda, wpłata, wypłata, opłata (reszta typów — M2).
5. Widok podatkowy P/L przeniesiony do M2 (zostaje widok ekonomiczny z disclaimerem).

**Nigdy nie wycinamy:** bramki MFA i RLS, dokumentów prawnych i praw RODO, kopii zapasowych z testem odtworzenia, uzgodnienia z brokerem, budżetów wydajności, disclaimerów.

## 5. Sukces MVP (po 4 tygodniach używania)

| Miara | Cel |
|---|---|
| Użycie przez właściciela | ≥ 3 sesje tygodniowo (liczniki w bazie, bez zewnętrznej analityki) |
| Zgodność z brokerem | każdy miesięczny import bez ręcznych poprawek; P/L ±0,01 PLN lub wyjaśnienie |
| Wydajność w terenie | RUM (za zgodą) p75 LCP < 2,0 s, INP < 200 ms na telefonie |
| Niezawodność | brak utraty danych; test odtworzenia zaliczony; dostępność ≥ 99 % w miesiącu |
| Zaufani użytkownicy | co najmniej jedna zaproszona osoba samodzielnie zaimportowała plik i skonfigurowała TOTP |

Ryzyka specyficzne dla MVP: błędy obliczeń (R-07), zmiana formatu eksportu XTB (R-08), niedoszacowanie (R-16) — [`ryzyka.md`](ryzyka.md).
