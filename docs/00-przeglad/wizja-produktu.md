# Wizja produktu — OligInvest

**Cel:** opisać, jaki problem rozwiązuje OligInvest, dla kogo, co wchodzi w zakres, a co świadomie z niego wyłączamy — tak, aby każdą decyzję projektową i każde zadanie dało się sprawdzić względem tej wizji.

Powiązane: [`wymagania.md`](wymagania.md) (FR/NFR z ID), [`specyfikacja-zrodlowa.md`](specyfikacja-zrodlowa.md) (treść zadania i decyzje), `docs/08-plan/mvp.md` (Krok 6).

## 1. Problem

Inwestor indywidualny z Polski, który inwestuje na GPW i rynku amerykańskim przez kilku brokerów, nie ma jednego, rzetelnego miejsca, w którym:

1. **widzi cały majątek inwestycyjny w PLN** — z poprawnym przeliczeniem walut, gotówką i dywidendami (brokerzy pokazują tylko własne rachunki, każdy inaczej);
2. **zna prawdziwy wynik** — stopę zwrotu ważoną czasem (TWR) i pieniądzem (XIRR), wynik po kosztach, po efekcie kursowym, porównany z benchmarkiem (brokerzy pokazują zwykle tylko prosty zysk/stratę pozycji);
3. **uczy się na własnych decyzjach** — dziennik z tezą i postmortem oraz statystyki skuteczności, które oddzielają jakość decyzji od szczęścia;
4. **myśli o przyszłości w kategoriach ryzyka** — scenariusze, rozkłady i testy warunków skrajnych zamiast „prognoz” i „sygnałów”;
5. **zachowuje prywatność** — dane finansowe nie trafiają do chmury firmy trzeciej, a całość działa za 0 zł na własnym serwerze.

Istniejące narzędzia open source (Ghostfolio, Wealthfolio, Portfolio Performance — patrz [ADR-001](../09-decyzje/ADR-001-baza-projektu.md)) rozwiązują część problemu, ale nie łączą GPW + PLN + polskiego kontekstu podatkowego + warstwy edukacyjnej + telefonu (iPhone) w lekkiej aplikacji webowej. Aplikacje komercyjne są płatne, zamknięte albo wymagają wysłania danych do dostawcy.

## 2. Użytkownicy

| Persona | Kim jest | Czego potrzebuje | Co jest dla niej sukcesem |
|---|---|---|---|
| **P1 — Właściciel-inwestor (admin)** | Doświadczony inwestor; rachunki w XTB (główny) i mBank eMakler; GPW + USA + ETF; używa iPhone’a i komputera; administruje serwerem domowym. | Pełny obraz portfela w PLN, rzetelne wyniki, analizy scenariuszowe, szybki podgląd z telefonu (Skróty, powiadomienia), kontrola nad danymi. | Import wyciągu XTB w < 2 min, liczby zgodne z brokerem, „ile dziś zarobiłem” jednym stuknięciem. |
| **P2 — Zaufany użytkownik (początkujący)** | Rodzina lub znajomi właściciela; mały portfel lub dopiero zaczynają; telefon z iOS lub Androidem. | Prosty widok portfela, wyjaśnienia pojęć „na miejscu”, nauka na danych demo, zero żargonu bez objaśnienia. | Rozumie, co widzi (np. czym jest drawdown), nie podejmuje decyzji pod wpływem „sygnałów”. |
| **P3 — Uczący się bez portfela** | Osoba z zaproszeniem, która dopiero chce zrozumieć inwestowanie. | Tryb demo, samouczki, glosariusz. | Przechodzi ścieżkę nauki i ćwiczenia bez ryzyka. |

Liczba użytkowników: ≤ 10 kont, ≤ 5 jednocześnie (założenie A-03). Rejestracja wyłącznie z zaproszenia.

## 3. Propozycja wartości

> Jedno prywatne miejsce, które pokazuje prawdę o Twoim portfelu w złotówkach, uczy czytać liczby i pomaga myśleć o ryzyku — bez prognoz, bez reklam, bez wysyłania danych komukolwiek.

## 4. Zasady produktu

