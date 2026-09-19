# Macierz pokrycia wymagań

**Cel:** wykazać, że każde wymaganie ze specyfikacji (§ 3–4) i każde wymaganie FR/NFR ma projekt w dokumentacji i zadanie w backlogu — wymaganie → dokument → zadanie → etap — oraz jawnie wypisać luki i otwarte weryfikacje po przeglądzie spójności całości (Krok 7).

Powiązane: [`wymagania.md`](wymagania.md) (źródło FR/NFR), [`specyfikacja-zrodlowa.md`](specyfikacja-zrodlowa.md), [`../08-plan/backlog.md`](../08-plan/backlog.md), [`../08-plan/roadmapa.md`](../08-plan/roadmapa.md), [`../08-plan/ryzyka.md`](../08-plan/ryzyka.md).

## 0. Metoda

- Stan na **2026-09-19**. Macierz wygenerowano skryptem z trzech źródeł: tabel [`wymagania.md`](wymagania.md), zadań z [`../08-plan/backlog.md`](../08-plan/backlog.md) (kolumna „Wymagania”) i wystąpień identyfikatorów w dokumentach projektowych (`docs/` bez planu i specyfikacji, razem z `openapi.yaml` i `schema.sql`; zakresy typu „FR-04.02–FR-04.09” są rozwijane).
- **Status:** ✅ — wymaganie ma co najmniej jeden dokument projektowy i co najmniej jedno zadanie; ⚠️ — ma zadanie, ale żaden dokument go nie przywołuje; ❌ — brak zadania.
- Aktualność pilnuje zadanie **BL-035** (test spójności w CI: każde FR/NFR ma zadanie w backlogu i wiersz w tej macierzy, linki wewnętrzne działają, dokumenty zaczynają się od „Cel:”). Po zmianie wymagań lub backlogu macierz aktualizuje się w tym samym PR.

## 1. Specyfikacja (§ 3–4) → wymagania

Każdy element z sekcji 3 i 4 specyfikacji źródłowej ([`specyfikacja-zrodlowa.md`](specyfikacja-zrodlowa.md)) ma wymagania z identyfikatorem; status to najsłabszy status tych wymagań w § 2.

| § | Element specyfikacji | Wymagania | Etapy | Status |
|---|---|---|---|---|
| 3.1.1 | Notowania (w UE bez czasu rzeczywistego — Z-01), karta instrumentu, status danych | FR-01.01, FR-01.02, FR-01.04, FR-01.15 | M1, M5a | ✅ |
| 3.1.1 | Wykresy świecowe ze wskaźnikami SMA/EMA/RSI/MACD/Bollinger/ATR | FR-01.03, FR-01.05, FR-01.07 | M1, M2 | ✅ |
| 3.1.1 | Volume Profile | FR-01.06 | Później | ✅ |
| 3.1.1 | Heatmapy sektorowe | FR-01.10 | M5a | ✅ |
| 3.1.1 | Screener | FR-01.11 | M5a | ✅ |
| 3.1.1 | Kalendarz wyników spółek i danych makro | FR-01.12 | M5a | ✅ |
| 3.1.1 | Newsy z oceną sentymentu | FR-01.13 | Później | ✅ |
| 3.1.2 | Pozycje, wycena, P/L zrealizowany i niezrealizowany | FR-02.01, FR-02.02, FR-02.03, FR-02.04, FR-02.07, FR-02.09 | M1 | ✅ |
| 3.1.2 | Alokacja (klasa aktywów, sektor, geografia, waluta) | FR-02.05 | M2 | ✅ |
| 3.1.2 | Dywidendy | FR-02.08 | M3 | ✅ |
| 3.1.2 | Ekspozycja walutowa PLN/USD/EUR | FR-02.06, FR-01.14 | M1, M2, M3 | ✅ |
| 3.1.3 | Import transakcji (CSV od brokera i ręcznie) | FR-03.01, FR-03.02, FR-03.03, FR-03.04 | M1, M2, M5b | ✅ |
| 3.1.3 | TWR i MWR/XIRR | FR-03.06 | M3 | ✅ |
| 3.1.3 | Cost basis (FIFO/średnia) | FR-03.05 | M1, M3 | ✅ |
| 3.1.3 | Benchmark względem indeksu | FR-03.07 | M3 | ✅ |
| 3.1.3 | Atrybucja wyniku | FR-03.08 | M5b | ✅ |
| 3.1.3 | Obsunięcia (drawdowny) | FR-03.09, FR-03.10 | M3, M5b | ✅ |
| 3.1.3 | Dziennik transakcji z postmortem | FR-03.11 | M3 | ✅ |
| 3.1.3 | Statystyki skuteczności decyzji | FR-03.12 | M5b | ✅ |
| 3.1.4 | Scenariusze i rozkłady zamiast prognoz; zakazy; przegląd metodologiczny | FR-04.01, NFR-07.01, NFR-07.02 | M0, M3, M5b | ✅ |
| 3.1.4 | Symulacja Monte Carlo (i kalkulator celu) | FR-04.02, FR-04.09 | M3, M5b | ✅ |
| 3.1.4 | Optymalizacja portfela (Markowitz, Black-Litterman, risk parity) | FR-04.03 | M5b | ✅ |
| 3.1.4 | Testy warunków skrajnych | FR-04.04 | M5b | ✅ |
| 3.1.4 | Analiza „co jeśli” | FR-04.05 | M5b | ✅ |
| 3.1.4 | Kalkulator rebalancingu | FR-04.06 | M3 | ✅ |
| 3.1.4 | Screening kandydatów według kryteriów użytkownika | FR-04.07 | M5b | ✅ |
| 3.1.4 | Backtest strategii | FR-04.08 | M5b | ✅ |
| 3.1.5 | Alerty cenowe i na wskaźnikach | FR-05.01, FR-05.02 | M4, M5b | ✅ |
| 3.1.5 | Alerty na wynikach (portfela i spółek) i na newsach | FR-05.03, FR-05.04, FR-05.05 | M5b, Później | ✅ |
| 3.1.5 | Kanały: push i e-mail; treść bez rekomendacji | FR-05.06, FR-05.07, FR-09.03 | M4 | ✅ |
| 3.1.6 | Interaktywny onboarding | FR-06.01 | M2 | ✅ |
| 3.1.6 | Kontekstowe wyjaśnienia wskaźników | FR-06.02, FR-01.07 | M2 | ✅ |
| 3.1.6 | Tryb demo z danymi sandbox | FR-06.04 | M5a | ✅ |
| 3.1.6 | Glosariusz i nauka inwestowania | FR-06.03, FR-06.05, FR-06.06 | M2, M3, M5a, Później | ✅ |
| 3.2 | Rejestracja i logowanie e-mailem i hasłem | FR-07.01, FR-07.02, FR-07.10, FR-07.12 | M1 | ✅ |
| 3.2 | OAuth (Google, GitHub) | FR-07.03 | M5b | ✅ |
| 3.2 | Obowiązkowe 2FA (TOTP) | FR-07.04, FR-07.05, FR-07.07 | M1, M4 | ✅ |
| 3.2 | Role user/pro/admin, RBAC | FR-07.06 | M1, M3 | ✅ |
| 3.2 | Panel admina: użytkownicy, sesje, limity API, flagi, audyt, integracje, kolejki, health | FR-08.01, FR-08.02, FR-08.03, FR-08.04, FR-08.05, FR-08.06, FR-08.07, FR-08.08, FR-08.09 | M1, M2, M5a | ✅ |
| 3.2 | Pełny audit log działań administracyjnych | FR-08.10 | M1 | ✅ |
| 4.1 | LCP < 2,0 s, INP < 200 ms, CLS < 0,1 na 4G i średnim telefonie | NFR-01.01 | M1, M5a, M6 | ✅ |
| 4.1 | Initial JS < 200 KB gzip, code splitting, brak eager-loadingu wykresów i analityki | NFR-01.02, NFR-01.03 | M0, M1 | ✅ |
| 4.1 | Wykresy: wirtualizacja, decymacja, canvas | NFR-01.04 | M1 | ✅ |
| 4.1 | Budżety w dokumencie i egzekwowane w CI | NFR-01.01, NFR-01.02 | M0, M1, M5a, M6 | ✅ |
| 4.1 | Co ładuje się po stronie serwera, klienta i strumieniowo | NFR-01.05, NFR-01.06, NFR-01.07, NFR-01.08 | M0, M1, M2, M3, M6 | ✅ |
| 4.1 | Konflikty wydajności z funkcjami zgłaszane jawnie | NFR-01.09 | M6 | ✅ |
| 4.2 | Monorepo z podziałem apps/packages (+ modules) | NFR-02.01 | M0 | ✅ |
| 4.2 | Moduły z własnym API, modelem i możliwością usunięcia | NFR-02.02, NFR-02.03 | M0, M1 | ✅ |
| 4.2 | Feature flagi i checklista dodania modułu | NFR-02.07, FR-08.04 | M0, M1, M5a | ✅ |
| 4.2 | Dostawcy danych jako adaptery | NFR-02.04 | M1, M2 | ✅ |
| 4.2 | Wersjonowanie API i polityka breaking changes | NFR-02.05 | M0 | ✅ |
| 4.3 | STRIDE per moduł, OWASP Top 10, ASVS L2 | NFR-03.01 | M6 | ✅ |
| 4.3 | Hasła (Argon2id), sesje, rotacja, credential stuffing, lockout, 2FA | NFR-03.02, NFR-03.03, FR-07.04 | M0, M1 | ✅ |
| 4.3 | RBAC + Row Level Security | NFR-03.04, NFR-03.05, FR-07.06 | M0, M1, M3 | ✅ |
| 4.3 | TLS 1.3, HSTS, szyfrowanie at-rest, sekrety | NFR-03.06, NFR-03.08 | M0, M1, M6 | ✅ |
| 4.3 | Nagłówki (CSP bez unsafe-inline i inne) | NFR-03.06 | M0, M1, M6 | ✅ |
| 4.3 | Walidacja wejścia, SQLi/XSS/CSRF/SSRF, sanityzacja danych z API | NFR-03.07 | M0, M1, M6 | ✅ |
| 4.3 | Łańcuch dostaw: pinowanie, Renovate, SCA, SBOM, podpisy obrazów | NFR-03.09 | M0, M6 | ✅ |
| 4.3 | Logowanie, wykrywanie anomalii, plan reagowania | NFR-03.10 | M1, M6 | ✅ |
| 4.3 | RODO: podstawa, retencja, eksport i usunięcie | FR-07.09, NFR-11.01, NFR-11.02, NFR-11.03 | M0, M1 | ✅ |
| 4.3 | Kopie 3-2-1, szyfrowane, przetestowany plan odtwarzania (RPO/RTO) | NFR-09.03 | M0, M1, M6 | ✅ |
| 4.3 | Hardening: firewall, CrowdSec, SSH kluczami, kontenery bez uprawnień, certyfikaty | NFR-03.11, NFR-03.12, NFR-03.13 | M0, M1, M3 | ✅ |
| 4.4 | PWA: instalacja, offline, push | FR-09.01, FR-09.02, FR-09.03, NFR-04.01, NFR-04.02 | M0, M1, M4, M5b | ✅ |
| 4.4 | Analiza PWA / Capacitor / React Native i ścieżka 0 zł | NFR-04.03 | M4 | ✅ |
| 4.4 | iOS: Skróty, Stuknięcie w tył, Siri, automatyzacje, widżety; akcje i instrukcja | FR-09.04, FR-09.05, FR-09.08 | M4, Później | ✅ |
| 4.4 | Android: widżety, kafelek, deep linki, Tasker | FR-09.06, FR-09.07 | M4 | ✅ |
| 4.4 | Wspólna logika w packages/core | NFR-04.04, NFR-02.06 | M0, M1, M3 | ✅ |
| 4.5 | Budżet 0 zł, wyjątki z kosztem, substytutem i stratą | NFR-05.01, NFR-05.02, NFR-05.03 | M1, M6 | ✅ |