1. **Scenariusze, nie wyrocznie.** Żadnych prognoz punktowych („cena za 30 dni = X”), żadnych poleceń „kup/sprzedaj”. Wyniki analiz to rozkłady z założeniami i przedziałami (FR-04.01).
2. **Każda liczba ma źródło i czas.** Użytkownik zawsze wie, skąd pochodzą dane i jak są stare (FR-01.15).
3. **Szybko na telefonie.** Wydajność jest wymaganiem równorzędnym z funkcjami (NFR-01); funkcja, która łamie budżet, czeka lub zostaje uproszczona.
4. **Prywatność domyślnie.** Dane zostają na serwerze właściciela; brak trackerów; admin nie widzi portfeli innych użytkowników (FR-08.01).
5. **Uczy, nie tylko pokazuje.** Każda metryka ma wyjaśnienie; aplikacja zachęca do refleksji (dziennik, postmortem), nie do nadmiernego handlu.
6. **Poprawność ponad efektowność.** Liczby muszą zgadzać się z wyciągiem brokera; wzory są udokumentowane i przetestowane (NFR-08).
7. **0 zł i prostota.** Mniej zależności, mniej warstw; gotowe rozwiązania zamiast własnych, gdy istnieją (NFR-05, NFR-10.05).

## 5. Zakres

| Obszar | W zakresie | Priorytet dominujący | Wymagania |
|---|---|---|---|
| Analiza rynku | Wyszukiwarka, karta instrumentu, wykres świecowy (EOD), wskaźniki, watchlisty, indeksy, kursy NBP; później heatmapa, screener, kalendarz, newsy | P0–P2 | FR-01 |
| Portfel — stan obecny | Rachunki, pozycje, gotówka, wycena (opóźniona/EOD), P/L, wynik dnia, alokacja, ekspozycja walutowa, dywidendy | P0–P1 | FR-02 |
| Analiza przeszła | Import XTB/mBank/ręczny, FIFO/średnia, TWR/XIRR, benchmark, obsunięcia, dziennik z postmortem, statystyki decyzji | P0–P2 | FR-03 |
| Analiza przyszła | Monte Carlo, rebalancing, optymalizacja, testy skrajne, „co jeśli”, backtest — zawsze jako scenariusze | P1–P2 | FR-04 |
| Alerty | Cenowe, portfelowe, na wskaźnikach; Web Push + e-mail; później wyniki i newsy | P1–P3 | FR-05 |
| Edukacja | Onboarding, wyjaśnienia kontekstowe, glosariusz, tryb demo, ścieżki nauki | P1–P3 | FR-06 |
| Konta i bezpieczeństwo | Zaproszenia, hasło + obowiązkowy TOTP, role, tokeny API, RODO | P0–P1 | FR-07 |
| Administracja | Użytkownicy, sesje, limity, flagi, audyt, status integracji, kolejki, health | P0–P2 | FR-08 |
| Mobile i integracje | PWA (iOS/Android/desktop), Web Push, Skróty iOS, HTTP Shortcuts, linki głębokie | P1–P3 | FR-09 |

## 6. Poza zakresem (świadomie)

| Poza zakresem | Dlaczego | Czy może wrócić? |
|---|---|---|
| Składanie zleceń, handel, połączenia z rachunkiem w trybie zapisu | Ryzyko regulacyjne i bezpieczeństwa; nie jest celem produktu | Nie |
| Doradztwo inwestycyjne, rekomendacje, sygnały „kup/sprzedaj”, prognozy punktowe | MiFID II / rekomendacje inwestycyjne; zasada 1 | Nie |
| Dane czasu rzeczywistego | Brak darmowego legalnego źródła (Z-01) | Tylko przy płatnym źródle (`10-ograniczenia.md`) |
| Publiczna rejestracja, SaaS, płatności, subskrypcje | Aplikacja prywatna; licencje danych nie pozwalają na redystrybucję | Nie bez zmiany źródeł danych i statusu prawnego |
| Natywne aplikacje w App Store / Google Play | Koszt konta Apple (99 USD/rok) i czas; PWA wystarcza (ADR-008) | Tak, jeśli budżet się zmieni |
| Instrumenty pochodne (CFD, opcje, kontrakty) w modelu portfela | Inny model ryzyka i rozliczeń; w MVP tylko rozpoznanie przy imporcie (Z-15) | Tak, jako osobny moduł |
| Kryptowaluty i DeFi | Poza głównym przypadkiem użycia; CoinGecko rozważony jako przyszłe źródło | Tak, P3+ |
| Rozliczenie PIT-38 / generowanie deklaracji podatkowych | Ryzyko doradztwa podatkowego; wymaga osobnej walidacji prawnej | Możliwe „zestawienie pomocnicze” z disclaimerem (przyszłość) |
| Funkcje społecznościowe (udostępnianie portfeli, ranking) | Prywatność | Nie |
| Porady generowane przez LLM | Ryzyko halucynacji i rekomendacji | Tylko streszczenia edukacyjne, poza obecnym planem |