Wymagania bez elementu w tabeli (pochodzą z §5–6 specyfikacji: dostępność, zgodność, poprawność obliczeń, utrzymanie): 25 — są w § 2.

## 2. Macierz: wymaganie → dokumenty → zadania

Kolumna „Dokumenty” pokazuje do trzech dokumentów projektowych, które najczęściej przywołują identyfikator (liczba w nawiasie — kolejne); „Zadania” — zadania z [`../08-plan/backlog.md`](../08-plan/backlog.md).

### FR-01 Analiza rynku (§3.1.1)

| ID | Wymaganie (skrót) | P | Dokumenty | Zadania | Etap | Status |
|---|---|---|---|---|---|---|
| FR-01.01 | Wyszukiwarka instrumentów po tickerze, nazwie i ISIN (akcje i ETF z GPW i … | P0 | [openapi.yaml](../02-api/openapi.yaml), [mapa-ekranow](../04-frontend/mapa-ekranow.md) | BL-135 | M1 | ✅ |
| FR-01.02 | Karta instrumentu: ostatni kurs, zmiana dzienna (kwotowo i %), wolumen … | P0 | [openapi.yaml](../02-api/openapi.yaml), [mapa-ekranow](../04-frontend/mapa-ekranow.md), [ADR-005](../09-decyzje/ADR-005-strategia-danych-rynkowych.md) | BL-134, BL-137 | M1 | ✅ |
| FR-01.03 | Wykres świecowy OHLC z wolumenem: interwały 1D/1W/1M z historii EOD (≥ 10 … | P0 | [ADR-009](../09-decyzje/ADR-009-wykresy.md), [openapi.yaml](../02-api/openapi.yaml), [mapa-ekranow](../04-frontend/mapa-ekranow.md) (+1) | BL-133, BL-138 | M1 | ✅ |
| FR-01.04 | Interwały intraday (15 min, 1 h) z danych opóźnionych — dla instrumentów, dla … | P2 | [ADR-005](../09-decyzje/ADR-005-strategia-danych-rynkowych.md), [openapi.yaml](../02-api/openapi.yaml), [mapa-ekranow](../04-frontend/mapa-ekranow.md) (+1) | BL-516 | M5a | ✅ |
| FR-01.05 | Wskaźniki techniczne: SMA, EMA, wstęgi Bollingera (nakładki), RSI, MACD, ATR … | P1 | [openapi.yaml](../02-api/openapi.yaml), [obliczenia-finansowe](../03-dane/obliczenia-finansowe.md), [mapa-ekranow](../04-frontend/mapa-ekranow.md) (+2) | BL-201, BL-202 | M2 | ✅ |
| FR-01.06 | Volume Profile w wersji przybliżonej z barów dziennych, jawnie oznaczony jako … | P3 | [ADR-009](../09-decyzje/ADR-009-wykresy.md), [openapi.yaml](../02-api/openapi.yaml), [mapa-ekranow](../04-frontend/mapa-ekranow.md) | BL-701 | Później | ✅ |
| FR-01.07 | Kontekstowe wyjaśnienie każdego wskaźnika (co mierzy, jak czytać, pułapki)  … | P1 | [mapa-ekranow](../04-frontend/mapa-ekranow.md) | BL-203 | M2 | ✅ |
| FR-01.08 | Watchlisty: wiele list, dodawanie/usuwanie, kolejność, notatka przy … | P1 | [openapi.yaml](../02-api/openapi.yaml), [mapa-ekranow](../04-frontend/mapa-ekranow.md) | BL-205 | M2 | ✅ |
| FR-01.09 | Indeksy i benchmarki: WIG20, WIG, mWIG40, sWIG80, S&P 500, Nasdaq-100 (oraz … | P1 | [openapi.yaml](../02-api/openapi.yaml), [mapa-ekranow](../04-frontend/mapa-ekranow.md) | BL-206 | M2 | ✅ |
| FR-01.10 | Heatmapa sektorowa: GPW (sektory wg subindeksów sektorowych), USA (sektory wg … | P2 | [openapi.yaml](../02-api/openapi.yaml), [mapa-ekranow](../04-frontend/mapa-ekranow.md), [ADR-009](../09-decyzje/ADR-009-wykresy.md) | BL-513 | M5a | ✅ |
| FR-01.11 | Screener z kryteriami użytkownika (cena, zmiana %, wolumen/obrót, wskaźniki … | P2 | [openapi.yaml](../02-api/openapi.yaml), [mapa-ekranow](../04-frontend/mapa-ekranow.md), [11-zgodnosc-prawna](../11-zgodnosc-prawna.md) | BL-514 | M5a | ✅ |
| FR-01.12 | Kalendarz: wyniki spółek (USA z dostawcy; GPW — wpisy admina) i dane makro … | P2 | [openapi.yaml](../02-api/openapi.yaml), [mapa-ekranow](../04-frontend/mapa-ekranow.md) | BL-515 | M5a | ✅ |
| FR-01.13 | Newsy dla instrumentu i rynku z „tonem” artykułów (GDELT) i opcjonalnym … | P3 | [openapi.yaml](../02-api/openapi.yaml), [mapa-ekranow](../04-frontend/mapa-ekranow.md) | BL-702 | Później | ✅ |
| FR-01.14 | Kursy walut NBP (tabela A — bieżące i historyczne) i ceny złota NBP … | P0 | [openapi.yaml](../02-api/openapi.yaml), [mapa-ekranow](../04-frontend/mapa-ekranow.md), [ADR-005](../09-decyzje/ADR-005-strategia-danych-rynkowych.md) (+1) | BL-132, BL-214 | M1, M2 | ✅ |
| FR-01.15 | Status danych: każdy widok z danymi rynkowymi pokazuje wiek danych, źródło i … | P0 | [openapi.yaml](../02-api/openapi.yaml), [mapa-ekranow](../04-frontend/mapa-ekranow.md), [ADR-005](../09-decyzje/ADR-005-strategia-danych-rynkowych.md) (+7) | BL-137 | M1 | ✅ |

### FR-02 Portfel — stan obecny (§3.1.2)

| ID | Wymaganie (skrót) | P | Dokumenty | Zadania | Etap | Status |
|---|---|---|---|---|---|---|
| FR-02.01 | Wiele rachunków na użytkownika (np. „XTB — zwykły”, „XTB — IKE”, „mBank”) z … | P0 | [openapi.yaml](../02-api/openapi.yaml), [mapa-ekranow](../04-frontend/mapa-ekranow.md) | BL-144, BL-147 | M1 | ✅ |
| FR-02.02 | Pozycje: instrument, ilość, średni koszt (wg metody rachunku), wartość … | P0 | [openapi.yaml](../02-api/openapi.yaml), [mapa-ekranow](../04-frontend/mapa-ekranow.md), [ADR-014](../09-decyzje/ADR-014-pieniadze-waluty-czas.md) | BL-143, BL-147 | M1 | ✅ |
| FR-02.03 | Wycena portfela aktualizowana automatycznie (dane opóźnione w trakcie sesji … | P0 | [openapi.yaml](../02-api/openapi.yaml), [przeplywy-danych](../01-architektura/przeplywy-danych.md), [mapa-ekranow](../04-frontend/mapa-ekranow.md) (+2) | BL-125, BL-134, BL-146, BL-147 | M1 | ✅ |
| FR-02.04 | Gotówka na rachunku per waluta (z importu i operacji ręcznych), uwzględniona … | P0 | [openapi.yaml](../02-api/openapi.yaml) | BL-143, BL-147 | M1 | ✅ |
| FR-02.05 | Alokacja wg klasy aktywów, sektora, geografii (kraj emitenta / rynek notowań) … | P1 | [openapi.yaml](../02-api/openapi.yaml), [schema.sql](../03-dane/schema.sql), [mapa-ekranow](../04-frontend/mapa-ekranow.md) (+1) | BL-207 | M2 | ✅ |
| FR-02.06 | Ekspozycja walutowa: udział walut i rozbicie wyniku pozycji zagranicznych na … | P1 | [openapi.yaml](../02-api/openapi.yaml), [mapa-ekranow](../04-frontend/mapa-ekranow.md), [obliczenia-finansowe](../03-dane/obliczenia-finansowe.md) (+2) | BL-306 | M3 | ✅ |
| FR-02.07 | P/L zrealizowany (FIFO domyślnie, średnia ważona opcjonalnie) za dzień / … | P0 | [openapi.yaml](../02-api/openapi.yaml), [mapa-ekranow](../04-frontend/mapa-ekranow.md), [ADR-014](../09-decyzje/ADR-014-pieniadze-waluty-czas.md) | BL-136, BL-142, BL-147 | M1 | ✅ |
| FR-02.08 | Dywidendy: otrzymane (brutto, podatek u źródła, netto, w walucie i w PLN) … | P1 | [openapi.yaml](../02-api/openapi.yaml), [obliczenia-finansowe](../03-dane/obliczenia-finansowe.md), [mapa-ekranow](../04-frontend/mapa-ekranow.md) | BL-307 | M3 | ✅ |
| FR-02.09 | „Wynik dnia”: zmiana wartości portfela od poprzedniego zamknięcia z rozbiciem … | P0 | [openapi.yaml](../02-api/openapi.yaml), [przeplywy-danych](../01-architektura/przeplywy-danych.md), [obliczenia-finansowe](../03-dane/obliczenia-finansowe.md) (+1) | BL-143, BL-147 | M1 | ✅ |
| FR-02.10 | Historia wartości portfela: wartość rynkowa vs skumulowane wpłaty netto … | P1 | [openapi.yaml](../02-api/openapi.yaml), [mapa-ekranow](../04-frontend/mapa-ekranow.md), [ADR-009](../09-decyzje/ADR-009-wykresy.md) | BL-302 | M3 | ✅ |

### FR-03 Analiza inwestycji przeszłych (§3.1.3)

| ID | Wymaganie (skrót) | P | Dokumenty | Zadania | Etap | Status |
|---|---|---|---|---|---|---|
| FR-03.01 | Import z XTB (eksport XLSX/CSV z xStation): podgląd przed zapisem, mapowanie … | P0 | [openapi.yaml](../02-api/openapi.yaml), [mapa-ekranow](../04-frontend/mapa-ekranow.md), [przeplywy-danych](../01-architektura/przeplywy-danych.md) (+1) | BL-145, BL-148 | M1 | ✅ |
| FR-03.02 | Import z mBank eMakler (CSV). | P1 | [openapi.yaml](../02-api/openapi.yaml), [mapa-ekranow](../04-frontend/mapa-ekranow.md) | BL-208 | M2 | ✅ |
| FR-03.03 | Ręczne dodawanie, edycja i usuwanie operacji: kupno, sprzedaż, dywidenda … | P0 | [openapi.yaml](../02-api/openapi.yaml), [mapa-ekranow](../04-frontend/mapa-ekranow.md), [formaty-importu](../03-dane/formaty-importu.md) | BL-144, BL-147 | M1 | ✅ |
| FR-03.04 | Import generyczny CSV z mapowaniem kolumn i zapamiętywanymi szablonami. | P2 | [openapi.yaml](../02-api/openapi.yaml), [formaty-importu](../03-dane/formaty-importu.md), [mapa-ekranow](../04-frontend/mapa-ekranow.md) | BL-554 | M5b | ✅ |
| FR-03.05 | Koszt nabycia (cost basis): FIFO (domyślnie; zgodne z polskimi przepisami … | P0 (FIFO) / P1 (średnia) | [openapi.yaml](../02-api/openapi.yaml), [ADR-003](../09-decyzje/ADR-003-hybryda-obliczen-i-kolejki.md), [mapa-ekranow](../04-frontend/mapa-ekranow.md) (+1) | BL-142, BL-308 | M1, M3 | ✅ |
| FR-03.06 | Stopy zwrotu: TWR (dzienna metoda łańcuchowa) i MWR/XIRR dla rachunku … | P1 | [obliczenia-finansowe](../03-dane/obliczenia-finansowe.md), [przeplywy-danych](../01-architektura/przeplywy-danych.md), [openapi.yaml](../02-api/openapi.yaml) (+3) | BL-301, BL-303 | M3 | ✅ |
| FR-03.07 | Benchmark: TWR portfela vs indeks/ETF oraz symulacja „te same przepływy w … | P1 | [openapi.yaml](../02-api/openapi.yaml), [przeplywy-danych](../01-architektura/przeplywy-danych.md), [obliczenia-finansowe](../03-dane/obliczenia-finansowe.md) (+2) | BL-304 | M3 | ✅ |
| FR-03.08 | Atrybucja wyniku okresu: wkład pozycji, sektorów i walut. | P2 | [openapi.yaml](../02-api/openapi.yaml), [obliczenia-finansowe](../03-dane/obliczenia-finansowe.md), [mapa-ekranow](../04-frontend/mapa-ekranow.md) (+1) | BL-552 | M5b | ✅ |
| FR-03.09 | Obsunięcia: maksymalne obsunięcie, czas trwania i odrabiania, wykres … | P1 | [openapi.yaml](../02-api/openapi.yaml), [obliczenia-finansowe](../03-dane/obliczenia-finansowe.md), [mapa-ekranow](../04-frontend/mapa-ekranow.md) (+2) | BL-305 | M3 | ✅ |
| FR-03.10 | Statystyki ryzyka: zmienność, Sharpe, Sortino, beta i korelacja z … | P2 | [ADR-003](../09-decyzje/ADR-003-hybryda-obliczen-i-kolejki.md), [openapi.yaml](../02-api/openapi.yaml), [obliczenia-finansowe](../03-dane/obliczenia-finansowe.md) (+1) | BL-319, BL-551 | M3, M5b | ✅ |
| FR-03.11 | Dziennik transakcji: teza, horyzont, planowany poziom wyjścia i ryzyka … | P1 | [openapi.yaml](../02-api/openapi.yaml), [mapa-ekranow](../04-frontend/mapa-ekranow.md) | BL-309 | M3 | ✅ |
| FR-03.12 | Statystyki skuteczności decyzji: trafność, średni zysk/strata, expectancy … | P2 | [openapi.yaml](../02-api/openapi.yaml), [obliczenia-finansowe](../03-dane/obliczenia-finansowe.md), [mapa-ekranow](../04-frontend/mapa-ekranow.md) | BL-553 | M5b | ✅ |
| FR-03.13 | Eksport transakcji, pozycji i wyników (CSV, JSON). | P1 | [openapi.yaml](../02-api/openapi.yaml), [mapa-ekranow](../04-frontend/mapa-ekranow.md) | BL-310 | M3 | ✅ |

### FR-04 Analiza inwestycji przyszłych (§3.1.4)

| ID | Wymaganie (skrót) | P | Dokumenty | Zadania | Etap | Status |
|---|---|---|---|---|---|---|
| FR-04.01 | Reguła nadrzędna: wszystkie wyniki tego obszaru to scenariusze i rozkłady z … | P0 (reguła) | [openapi.yaml](../02-api/openapi.yaml), [mapa-ekranow](../04-frontend/mapa-ekranow.md), [wizja-produktu](../00-przeglad/wizja-produktu.md) (+2) | BL-012, BL-312, BL-314 | M0, M3 | ✅ |
| FR-04.02 | Symulacja Monte Carlo wartości portfela (horyzont do 40 lat): bootstrap … | P1 | [mapa-ekranow](../04-frontend/mapa-ekranow.md), [ADR-003](../09-decyzje/ADR-003-hybryda-obliczen-i-kolejki.md), [przeplywy-danych](../01-architektura/przeplywy-danych.md) (+5) | BL-313 | M3 | ✅ |
| FR-04.03 | Optymalizacja portfela: minimalna wariancja, maks. Sharpe, efektywna granica … | P2 | [openapi.yaml](../02-api/openapi.yaml), [obliczenia-finansowe](../03-dane/obliczenia-finansowe.md), [mapa-ekranow](../04-frontend/mapa-ekranow.md) (+2) | BL-555 | M5b | ✅ |
| FR-04.04 | Testy warunków skrajnych: scenariusze historyczne (np. 2008, 2020, 2022) i … | P2 | [openapi.yaml](../02-api/openapi.yaml), [mapa-ekranow](../04-frontend/mapa-ekranow.md), [obliczenia-finansowe](../03-dane/obliczenia-finansowe.md) (+2) | BL-556 | M5b | ✅ |
| FR-04.05 | Analiza „co jeśli”: hipotetyczna pozycja/kwota → zmiana zmienności … | P2 | [openapi.yaml](../02-api/openapi.yaml), [obliczenia-finansowe](../03-dane/obliczenia-finansowe.md), [mapa-ekranow](../04-frontend/mapa-ekranow.md) (+2) | BL-557 | M5b | ✅ |
| FR-04.06 | Kalkulator rebalancingu: alokacja docelowa → lista transakcji z kosztami … | P1 | [openapi.yaml](../02-api/openapi.yaml), [mapa-ekranow](../04-frontend/mapa-ekranow.md), [obliczenia-finansowe](../03-dane/obliczenia-finansowe.md) (+2) | BL-315 | M3 | ✅ |
| FR-04.07 | Screening kandydatów wg kryteriów użytkownika (na bazie FR-01.11) z listą … | P2 | [mapa-ekranow](../04-frontend/mapa-ekranow.md), [openapi.yaml](../02-api/openapi.yaml), [ADR-003](../09-decyzje/ADR-003-hybryda-obliczen-i-kolejki.md) (+1) | BL-561 | M5b | ✅ |
| FR-04.08 | Backtest strategii regułowych z realistycznymi kosztami (prowizje, spread … | P2 | [openapi.yaml](../02-api/openapi.yaml), [mapa-ekranow](../04-frontend/mapa-ekranow.md), [obliczenia-finansowe](../03-dane/obliczenia-finansowe.md) (+2) | BL-558, BL-559 | M5b | ✅ |
| FR-04.09 | Kalkulator celu: wymagana miesięczna wpłata dla kwoty X z prawdopodobieństwem … | P2 | [mapa-ekranow](../04-frontend/mapa-ekranow.md), [ADR-003](../09-decyzje/ADR-003-hybryda-obliczen-i-kolejki.md), [openapi.yaml](../02-api/openapi.yaml) (+2) | BL-560 | M5b | ✅ |

### FR-05 System alertów (§3.1.5)

| ID | Wymaganie (skrót) | P | Dokumenty | Zadania | Etap | Status |
|---|---|---|---|---|---|---|
| FR-05.01 | Alert cenowy: kurs powyżej/poniżej progu, zmiana dzienna ±X %. | P1 | [mapa-ekranow](../04-frontend/mapa-ekranow.md), [openapi.yaml](../02-api/openapi.yaml), [przeplywy-danych](../01-architektura/przeplywy-danych.md) | BL-404, BL-406 | M4 | ✅ |
| FR-05.02 | Alert na wskaźniku: RSI przekracza próg, cena przecina SMA/EMA, przecięcie … | P2 | [mapa-ekranow](../04-frontend/mapa-ekranow.md), [openapi.yaml](../02-api/openapi.yaml), [obliczenia-finansowe](../03-dane/obliczenia-finansowe.md) | BL-562 | M5b | ✅ |
| FR-05.03 | Alert portfelowy: zmiana wartości o X %, obsunięcie > Y %, odchylenie … | P2 | [openapi.yaml](../02-api/openapi.yaml), [mapa-ekranow](../04-frontend/mapa-ekranow.md) | BL-563 | M5b | ✅ |
| FR-05.04 | Alert na wynikach spółek: przypomnienie N dni przed publikacją wyników spółki … | P3 | [mapa-ekranow](../04-frontend/mapa-ekranow.md), [openapi.yaml](../02-api/openapi.yaml) | BL-703 | Później | ✅ |
| FR-05.05 | Alert na newsach: nowe artykuły lub skok liczby wzmianek o instrumencie. | P3 | [mapa-ekranow](../04-frontend/mapa-ekranow.md), [openapi.yaml](../02-api/openapi.yaml) | BL-704 | Później | ✅ |
| FR-05.06 | Kanały i preferencje: Web Push i e-mail wybierane per alert; ciche godziny … | P1 | [openapi.yaml](../02-api/openapi.yaml), [mapa-ekranow](../04-frontend/mapa-ekranow.md), [strategia-mobilna](../05-mobile/strategia-mobilna.md) (+6) | BL-403, BL-406 | M4 | ✅ |
| FR-05.07 | Treść alertu: wartość, próg, czas i źródło danych, link do instrumentu; bez … | P1 | [openapi.yaml](../02-api/openapi.yaml), [mapa-ekranow](../04-frontend/mapa-ekranow.md), [przeplywy-danych](../01-architektura/przeplywy-danych.md) (+2) | BL-405 | M4 | ✅ |

### FR-06 Samouczki i warstwa edukacyjna (§3.1.6)

| ID | Wymaganie (skrót) | P | Dokumenty | Zadania | Etap | Status |
|---|---|---|---|---|---|---|
| FR-06.01 | Interaktywny onboarding przy pierwszym logowaniu (rachunek, import, jak … | P1 | [mapa-ekranow](../04-frontend/mapa-ekranow.md), [samouczki](../12-dla-uzytkownika/samouczki.md), [openapi.yaml](../02-api/openapi.yaml) (+1) | BL-216 | M2 | ✅ |
| FR-06.02 | Kontekstowe wyjaśnienia przy wskaźnikach i metrykach: definicja, jak czytać … | P1 | [moduly](../01-architektura/moduly.md), [samouczki](../12-dla-uzytkownika/samouczki.md), [wizja-produktu](../00-przeglad/wizja-produktu.md) (+4) | BL-203 | M2 | ✅ |
| FR-06.03 | Glosariusz (PL, wyszukiwalny) z powiązaniami do miejsc w aplikacji. | P1 | [mapa-ekranow](../04-frontend/mapa-ekranow.md), [samouczki](../12-dla-uzytkownika/samouczki.md), [slownik-pojec](../00-przeglad/slownik-pojec.md) | BL-204, BL-512 | M2, M5a | ✅ |
| FR-06.04 | Tryb demo: fikcyjny portfel na danych historycznych, odizolowany od danych … | P2 | [openapi.yaml](../02-api/openapi.yaml), [samouczki](../12-dla-uzytkownika/samouczki.md), [mapa-ekranow](../04-frontend/mapa-ekranow.md) | BL-511 | M5a | ✅ |
| FR-06.05 | Ścieżki nauki (podstawy, dywersyfikacja, koszty, podatki w PL, ryzyko … | P3 | [mapa-ekranow](../04-frontend/mapa-ekranow.md), [openapi.yaml](../02-api/openapi.yaml), [samouczki](../12-dla-uzytkownika/samouczki.md) | BL-705 | Później | ✅ |
| FR-06.06 | „Jak czytać ten wynik” przy analizach FR-04 (percentyle, przedziały, dlaczego … | P2 | [samouczki](../12-dla-uzytkownika/samouczki.md), [openapi.yaml](../02-api/openapi.yaml), [mapa-ekranow](../04-frontend/mapa-ekranow.md) (+1) | BL-314 | M3 | ✅ |

### FR-07 Użytkownicy, uwierzytelnianie, role (§3.2)

| ID | Wymaganie (skrót) | P | Dokumenty | Zadania | Etap | Status |
|---|---|---|---|---|---|---|
| FR-07.01 | Rejestracja wyłącznie z zaproszenia: jednorazowy link ważny 72 h, wystawiany … | P0 | [openapi.yaml](../02-api/openapi.yaml), [mapa-ekranow](../04-frontend/mapa-ekranow.md), [uwierzytelnianie-autoryzacja](../06-bezpieczenstwo/uwierzytelnianie-autoryzacja.md) (+4) | BL-102, BL-122 | M1 | ✅ |
| FR-07.02 | Logowanie e-mailem i hasłem (Argon2id), weryfikacja adresu e-mail … | P0 | [uwierzytelnianie-autoryzacja](../06-bezpieczenstwo/uwierzytelnianie-autoryzacja.md), [openapi.yaml](../02-api/openapi.yaml), [mapa-ekranow](../04-frontend/mapa-ekranow.md) (+3) | BL-101, BL-122 | M1 | ✅ |
| FR-07.03 | Logowanie OAuth (Google, GitHub) jako alternatywny pierwszy składnik, z … | P2 | [uwierzytelnianie-autoryzacja](../06-bezpieczenstwo/uwierzytelnianie-autoryzacja.md), [ADR-004](../09-decyzje/ADR-004-postgres-better-auth-rls.md), [openapi.yaml](../02-api/openapi.yaml) (+2) | BL-564 | M5b | ✅ |
| FR-07.04 | Obowiązkowe 2FA TOTP dla każdego konta: konfiguracja przed pierwszym dostępem … | P0 | [openapi.yaml](../02-api/openapi.yaml), [uwierzytelnianie-autoryzacja](../06-bezpieczenstwo/uwierzytelnianie-autoryzacja.md), [mapa-ekranow](../04-frontend/mapa-ekranow.md) (+2) | BL-103, BL-106, BL-122 | M1 | ✅ |
| FR-07.05 | Zarządzanie sesjami przez użytkownika: lista urządzeń, wylogowanie zdalne … | P1 | [openapi.yaml](../02-api/openapi.yaml), [uwierzytelnianie-autoryzacja](../06-bezpieczenstwo/uwierzytelnianie-autoryzacja.md), [realtime](../02-api/realtime.md) (+2) | BL-105, BL-123 | M1 | ✅ |
| FR-07.06 | Role user / pro / admin (RBAC) z uprawnieniami per moduł; „pro” = dostęp do … | P0 (model) / P1 (bramkowanie „pro”) | [openapi.yaml](../02-api/openapi.yaml), [uwierzytelnianie-autoryzacja](../06-bezpieczenstwo/uwierzytelnianie-autoryzacja.md), [ADR-004](../09-decyzje/ADR-004-postgres-better-auth-rls.md) | BL-108, BL-316 | M1, M3 | ✅ |
| FR-07.07 | Tokeny API użytkownika (PAT) do automatyzacji (Skróty, HTTP Shortcuts) … | P1 | [openapi.yaml](../02-api/openapi.yaml), [uwierzytelnianie-autoryzacja](../06-bezpieczenstwo/uwierzytelnianie-autoryzacja.md), [przeplywy-danych](../01-architektura/przeplywy-danych.md) (+3) | BL-407 | M4 | ✅ |
| FR-07.08 | Profil i preferencje: waluta bazowa (domyślnie PLN), metoda cost basis … | P1 | [openapi.yaml](../02-api/openapi.yaml), [system-projektowy](../04-frontend/system-projektowy.md), [dostepnosc](../04-frontend/dostepnosc.md) (+3) | BL-113, BL-123, BL-211 | M1, M2 | ✅ |
| FR-07.09 | RODO: eksport wszystkich danych użytkownika (JSON + CSV), usunięcie konta i … | P1 | [openapi.yaml](../02-api/openapi.yaml), [przeplywy-danych](../01-architektura/przeplywy-danych.md), [mapa-ekranow](../04-frontend/mapa-ekranow.md) (+5) | BL-114, BL-123 | M1 | ✅ |
| FR-07.10 | Reset hasła przez e-mail (jednorazowy link ważny 30 min), a następnie TOTP. | P0 | [openapi.yaml](../02-api/openapi.yaml), [mapa-ekranow](../04-frontend/mapa-ekranow.md), [uwierzytelnianie-autoryzacja](../06-bezpieczenstwo/uwierzytelnianie-autoryzacja.md) (+2) | BL-107, BL-122 | M1 | ✅ |
| FR-07.11 | Passkeys (WebAuthn) jako dodatkowa metoda logowania. | P3 | [uwierzytelnianie-autoryzacja](../06-bezpieczenstwo/uwierzytelnianie-autoryzacja.md), [ADR-004](../09-decyzje/ADR-004-postgres-better-auth-rls.md), [strategia-mobilna](../05-mobile/strategia-mobilna.md) (+1) | BL-706 | Później | ✅ |
| FR-07.12 | Dokumenty prawne i zgody: przy rejestracji akceptacja regulaminu i … | P0 | [openapi.yaml](../02-api/openapi.yaml), [mapa-ekranow](../04-frontend/mapa-ekranow.md), [uwierzytelnianie-autoryzacja](../06-bezpieczenstwo/uwierzytelnianie-autoryzacja.md) (+5) | BL-102, BL-104, BL-116, BL-122 (+3) | M1 | ✅ |

### FR-08 Panel administratora (§3.2)

| ID | Wymaganie (skrót) | P | Dokumenty | Zadania | Etap | Status |
|---|---|---|---|---|---|---|
| FR-08.01 | Zarządzanie użytkownikami: lista, zaproszenia, zmiana roli, blokada, reset … | P0 (zaproszenia, role) / P1 (reszta) | [openapi.yaml](../02-api/openapi.yaml), [uwierzytelnianie-autoryzacja](../06-bezpieczenstwo/uwierzytelnianie-autoryzacja.md), [ADR-006](../09-decyzje/ADR-006-panel-administratora.md) (+5) | BL-108, BL-111, BL-112, BL-509 | M1, M5a | ✅ |
| FR-08.02 | Sesje: podgląd aktywnych sesji (urządzenie, IP, czas), unieważnianie. | P1 | [openapi.yaml](../02-api/openapi.yaml), [uwierzytelnianie-autoryzacja](../06-bezpieczenstwo/uwierzytelnianie-autoryzacja.md), [realtime](../02-api/realtime.md) (+2) | BL-501 | M5a | ✅ |
| FR-08.03 | Limity API: zużycie kwot dostawców (minuta/doba), budżety dostawców, limity … | P1 | [openapi.yaml](../02-api/openapi.yaml), [mapa-ekranow](../04-frontend/mapa-ekranow.md), [ADR-006](../09-decyzje/ADR-006-panel-administratora.md) | BL-215, BL-503 | M2, M5a | ✅ |
| FR-08.04 | Feature flags: włączanie modułów i funkcji globalnie, per rola, per … | P1 | [openapi.yaml](../02-api/openapi.yaml), [mapa-ekranow](../04-frontend/mapa-ekranow.md), [przeplywy-danych](../01-architektura/przeplywy-danych.md) (+1) | BL-117, BL-502 | M1, M5a | ✅ |
| FR-08.05 | Audit log: przegląd z filtrami (aktor, akcja, zasób, czas), eksport; wpisy … | P0 (zapis) / P1 (UI) | [openapi.yaml](../02-api/openapi.yaml), [schema.sql](../03-dane/schema.sql), [mapa-ekranow](../04-frontend/mapa-ekranow.md) (+2) | BL-109, BL-504 | M1, M5a | ✅ |
| FR-08.06 | Status integracji: stan każdego dostawcy (circuit breaker, ostatni sukces … | P1 | [openapi.yaml](../02-api/openapi.yaml), [mapa-ekranow](../04-frontend/mapa-ekranow.md), [ADR-006](../09-decyzje/ADR-006-panel-administratora.md) | BL-506 | M5a | ✅ |
| FR-08.07 | Kolejki zadań: zadania oczekujące / aktywne / nieudane per kolejka … | P1 | [openapi.yaml](../02-api/openapi.yaml), [moduly](../01-architektura/moduly.md), [mapa-ekranow](../04-frontend/mapa-ekranow.md) (+1) | BL-505 | M5a | ✅ |
| FR-08.08 | Health-checki i zasoby: stan usług (web, api, jobs, analytics, postgres … | P1 | [openapi.yaml](../02-api/openapi.yaml), [mapa-ekranow](../04-frontend/mapa-ekranow.md), [monitoring](../07-wdrozenie/monitoring.md) (+1) | BL-507 | M5a | ✅ |
| FR-08.09 | Dane rynkowe: ręczny import notowań (CSV ze Stooq, XLS z archiwum GPW) … | P2 | [openapi.yaml](../02-api/openapi.yaml), [zrodla-danych](../03-dane/zrodla-danych.md), [mapa-ekranow](../04-frontend/mapa-ekranow.md) (+3) | BL-508 | M5a | ✅ |
| FR-08.10 | Każda akcja administracyjna w audycie: kto, co, na czym, kiedy, skąd (IP … | P0 | [openapi.yaml](../02-api/openapi.yaml), [ADR-006](../09-decyzje/ADR-006-panel-administratora.md), [przeplywy-danych](../01-architektura/przeplywy-danych.md) (+1) | BL-109 | M1 | ✅ |

### FR-09 Integracje mobilne i systemowe (§4.4)

| ID | Wymaganie (skrót) | P | Dokumenty | Zadania | Etap | Status |
|---|---|---|---|---|---|---|
| FR-09.01 | Instalowalna PWA (manifest, ikony, ekran startowy, tryb standalone) na iOS … | P1 | [strategia-mobilna](../05-mobile/strategia-mobilna.md), [ADR-008](../09-decyzje/ADR-008-pwa-i-integracje-mobilne.md), [architektura-ui](../04-frontend/architektura-ui.md) (+1) | BL-401, BL-412 | M4 | ✅ |
| FR-09.02 | Offline shell: aplikacja uruchamia się bez sieci i pokazuje ostatnio … | P2 | [architektura-ui](../04-frontend/architektura-ui.md), [mapa-ekranow](../04-frontend/mapa-ekranow.md), [strategia-mobilna](../05-mobile/strategia-mobilna.md) (+4) | BL-565 | M5b | ✅ |
| FR-09.03 | Web Push dla alertów (iOS ≥ 16.4 po instalacji PWA, Android, desktop); prośba … | P1 | [openapi.yaml](../02-api/openapi.yaml), [strategia-mobilna](../05-mobile/strategia-mobilna.md), [mapa-ekranow](../04-frontend/mapa-ekranow.md) (+3) | BL-402, BL-412 | M4 | ✅ |
| FR-09.04 | API „szybkich akcji” dla automatyzacji (Skróty iOS, HTTP Shortcuts) … | P1 | [openapi.yaml](../02-api/openapi.yaml), [strategia-mobilna](../05-mobile/strategia-mobilna.md), [przeplywy-danych](../01-architektura/przeplywy-danych.md) (+5) | BL-408 | M4 | ✅ |
| FR-09.05 | Gotowe Skróty iOS (link iCloud + instrukcja): „Pokaż mój portfel”, „Ile dziś … | P2 | [openapi.yaml](../02-api/openapi.yaml), [strategia-mobilna](../05-mobile/strategia-mobilna.md), [przeplywy-danych](../01-architektura/przeplywy-danych.md) (+4) | BL-409, BL-412 | M4 | ✅ |
| FR-09.06 | Android: skróty aplikacji w manifeście (przytrzymanie ikony), otwieranie … | P2 | [strategia-mobilna](../05-mobile/strategia-mobilna.md), [architektura-ui](../04-frontend/architektura-ui.md), [android-integracje](../05-mobile/android-integracje.md) (+3) | BL-401, BL-410, BL-412 | M4 | ✅ |
| FR-09.07 | Linki głębokie (https) do instrumentu, rachunku, alertu i wyniku analizy — w … | P1 | [architektura-ui](../04-frontend/architektura-ui.md), [strategia-mobilna](../05-mobile/strategia-mobilna.md), [mapa-ekranow](../04-frontend/mapa-ekranow.md) (+2) | BL-411, BL-412 | M4 | ✅ |
| FR-09.08 | Widżety z danymi (ekran główny/blokady) opcjonalnie przez aplikacje … | P3 | [strategia-mobilna](../05-mobile/strategia-mobilna.md), [android-integracje](../05-mobile/android-integracje.md), [ios-integracje](../05-mobile/ios-integracje.md) (+3) | BL-707 | Później | ✅ |

### NFR-01 Wydajność (§4.1)

| ID | Wymaganie (skrót) | P | Dokumenty | Zadania | Etap | Status |
|---|---|---|---|---|---|---|
| NFR-01.01 | LCP < 2,0 s, INP < 200 ms, CLS < 0,1 (75. percentyl) na profilu mobilnym (4G … | P0 | [wydajnosc](../04-frontend/wydajnosc.md), [openapi.yaml](../02-api/openapi.yaml), [wizja-produktu](../00-przeglad/wizja-produktu.md) (+3) | BL-124, BL-154, BL-507, BL-606 | M1, M5a, M6 | ✅ |
| NFR-01.02 | Initial JS pierwszego wczytania trasy < 200 KB gzip; budżety per trasa w … | P0 | [wydajnosc](../04-frontend/wydajnosc.md), [ADR-009](../09-decyzje/ADR-009-wykresy.md), [stack-technologiczny](../01-architektura/stack-technologiczny.md) (+1) | BL-011, BL-016, BL-033, BL-121 (+1) | M0, M1 | ✅ |
| NFR-01.03 | Code splitting per moduł: biblioteki wykresów, onboarding, panel admina i … | P0 | [wydajnosc](../04-frontend/wydajnosc.md), [ADR-006](../09-decyzje/ADR-006-panel-administratora.md), [ADR-009](../09-decyzje/ADR-009-wykresy.md) (+1) | BL-016, BL-154 | M0, M1 | ✅ |
| NFR-01.04 | Wykresy na canvas; serwer decymuje serie do ≤ 3 000 punktów; listy i tabele > … | P0 | [openapi.yaml](../02-api/openapi.yaml), [wydajnosc](../04-frontend/wydajnosc.md), [ADR-009](../09-decyzje/ADR-009-wykresy.md) | BL-138 | M1 | ✅ |
| NFR-01.05 | Ścieżka żądania użytkownika nie zawiera wywołań zewnętrznych API; odczyty p95 … | P0 | [wydajnosc](../04-frontend/wydajnosc.md), [ADR-003](../09-decyzje/ADR-003-hybryda-obliczen-i-kolejki.md), [monitoring](../07-wdrozenie/monitoring.md) | BL-131, BL-154, BL-607 | M1, M6 | ✅ |
| NFR-01.06 | Aktualizacje przez SSE docierają < 2 s od zapisu nowych danych. | P1 | [openapi.yaml](../02-api/openapi.yaml), [realtime](../02-api/realtime.md), [wydajnosc](../04-frontend/wydajnosc.md) (+2) | BL-125, BL-212 | M1, M2 | ✅ |
| NFR-01.07 | Ciężkie obliczenia wykonywane asynchronicznie z postępem, limitem czasu i … | P1 | [openapi.yaml](../02-api/openapi.yaml), [wydajnosc](../04-frontend/wydajnosc.md), [ADR-003](../09-decyzje/ADR-003-hybryda-obliczen-i-kolejki.md) | BL-311, BL-312 | M3 | ✅ |
| NFR-01.08 | Całość działa w VM ≤ 6 GB RAM / 3 vCPU obok Immich przy ≤ 5 równoczesnych … | P0 | [ADR-011](../09-decyzje/ADR-011-topologia-wdrozenia.md), [przeglad-architektury](../01-architektura/przeglad-architektury.md), [wydajnosc](../04-frontend/wydajnosc.md) (+2) | BL-022, BL-607 | M0, M6 | ✅ |
| NFR-01.09 | Konflikty wydajności z funkcjami zgłaszane jawnie (ADR … | P0 | [wydajnosc](../04-frontend/wydajnosc.md), [10-ograniczenia](../10-ograniczenia.md), [architektura-ui](../04-frontend/architektura-ui.md) | BL-606 | M6 | ✅ |

### NFR-02 Modularność i rozszerzalność (§4.2)

| ID | Wymaganie (skrót) | P | Dokumenty | Zadania | Etap | Status |
|---|---|---|---|---|---|---|
| NFR-02.01 | Monorepo Turborepo + pnpm z podziałem `apps/`, `modules/`, `packages/`. | P0 | [ADR-002](../09-decyzje/ADR-002-monorepo.md) | BL-001, BL-002 | M0 | ✅ |
| NFR-02.02 | Moduły funkcjonalne mają własne API (prefiks), model domenowy, tabele … | P0 | [przeglad-architektury](../01-architektura/przeglad-architektury.md), [ADR-002](../09-decyzje/ADR-002-monorepo.md), [ADR-006](../09-decyzje/ADR-006-panel-administratora.md) (+1) | BL-002, BL-004, BL-006, BL-017 (+1) | M0, M1 | ✅ |
| NFR-02.03 | Zależności między modułami wyłącznie zgodnie z warstwami (platforma → … | P0 | [ADR-002](../09-decyzje/ADR-002-monorepo.md) | BL-003 | M0 | ✅ |
| NFR-02.04 | Dostawcy danych jako wymienne adaptery (port/adapter) z testami kontraktowymi. | P0 | [ADR-005](../09-decyzje/ADR-005-strategia-danych-rynkowych.md) | BL-131, BL-210 | M1, M2 | ✅ |
| NFR-02.05 | Wersjonowanie API (`/api/v1`); zmiana niekompatybilna: ≥ 90 dni okresu … | P1 | [moduly](../01-architektura/moduly.md), [konwencje-api](../02-api/konwencje-api.md), [openapi.yaml](../02-api/openapi.yaml) (+2) | BL-010 | M0 | ✅ |
| NFR-02.06 | Jedna implementacja obliczeń finansowych (`packages/core`) dla web, api i … | P0 | [przeglad-architektury](../01-architektura/przeglad-architektury.md), [strategia-mobilna](../05-mobile/strategia-mobilna.md), [ADR-003](../09-decyzje/ADR-003-hybryda-obliczen-i-kolejki.md) | BL-015, BL-317 | M0, M3 | ✅ |
| NFR-02.07 | Checklisty dodania i usunięcia modułu w dokumentacji. | P0 | [ADR-002](../09-decyzje/ADR-002-monorepo.md) | BL-004 | M0 | ✅ |

### NFR-03 Bezpieczeństwo (§4.3; szczegóły w `docs/06-bezpieczenstwo/`)

| ID | Wymaganie (skrót) | P | Dokumenty | Zadania | Etap | Status |
|---|---|---|---|---|---|---|
| NFR-03.01 | Model zagrożeń STRIDE per moduł z macierzą ryzyk; mapowanie na OWASP Top 10 … | P0 | [kontrole-bezpieczenstwa](../06-bezpieczenstwo/kontrole-bezpieczenstwa.md), [model-zagrozen](../06-bezpieczenstwo/model-zagrozen.md) | BL-601, BL-608, BL-609 | M6 | ✅ |
| NFR-03.02 | Hasła: Argon2id (parametry wg OWASP), sprawdzanie wycieków, limity prób i … | P0 | [openapi.yaml](../02-api/openapi.yaml), [uwierzytelnianie-autoryzacja](../06-bezpieczenstwo/uwierzytelnianie-autoryzacja.md), [ADR-004](../09-decyzje/ADR-004-postgres-better-auth-rls.md) (+1) | BL-031, BL-101 | M0, M1 | ✅ |
| NFR-03.03 | Sesje: ciasteczka `HttpOnly` + `Secure` + `SameSite`, rotacja przy zmianie … | P0 | [openapi.yaml](../02-api/openapi.yaml), [uwierzytelnianie-autoryzacja](../06-bezpieczenstwo/uwierzytelnianie-autoryzacja.md), [kontrole-bezpieczenstwa](../06-bezpieczenstwo/kontrole-bezpieczenstwa.md) (+1) | BL-030, BL-105 | M0, M1 | ✅ |
| NFR-03.04 | RLS na każdej tabeli z danymi użytkownika; aplikacja łączy się rolą bez … | P0 | [uwierzytelnianie-autoryzacja](../06-bezpieczenstwo/uwierzytelnianie-autoryzacja.md), [przeglad-architektury](../01-architektura/przeglad-architektury.md), [kontrole-bezpieczenstwa](../06-bezpieczenstwo/kontrole-bezpieczenstwa.md) (+2) | BL-007, BL-008, BL-108 | M0, M1 | ✅ |
| NFR-03.05 | Dane użytkownika nie trafiają do współdzielonych kluczy cache ani logów … | P0 | [uwierzytelnianie-autoryzacja](../06-bezpieczenstwo/uwierzytelnianie-autoryzacja.md), [ADR-004](../09-decyzje/ADR-004-postgres-better-auth-rls.md), [przeplywy-danych](../01-architektura/przeplywy-danych.md) (+3) | BL-125, BL-131 | M1 | ✅ |
| NFR-03.06 | TLS 1.3, HSTS, CSP bez `unsafe-inline` (nonce), `frame-ancestors … | P0 | [kontrole-bezpieczenstwa](../06-bezpieczenstwo/kontrole-bezpieczenstwa.md), [architektura-ui](../04-frontend/architektura-ui.md), [ADR-011](../09-decyzje/ADR-011-topologia-wdrozenia.md) | BL-011, BL-025, BL-156, BL-602 (+1) | M0, M1, M6 | ✅ |
| NFR-03.07 | Walidacja wejścia (Zod) na każdej granicy; zapytania parametryzowane … | P0 | [kontrole-bezpieczenstwa](../06-bezpieczenstwo/kontrole-bezpieczenstwa.md), [ADR-012](../09-decyzje/ADR-012-api-jako-granica-domenowa.md) | BL-006, BL-145, BL-602 | M0, M1, M6 | ✅ |
| NFR-03.08 | Szyfrowanie wrażliwych danych at-rest na poziomie aplikacji (sekrety TOTP … | P0 | [kontrole-bezpieczenstwa](../06-bezpieczenstwo/kontrole-bezpieczenstwa.md), [ADR-004](../09-decyzje/ADR-004-postgres-better-auth-rls.md), [schema.sql](../03-dane/schema.sql) (+1) | BL-031 | M0 | ✅ |
| NFR-03.09 | Łańcuch dostaw: lockfile i pinowanie, Renovate/Dependabot, SCA (osv-scanner) … | P1 | [kontrole-bezpieczenstwa](../06-bezpieczenstwo/kontrole-bezpieczenstwa.md), [ci-cd](../07-wdrozenie/ci-cd.md), [ADR-013](../09-decyzje/ADR-013-repozytorium-publiczne.md) | BL-001, BL-017, BL-019, BL-021 (+2) | M0, M6 | ✅ |
| NFR-03.10 | Logowanie zdarzeń bezpieczeństwa, wykrywanie anomalii (seria nieudanych … | P1 | [kontrole-bezpieczenstwa](../06-bezpieczenstwo/kontrole-bezpieczenstwa.md), [przeplywy-danych](../01-architektura/przeplywy-danych.md), [realtime](../02-api/realtime.md) (+4) | BL-110, BL-610 | M1, M6 | ✅ |
| NFR-03.11 | Hardening: firewall (domyślnie deny), CrowdSec, SSH wyłącznie kluczami … | P0 | [infrastruktura](../07-wdrozenie/infrastruktura.md), [kontrole-bezpieczenstwa](../06-bezpieczenstwo/kontrole-bezpieczenstwa.md), [ADR-011](../09-decyzje/ADR-011-topologia-wdrozenia.md) | BL-020, BL-022, BL-023, BL-024 (+4) | M0, M1 | ✅ |
| NFR-03.12 | Publiczne repozytorium bez sekretów, adresów IP, wewnętrznych nazw hostów … | P0 | [wizja-produktu](../00-przeglad/wizja-produktu.md), [kontrole-bezpieczenstwa](../06-bezpieczenstwo/kontrole-bezpieczenstwa.md), [ADR-013](../09-decyzje/ADR-013-repozytorium-publiczne.md) | BL-005, BL-019, BL-149 | M0, M1 | ✅ |
| NFR-03.13 | Worker analityczny bez dostępu do internetu i do danych użytkowników w bazie … | P1 | [kontrole-bezpieczenstwa](../06-bezpieczenstwo/kontrole-bezpieczenstwa.md), [przeglad-architektury](../01-architektura/przeglad-architektury.md), [przeplywy-danych](../01-architektura/przeplywy-danych.md) (+1) | BL-311 | M3 | ✅ |

### NFR-04 Wieloplatformowość (§4.4)

| ID | Wymaganie (skrót) | P | Dokumenty | Zadania | Etap | Status |
|---|---|---|---|---|---|---|
| NFR-04.01 | Wspierane przeglądarki: Safari iOS/iPadOS ≥ 17, Safari macOS ≥ 17, Chrome i … | P0 | [strategia-mobilna](../05-mobile/strategia-mobilna.md), [kontrole-bezpieczenstwa](../06-bezpieczenstwo/kontrole-bezpieczenstwa.md), [ADR-008](../09-decyzje/ADR-008-pwa-i-integracje-mobilne.md) | BL-018, BL-412 | M0, M4 | ✅ |
| NFR-04.02 | Responsywność 360–2560 px, mobile-first, gesty na wykresach, obsługa … | P0 | [architektura-ui](../04-frontend/architektura-ui.md), [strategia-mobilna](../05-mobile/strategia-mobilna.md), [ADR-008](../09-decyzje/ADR-008-pwa-i-integracje-mobilne.md) | BL-121 | M1 | ✅ |
| NFR-04.03 | Działanie bez sklepów z aplikacjami i bez kont deweloperskich (0 zł). | P0 | [strategia-mobilna](../05-mobile/strategia-mobilna.md), [ADR-008](../09-decyzje/ADR-008-pwa-i-integracje-mobilne.md) | BL-401 | M4 | ✅ |
| NFR-04.04 | Współdzielona logika biznesowa w `packages/core` (patrz NFR-02.06). | P0 | [strategia-mobilna](../05-mobile/strategia-mobilna.md) | BL-141 | M1 | ✅ |

### NFR-05 Budżet 0 zł (§4.5)

| ID | Wymaganie (skrót) | P | Dokumenty | Zadania | Etap | Status |
|---|---|---|---|---|---|---|
| NFR-05.01 | Każdy komponent self-hostowany lub z trwałym darmowym tierem; wyjątki w … | P0 | [ADR-010](../09-decyzje/ADR-010-kanaly-powiadomien.md), [10-ograniczenia](../10-ograniczenia.md) | BL-608 | M6 | ✅ |
| NFR-05.02 | System działa w pełni na darmowych limitach API (kwoty planowane, twardy … | P0 | [przeglad-architektury](../01-architektura/przeglad-architektury.md), [ADR-005](../09-decyzje/ADR-005-strategia-danych-rynkowych.md) | BL-131, BL-133 | M1 | ✅ |
| NFR-05.03 | Mieści się na posiadanym sprzęcie (Dell 7020 obok Immich) i istniejącym VPS … | P0 | [infrastruktura](../07-wdrozenie/infrastruktura.md), [ADR-011](../09-decyzje/ADR-011-topologia-wdrozenia.md) | BL-607 | M6 | ✅ |

### NFR-06 Dostępność (WCAG 2.1 AA)

| ID | Wymaganie (skrót) | P | Dokumenty | Zadania | Etap | Status |
|---|---|---|---|---|---|---|
| NFR-06.01 | WCAG 2.1 AA: kontrast, obsługa klawiatury, widoczny focus, etykiety, role … | P0 | [dostepnosc](../04-frontend/dostepnosc.md), [system-projektowy](../04-frontend/system-projektowy.md), [ADR-009](../09-decyzje/ADR-009-wykresy.md) | BL-018, BL-138, BL-155, BL-605 | M0, M1, M6 | ✅ |
| NFR-06.02 | Zysk/strata komunikowane nie tylko kolorem (znak, ikona ▲▼, tekst); paleta … | P0 | [dostepnosc](../04-frontend/dostepnosc.md), [system-projektowy](../04-frontend/system-projektowy.md), [architektura-ui](../04-frontend/architektura-ui.md) | BL-113, BL-605 | M1, M6 | ✅ |
| NFR-06.03 | Prosty język w treściach edukacyjnych; liczby i daty formatowane wg locale … | P1 | [dostepnosc](../04-frontend/dostepnosc.md), [system-projektowy](../04-frontend/system-projektowy.md), [instrukcja](../12-dla-uzytkownika/instrukcja.md) (+1) | BL-203, BL-512 | M2, M5a | ✅ |

### NFR-07 Zgodność regulacyjna i przejrzystość (§6.4–6.5)

| ID | Wymaganie (skrót) | P | Dokumenty | Zadania | Etap | Status |
|---|---|---|---|---|---|---|
| NFR-07.01 | Obowiązkowe disclaimery na ekranach analiz, screenera, alertów i eksportów wg … | P0 | [openapi.yaml](../02-api/openapi.yaml), [11-zgodnosc-prawna](../11-zgodnosc-prawna.md), [slownik-pojec](../00-przeglad/slownik-pojec.md) (+4) | BL-012 | M0 | ✅ |
| NFR-07.02 | Każda funkcja predykcyjna/backtestowa ma udokumentowane założenia, źródło … | P0 | [openapi.yaml](../02-api/openapi.yaml), [mapa-ekranow](../04-frontend/mapa-ekranow.md), [system-projektowy](../04-frontend/system-projektowy.md) (+1) | BL-318, BL-559, BL-566 | M3, M5b | ✅ |
| NFR-07.03 | Atrybucje źródeł i licencji danych w UI (m.in. FRED, NBP, GDELT, TradingView). | P1 | [11-zgodnosc-prawna](../11-zgodnosc-prawna.md), [openapi.yaml](../02-api/openapi.yaml), [mapa-ekranow](../04-frontend/mapa-ekranow.md) (+1) | BL-116 | M1 | ✅ |
| NFR-07.04 | Brak redystrybucji danych rynkowych poza zarejestrowanych użytkowników (brak … | P0 | [11-zgodnosc-prawna](../11-zgodnosc-prawna.md), [ADR-005](../09-decyzje/ADR-005-strategia-danych-rynkowych.md), [kontrole-bezpieczenstwa](../06-bezpieczenstwo/kontrole-bezpieczenstwa.md) (+1) | BL-116 | M1 | ✅ |

### NFR-08 Poprawność obliczeń i jakość danych

| ID | Wymaganie (skrót) | P | Dokumenty | Zadania | Etap | Status |
|---|---|---|---|---|---|---|
| NFR-08.01 | Kwoty pieniężne w typach dziesiętnych (`decimal.js` / `Decimal` / `NUMERIC`) … | P0 | [ADR-014](../09-decyzje/ADR-014-pieniadze-waluty-czas.md) | BL-141 | M1 | ✅ |
| NFR-08.02 | Każdy wzór z `obliczenia-finansowe.md` ma testy na wektorach referencyjnych z … | P0 | [ADR-003](../09-decyzje/ADR-003-hybryda-obliczen-i-kolejki.md), [ADR-014](../09-decyzje/ADR-014-pieniadze-waluty-czas.md) | BL-015, BL-142, BL-201, BL-301 (+1) | M0, M1, M2, M3 | ✅ |
| NFR-08.03 | Uzgodnienie z brokerem po imporcie (ilości, gotówka, P/L zrealizowany) z … | P0 | [openapi.yaml](../02-api/openapi.yaml), [wizja-produktu](../00-przeglad/wizja-produktu.md), [przeplywy-danych](../01-architektura/przeplywy-danych.md) (+3) | BL-145 | M1 | ✅ |
| NFR-08.04 | Kontrola jakości danych rynkowych (luki, duplikaty, skoki bez splitu) z … | P1 | [obliczenia-finansowe](../03-dane/obliczenia-finansowe.md) | BL-139, BL-209 | M1, M2 | ✅ |
| NFR-08.05 | Analizy odtwarzalne: zapis ziarna losowego, wersji algorytmu, zakresu i … | P1 | [slownik-pojec](../00-przeglad/slownik-pojec.md), [przeplywy-danych](../01-architektura/przeplywy-danych.md), [schema.sql](../03-dane/schema.sql) (+1) | BL-313 | M3 | ✅ |

### NFR-09 Niezawodność i utrzymanie ruchu

| ID | Wymaganie (skrót) | P | Dokumenty | Zadania | Etap | Status |
|---|---|---|---|---|---|---|
| NFR-09.01 | Docelowa dostępność 99 % miesięcznie; pojedyncze punkty awarii udokumentowane … | P1 | [monitoring](../07-wdrozenie/monitoring.md), [model-zagrozen](../06-bezpieczenstwo/model-zagrozen.md), [ADR-011](../09-decyzje/ADR-011-topologia-wdrozenia.md) | BL-029, BL-152 | M0, M1 | ✅ |
| NFR-09.02 | Łagodna degradacja przy awarii dostawców danych (dane z flagą „nieaktualne” … | P0 | [openapi.yaml](../02-api/openapi.yaml), [konwencje-api](../02-api/konwencje-api.md), [mapa-ekranow](../04-frontend/mapa-ekranow.md) (+2) | BL-134, BL-209, BL-210, BL-213 | M1, M2 | ✅ |
| NFR-09.03 | Kopie zapasowe 3-2-1, szyfrowane; RPO ≤ 24 h (cel ≤ 1 h dla bazy), RTO ≤ 4 h … | P0 | [backup-dr](../07-wdrozenie/backup-dr.md), [wizja-produktu](../00-przeglad/wizja-produktu.md), [stack-technologiczny](../01-architektura/stack-technologiczny.md) (+1) | BL-028, BL-153, BL-604 | M0, M1, M6 | ✅ |
| NFR-09.04 | Monitoring: health-checki, metryki, logi strukturalne JSON z identyfikatorem … | P1 | [monitoring](../07-wdrozenie/monitoring.md) | BL-006, BL-009, BL-013, BL-029 (+1) | M0, M1 | ✅ |
| NFR-09.05 | Wdrożenia z przerwą ≤ 1 min, migracje kompatybilne wstecz (expand/contract) … | P1 | [ci-cd](../07-wdrozenie/ci-cd.md), [model-danych](../03-dane/model-danych.md) | BL-023 | M0 | ✅ |

### NFR-10 Utrzymywalność i dokumentacja (§6.6–6.7)

| ID | Wymaganie (skrót) | P | Dokumenty | Zadania | Etap | Status |
|---|---|---|---|---|---|---|
| NFR-10.01 | Dokumentacja jako produkt: każdy dokument zaczyna się od celu, decyzje w ADR … | P0 | [ci-cd](../07-wdrozenie/ci-cd.md) | BL-034, BL-035, BL-611 | M0, M6 | ✅ |
| NFR-10.02 | Testy: jednostkowe (core), integracyjne API z prawdziwym Postgresem (RLS) … | P0 | [ci-cd](../07-wdrozenie/ci-cd.md) | BL-008, BL-014, BL-017, BL-155 | M0, M1 | ✅ |
| NFR-10.03 | Conventional Commits, zielone CI przed scaleniem, Definition of Done w … | P0 | [ci-cd](../07-wdrozenie/ci-cd.md), [ADR-013](../09-decyzje/ADR-013-repozytorium-publiczne.md) | BL-001, BL-017, BL-019 | M0 | ✅ |
| NFR-10.04 | UI po polsku, architektura gotowa na i18n (klucze komunikatów, formatowanie … | P1 | [stack-technologiczny](../01-architektura/stack-technologiczny.md) | BL-012 | M0 | ✅ |
| NFR-10.05 | Minimalizm zależności: każda biblioteka uzasadniona w … | P0 | [wizja-produktu](../00-przeglad/wizja-produktu.md), [model-zagrozen](../06-bezpieczenstwo/model-zagrozen.md), [ADR-002](../09-decyzje/ADR-002-monorepo.md) | BL-001, BL-032, BL-608 | M0, M6 | ✅ |

### NFR-11 Prywatność (RODO)

| ID | Wymaganie (skrót) | P | Dokumenty | Zadania | Etap | Status |
|---|---|---|---|---|---|---|
| NFR-11.01 | Minimalizacja danych; brak zewnętrznych trackerów i analityki stron trzecich. | P0 | [prywatnosc-rodo](../06-bezpieczenstwo/prywatnosc-rodo.md), [kontrole-bezpieczenstwa](../06-bezpieczenstwo/kontrole-bezpieczenstwa.md), [10-ograniczenia](../10-ograniczenia.md) | BL-011, BL-124 | M0, M1 | ✅ |
| NFR-11.02 | Polityka retencji (logi, audyt, pliki importu, dane usuniętych kont) i … | P1 | [prywatnosc-rodo](../06-bezpieczenstwo/prywatnosc-rodo.md), [przeplywy-danych](../01-architektura/przeplywy-danych.md), [openapi.yaml](../02-api/openapi.yaml) (+3) | BL-114, BL-115 | M1 | ✅ |
| NFR-11.03 | Dane przechowywane w Polsce (serwer domowy); przekazywanie podmiotom trzecim … | P1 | [prywatnosc-rodo](../06-bezpieczenstwo/prywatnosc-rodo.md), [ADR-010](../09-decyzje/ADR-010-kanaly-powiadomien.md) | BL-107, BL-118 | M1 | ✅ |

## 3. Podsumowanie pokrycia

| Miara | Wartość |
|---|---|
| Wymagania FR / NFR | 90 / 61 (razem 151) |
| Priorytety | P0: 69, P1: 52, P2: 23, P3: 7 |
| Status | ✅ 151, ⚠️ 0, ❌ 0 |
| Elementy specyfikacji § 3–4 | 68 — wszystkie z wymaganiami i zadaniami |
| Zadania w backlogu | 180 (w tym 8 poza planem etapów) |

## 4. Przegląd spójności całości

| Sprawdzenie | Metoda | Wynik |
|---|---|---|
| Pokrycie wymagań | skrypt: wymagania × backlog × wystąpienia ID w dokumentach | 151 z 151 ze statusem ✅; wszystkie elementy § 3–4 specyfikacji mają wymagania i zadania |
| Zależności w backlogu | skrypt: brak zależności od późniejszego etapu, M3 i M4 niezależne, brama A bez zależności od B | bez uwag |
| Linki wewnętrzne | skrypt po wszystkich plikach Markdown repozytorium | 1186 działających, 0 zepsutych |
| Linki zewnętrzne dodane w Krokach 6–7 | żądanie HTTP z podążaniem za przekierowaniami | wszystkie 200 (poza `invest.oligi.pl` — aplikacja jeszcze nie istnieje) |
| Diagramy Mermaid | renderowanie wszystkich bloków (Mermaid 12) w przeglądarce | 36 z 36 renderuje się |
| OpenAPI | Redocly lint (`redocly.yaml`) | bez błędów; 142 ścieżki, 185 operacji, 250 schematów |
| Schemat bazy i RLS | `schema.sql` + `testy-rls.sql` na PostgreSQL 18.4 | 13 testów OK, 0 błędów (także po nowych kolumnach widoku podatkowego) |
| Wektory testowe | ponowne obliczenie generatorem (Decimal, empyrical-reloaded, TA-Lib) | B–H bez zmian; A uzupełniony o koszty przewalutowania (§ 6) |
| Fixtures importu | porównanie komórek XLSX i JSON po przegenerowaniu | jedyna zmiana: data sprzedaży AAPL 2025-09-01 (święto w USA) → 2025-09-02 |
| Spójność liczb | wyszukanie w całej dokumentacji | sesje 7/30 dni, PAT 30 żądań/min i 2 000/dobę, import ≤ 10 MB, RPO/RTO — zgodne wszędzie |
| Nazwy i wersje | wyszukanie przestarzałych nazw (`worker-py`, PostgreSQL 16, Redis 7, Serwist, Debian 12) | brak poza historią zmian i opcjami odrzuconymi (poprawiony opis skilla — § 6) |
| Repozytorium publiczne | skan sekretów, kluczy, konfiguracji VPN/SSH, adresów IP i hostów | brak; jedyny adres IP `127.0.0.1`; hosty tylko `invest.oligi.pl` i `*.oligi.pl` |
| Zdanie „Cel:” | pierwszy akapit każdego dokumentu w `docs/` i plików w katalogu głównym | 68 z 68 (po uzupełnieniu 14 ADR-ów, szablonu ADR i `CLAUDE.md` — § 6) |
| `AGENTS.md` | rozmiar pliku | 18,7 KB (limit Codex 32 KiB) |

## 5. Luki i otwarte weryfikacje

Brak wymagań bez projektu lub zadania. Poniżej rzeczy, których nie da się rozstrzygnąć w dokumentacji — mają przypisany moment i osobę.

| ID | Luka lub weryfikacja | Gdzie opisana | Kiedy | Kto |
|---|---|---|---|---|
| G-01 | Czy panel home.pl przyjmuje w CAA parametry `accounturi` i `validationmethods` | [`../07-wdrozenie/infrastruktura.md`](../07-wdrozenie/infrastruktura.md) § 7, R-15 | M0, BL-026 | właściciel |
| G-02 | Obejście przedrostka `__Host-` i sposób przechowywania sekretów w Better Auth | [`../06-bezpieczenstwo/uwierzytelnianie-autoryzacja.md`](../06-bezpieczenstwo/uwierzytelnianie-autoryzacja.md) § 4.1, [ADR-004](../09-decyzje/ADR-004-postgres-better-auth-rls.md) | M0, BL-030, BL-031 | agent |
| G-03 | Zgodność TypeScript 7 z bibliotekami stosu | [`../01-architektura/stack-technologiczny.md`](../01-architektura/stack-technologiczny.md) § 3 | M0, BL-032 | agent |
| G-04 | Wersja Proxmox VE na serwerze właściciela | [`../01-architektura/stack-technologiczny.md`](../01-architektura/stack-technologiczny.md) § 2 | M0, BL-025 | właściciel |
| G-05 | Szczegóły eksportu XTB: nagłówki w wersji PL, typ `Subaccount Transfer`, ceny w GBX, sufiksy giełd europejskich | [`../03-dane/formaty-importu.md`](../03-dane/formaty-importu.md) § 2 | brama A, BL-145 — na realnym eksporcie właściciela (lokalnie) | właściciel + agent |
| G-06 | Dni, w których giełda działa, a system rozliczeń nie (kalendarz rozliczeń dla widoku podatkowego) | [`../03-dane/obliczenia-finansowe.md`](../03-dane/obliczenia-finansowe.md) § 2.2 | brama A, BL-136 | agent |
| G-07 | Warunki korzystania z archiwum GPW; faktyczne opóźnienie Yahoo dla GPW | [`../03-dane/zrodla-danych.md`](../03-dane/zrodla-danych.md), [`../11-zgodnosc-prawna.md`](../11-zgodnosc-prawna.md) § 6 | brama A, BL-133, BL-134 | właściciel |
| G-08 | Warunki atrybucji darmowych API (Alpha Vantage, Finnhub, Twelve Data, Marketaux) | [`../11-zgodnosc-prawna.md`](../11-zgodnosc-prawna.md) § 6 | przy włączaniu adaptera: M2 (BL-210), później (BL-702) | agent |
| G-09 | Wzorce opisów w historii finansowej mBank; kody typów archiwum GPW dla ETF i indeksów | [`../03-dane/formaty-importu.md`](../03-dane/formaty-importu.md) § 3–4 | M2, BL-208, BL-206 | agent |
| G-10 | Źródło szeregu stopy referencyjnej NBP w formie API | [`../03-dane/obliczenia-finansowe.md`](../03-dane/obliczenia-finansowe.md) § 8 | M3, BL-319 | agent |
| G-11 | Rozkład a priori Black–Litterman dla GPW; kalibracja poślizgu w backteście | [`../03-dane/obliczenia-finansowe.md`](../03-dane/obliczenia-finansowe.md) § 12.2, § 12.7 | M5b, BL-555, BL-558 | agent |
| G-12 | Zachowanie Androida: liczba skrótów w launcherze, plakietki, Web Share Target | [`../05-mobile/android-integracje.md`](../05-mobile/android-integracje.md), [`../05-mobile/strategia-mobilna.md`](../05-mobile/strategia-mobilna.md) | M4, BL-412; BL-708 | właściciel (testy na urządzeniach) |
| G-13 | Podstawa przekazania danych operatorom Web Push spoza EOG | [`../06-bezpieczenstwo/prywatnosc-rodo.md`](../06-bezpieczenstwo/prywatnosc-rodo.md) § 8 | przed bramą B | właściciel |
| G-14 | Stosowanie przepisów konsumenckich; przegląd regulaminu i informacji o danych przez prawnika | [`../11-zgodnosc-prawna.md`](../11-zgodnosc-prawna.md) § 7, [`../10-ograniczenia.md`](../10-ograniczenia.md) L-42 | przed udostępnieniem osobom spoza najbliższego kręgu (ustalone z właścicielem 2026-09-19) | właściciel |
| G-15 | Marża przewalutowania w koszcie podatkowym — rozstrzygnięta projektowo, prawnie niejednolita | [`../11-zgodnosc-prawna.md`](../11-zgodnosc-prawna.md) § 5.3 | obserwacja interpretacji; zmiana ustawieniem `tax_include_fx_fee` | właściciel |
| G-16 | Realne (lokalne, niecommitowane) eksporty właściciela do sprawdzenia parserów | [`../03-dane/fixtures/anonymized/README.md`](../03-dane/fixtures/anonymized/README.md), założenie A-06 | przed bramą A | właściciel |
| G-17 | Ceny opcji płatnych oznaczone NIEZWERYFIKOWANE; zakres ochrony anty-DDoS OVH | [`../10-ograniczenia.md`](../10-ograniczenia.md) | tylko przy decyzji o zakupie lub incydencie | właściciel |

**Świadomie poza dokumentacją:** makiety graficzne (wystarczają system projektowy i mapa ekranów; w razie potrzeby skill `frontend-design` przy M1), testy na urządzeniach i serwerach (wykonywane w etapach — kryteria wyjścia w roadmapie), formalna opinia prawna (G-14).

## 6. Zmiany wprowadzone w Kroku 7

- **Decyzja właściciela (2026-09-19):** marża przewalutowania brokera nie wchodzi do kosztu w widoku podatkowym; jest pokazywana jako osobny koszt (`fxCosts`), a ustawienie użytkownika `tax_include_fx_fee` pozwala to zmienić. Zmienione: `schema.sql` (`user_preferences.tax_date_basis`, `tax_include_fx_fee`, `lots.fx_fee_total`, `lot_consumptions.fx_cost_pln`), OpenAPI (`Preferences`, `PreferencesPatch`, `RealizedPl.taxSettings`), [`../03-dane/obliczenia-finansowe.md`](../03-dane/obliczenia-finansowe.md) § 2.2 i przykład A (osobny koszt 105,63 PLN; wariant z kosztem −1 055,83 PLN), wektor A, [`../11-zgodnosc-prawna.md`](../11-zgodnosc-prawna.md) § 5, [ADR-014](../09-decyzje/ADR-014-pieniadze-waluty-czas.md), mapa ekranów, instrukcja użytkownika, zadania BL-142 i BL-211.
- **Śledzenie:** jedyne wymaganie bez odwołania w dokumentach (NFR-08.04) przywołane w [`../03-dane/obliczenia-finansowe.md`](../03-dane/obliczenia-finansowe.md) § 14; nowe zadanie BL-035 (test spójności dokumentacji w CI) — M0 ma teraz 51 d, plan razem 327 d.
- **Etapy po podziale M5:** kalibracja poślizgu (M5b), audyt dostępności driver.js (M2), adaptery w [ADR-005](../09-decyzje/ADR-005-strategia-danych-rynkowych.md), wektory testowe w [ADR-003](../09-decyzje/ADR-003-hybryda-obliczen-i-kolejki.md) (M0), dostępność funkcji w instrukcji użytkownika.
- **Zdanie „Cel:”:** dopisane do 14 ADR-ów, do szablonu [ADR-000](../09-decyzje/ADR-000-szablon.md) (dla przyszłych decyzji) i do `CLAUDE.md` — wcześniej zaczynały się od metryczki zamiast celu.
- **Drobne:** nieaktualny znacznik ❓ w Z-15 (marża XTB potwierdzona w Kroku 4); budżet JS dla stron publicznych (`/akceptacja-regulaminu`, `/regulamin`, `/prywatnosc`, `/zrodla-danych`) w [`../04-frontend/wydajnosc.md`](../04-frontend/wydajnosc.md) § 3; opis skilla `vectorbt-reference` wskazuje `apps/analytics`.