## 7. Ograniczenia ramowe

- **Budżet operacyjny 0 zł** — posiadany serwer (Dell 7020, i5-4590, 16 GB, Proxmox obok Immich), mały VPS w OVH jako edge, domena `oligi.pl`, certyfikaty ACME (NFR-05).
- **Dane:** tylko darmowe źródła z ich limitami i licencjami (`03-dane/zrodla-danych.md`); brak redystrybucji poza użytkowników.
- **Budowa:** kod powstanie w Codex (GPT-6) na podstawie tej dokumentacji i `AGENTS.md`; dokumentacja musi być samowystarczalna.
- **Repozytorium publiczne** — bez sekretów i szczegółów infrastruktury (NFR-03.12).

## 8. Miary sukcesu

| Miara | Cel | Jak mierzymy |
|---|---|---|
| Czas od pliku z XTB do widoku portfela | < 2 min (w tym podgląd i zatwierdzenie) | Test e2e + obserwacja |
| Zgodność z brokerem po imporcie | 100 % ilości i gotówki; P/L zrealizowany ±0,01 PLN lub wyjaśnienie | Raport uzgodnienia (NFR-08.03) |
| Wydajność na telefonie | LCP p75 < 2,0 s, INP p75 < 200 ms | Lighthouse CI + RUM (NFR-01.01) |
| Używanie przez właściciela | ≥ 3 sesje tygodniowo po 3 miesiącach | Własne, anonimowe liczniki w bazie (bez zewnętrznej analityki) |
| Zrozumiałość dla początkujących | Każda metryka w UI ma wyjaśnienie | Test pokrycia treści (FR-06.02) |
| Bezpieczeństwo | 0 incydentów wycieku; test odtworzenia kopii co kwartał zaliczony | Rejestr incydentów, protokoły DR (NFR-09.03) |
| Koszt | 0 zł miesięcznie | Przegląd `10-ograniczenia.md` |

## 9. Etapy (wysokopoziomowo)

M0 szkielet i infrastruktura → **M1 MVP** (import XTB, wycena opóźniona/EOD, P/L FIFO, wynik dnia, wykres świecowy, zaproszenia + hasło + TOTP, kopie zapasowe) → M2 dane rynkowe i wskaźniki → M3 wyniki historyczne i analizy scenariuszowe → M4 alerty, PWA, Skróty → M5 admin, edukacja, screener, newsy → M6 hardening i dostępność. Szczegóły i kryteria wyjścia: `docs/08-plan/roadmapa.md` (Krok 6).

## 10. Kwestie otwarte

| ID | Kwestia | Kto rozstrzyga | Termin |
|---|---|---|---|
| Q-01 | Adres aplikacji (`invest.oligi.pl`?) | Właściciel | przed Krokiem 5 |
| Q-02 | Specyfikacja VPS i obecne miejsce terminacji TLS (VPS czy dom) | Właściciel | przed Krokiem 5 |
| Q-03 | Licencja projektu w repozytorium publicznym | Właściciel | przed pierwszym kodem (M0) |
| Q-04 | Anonimizowane pliki eksportu XTB i mBank jako fixtures | Właściciel | przed M1 |
| Q-05 | Tabela opłat XTB (przewalutowanie, prowizje) do modelu kosztów | Claude (weryfikacja) | Krok 4 |
