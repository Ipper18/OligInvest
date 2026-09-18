# Specyfikacja źródłowa i decyzje doprecyzowujące

**Cel:** przechować oryginalną treść zadania oraz odpowiedzi właściciela na pytania doprecyzowujące, aby każde wymaganie (`FR-*`, `NFR-*`) i każda decyzja dały się prześledzić do źródła — oznaczenia „§” w dokumentacji odnoszą się do numeracji sekcji poniżej.

---

## 1. Decyzje doprecyzowujące

### 1.1 Krok 0 — odpowiedzi na pytania (2026-09-18)

| # | Pytanie | Odpowiedź właściciela |
|---|---|---|
| 1 | Serwer | Dell OptiPlex 7020: i5-4590 (4C/4T, 3,3–3,7 GHz), 16 GB DDR3, SSD 240 GB + HDD 1 TB, Gigabit Ethernet. Działa na nim Proxmox VE (m.in. Immich) i nginx. Ruch spoza sieci domowej przechodzi przez WireGuard do małego VPS w OVH. Domena `oligi.pl`. Nazwa aplikacji: **OligInvest**. |
| 2 | Użytkownicy | Tylko prywatna: właściciel + kilka zaufanych osób. |
| 3 | Obliczenia analityczne | Hybryda: `packages/core` w TypeScript + worker w Pythonie. |
| 4 | Baza i uwierzytelnianie | Self-host PostgreSQL + Redis, Better Auth. |
| 5 | Brokerzy | Głównie XTB (zakładane darmowe konto), także mBank eMakler; inne tylko z darmowym API. |
| 6 | Opóźnienie danych | Opóźnione ~15 min + EOD dla GPW (MVP). |
| 7 | Urządzenia mobilne | Głównie iPhone bez konta Apple Developer (PWA + Skróty); Android ma działać; desktop Windows/macOS. |
| 8 | Topologia | Aplikacja w VM na Proxmoxie, VPS = wyłącznie edge. |

### 1.2 Krok 1–2 — akceptacje (2026-09-18)

- Faza 0 (środowisko, audyt pluginów) — zaakceptowana.
- Stos technologiczny z raportu Fazy 1 — zaakceptowany; szczegóły i późniejsze doprecyzowania w [`../01-architektura/stack-technologiczny.md`](../01-architektura/stack-technologiczny.md).
- Repozytorium GitHub: **publiczne**. Gałąź główna: **`main`**.

---

## 2. Oryginalna treść zadania (bez zmian)

# ZADANIE: Opracowanie planu architektonicznego i pełnej dokumentacji aplikacji webowej do analizy inwestycji

## 0. TRYB PRACY — PRZECZYTAJ NAJPIERW

NIE budujesz aplikacji. W tej sesji powstaje WYŁĄCZNIE:
(a) skonfigurowane środowisko Claude Code (pluginy, skille, MCP),
(b) research istniejących rozwiązań,
(c) kompletna dokumentacja projektowa i plan wdrożenia.
(d) budawa bedzie przeprowadzana w CODEX na modelu GPT-6

Jedyny kod, jaki wolno Ci wytworzyć, to: pliki konfiguracyjne (.mcp.json, CLAUDE.md, AGENT.md
.gitignore, .env.example), schematy (OpenAPI YAML, SQL DDL, Prisma/Drizzle schema),
diagramy (Mermaid) i krótkie fragmenty ilustracyjne w dokumentacji (max 30 linii).
Zero implementacji komponentów, endpointów, logiki biznesowej.

Pracuj w trybie planowania. Zanim zaczniesz generować dokumenty, zadaj mi maksymalnie
8 pytań doprecyzowujących w jednej wiadomości — tam, gdzie moja specyfikacja jest
niejednoznaczna i gdzie wybór realnie zmienia architekturę. Potem czekaj na odpowiedź.

Po każdej ukończonej fazie zatrzymaj się i poproś o akceptację przed przejściem dalej.

---

## 1. FAZA 0 — PRZYGOTOWANIE ŚRODOWISKA (wykonaj realnie, nie opisuj)

### 1.1 Pluginy z oficjalnego marketplace Anthropic
Zainstaluj i potwierdź działanie:

```
/plugin install frontend-design@claude-plugins-official
/plugin install feature-dev@claude-plugins-official
/plugin install code-review@claude-plugins-official
/plugin install security-guidance@claude-plugins-official
```

Sprawdź też dostępność i zainstaluj, jeśli są w rejestrze, pluginy partnerskie
istotne dla tego projektu: Supabase, Playwright, Sentry, Vercel, GitHub.

### 1.2 Skille domenowe (finanse/quant) — instalacja per-projekt, nie globalnie

Przed instalacją KAŻDEGO repozytorium społecznościowego wykonaj audyt:
przejrzyj SKILL.md, wszystkie skrypty (.sh/.py/.js), plugin.json / marketplace.json,
datę ostatniego commita, licencję. Odrzuć i zgłoś mi każde repo, które: wykonuje
sieciowe wywołania do nieudokumentowanych hostów, czyta zmienne środowiskowe spoza
własnego zakresu, instaluje zależności bez pinowania wersji, lub jest nieutrzymywane
ponad 6 miesięcy. Raport z audytu zapisz w `docs/09-decyzje/audyt-pluginow.md`.

Kandydaci do oceny:
- https://github.com/tradermonty/claude-trading-skills
  (analiza akcji, screenery, kalendarz earnings, backtest-expert, technical-analyst;
   UWAGA: część skilli wymaga PŁATNYCH API — FMP/FINVIZ Elite. Oznacz, które skille
   działają bez płatnego klucza, resztę wyłącz.)
- https://github.com/shakeebshaan/claude-code-quant-skills
  (backtest-review, strategy-critique, risk-report, data-scrub — warstwa krytyki
   metodologicznej: look-ahead bias, przeuczenie. TO JEST PRIORYTET.)
- https://github.com/marketcalls/vectorbt-backtesting-skills
  (instalacja: `npx skills add marketcalls/vectorbt-backtesting-skills -l` aby
   najpierw wylistować, potem wybiórczo)
- https://github.com/Trade-With-Claude/cbt-framework
  (oceń, czy nie duplikuje powyższych; jeśli duplikuje — pomiń i uzasadnij)
- https://github.com/agiprolabs/claude-trading-skills
  (crypto/DeFi-first — wyciągnij TYLKO moduły przekrojowe: risk management,
   portfolio analytics, podatki/cost basis)

Katalogi do przeszukania pod kątem dodatkowych, lepszych opcji:
- https://claudemarketplaces.com/
- https://buildwithclaude.com/
- https://www.aitmpl.com/plugins/

### 1.3 Serwery MCP — danych rynkowych i narzędziowe
Skonfiguruj `.mcp.json` w katalogu projektu (wersjonowany), z kluczami WYŁĄCZNIE ze
zmiennych środowiskowych. Dodaj `.env.example` z pustymi kluczami. Zweryfikuj składnię
przez `claude mcp --help` — nie zakładaj jej z pamięci.

Skonfiguruj minimum: serwer danych rynkowych (darmowy tier), serwer dokumentacji
bibliotek (np. Context7 lub odpowiednik), Playwright MCP.

### 1.4 Plik CLAUDE.md
Utwórz `CLAUDE.md` w katalogu głównym, zawierający: kontekst projektu, stack, zasady
kodowania, konwencje nazewnicze, politykę sekretów, wymóg disclaimerów regulacyjnych,
listę aktywnych skilli i kiedy ich używać.

---

## 2. FAZA 1 — RESEARCH (nie buduj niczego od zera bez uzasadnienia)

Twardy wymóg: dla każdego elementu systemu najpierw sprawdź, czy istnieje gotowe,
darmowe, open-source'owe rozwiązanie. Budowa własna wymaga jednoakapitowego
uzasadnienia w `docs/09-decyzje/`.

### 2.1 Darmowe źródła danych — wymagana tabela porównawcza
Przeszukaj m.in.:
- https://github.com/public-apis/public-apis (sekcja Finance)
- https://github.com/toddmotto/public-apis
- awesome-quant, awesome-fintech na GitHubie

Zbadaj i ZWERYFIKUJ AKTUALNE limity darmowych tierów (stan na dziś, nie z pamięci):
Alpha Vantage, Finnhub, Twelve Data, Tiingo, Polygon (free), EODHD (free),
Financial Modeling Prep (free), yfinance / Yahoo Finance (nieoficjalne),
Stooq (dane GPW, CSV — istotne, bo rynek polski), NBP API (kursy walut, złoto),
FRED (makro), SEC EDGAR (filingi), CoinGecko, Frankfurter/ExchangeRate API,
GDELT lub inne darmowe źródło newsów/sentymentu.

Tabela w `docs/03-dane/zrodla-danych.md` musi zawierać kolumny:
| Dostawca | Zakres (klasy aktywów, giełdy, czy GPW) | Limit free | Opóźnienie danych |
| Wymaga karty? | Licencja / czy wolno redystrybuować w publicznej aplikacji |
| Stabilność | Rola w naszym systemie (primary / fallback / makro) | Link do ToS |

Zaprojektuj warstwę abstrakcji `DataProvider` z łańcuchem fallbacków i twardym
cache'owaniem — limity typu 25 zapytań/dobę są realnym ograniczeniem architektonicznym,
nie detalem. Opisz strategię cache (TTL per typ danych, invalidacja, warm-up).

### 2.2 Gotowe biblioteki do oceny
- Wykresy: TradingView Lightweight Charts vs. ECharts vs. Recharts vs. visx
  (kryterium: świece + wolumen + 10 lat danych + płynność na telefonie)
- Analiza techniczna: pandas-ta, TA-Lib, tulipindicators, technicalindicators (JS)
- Backtesting: vectorbt, backtesting.py, nautilus_trader
- Portfel/ryzyko: pyfolio-reloaded, quantstats, empyrical, PyPortfolioOpt
- Tabele danych: TanStack Table + virtualizacja
- Auth: Supabase Auth / Better Auth / Auth.js / Keycloak (self-hosted)
- Admin panel: Refine, React-Admin, AdminJS, Directus — NIE pisz panelu od zera
- Realtime: WebSocket vs. SSE vs. Supabase Realtime
- Onboarding/samouczki: driver.js, Shepherd.js, react-joyride

### 2.3 Gotowe aplikacje open-source do inspiracji lub forka
Znajdź i oceń istniejące OSS: Ghostfolio, Maybe Finance, Firefly III, OpenBB,
Wealthfolio, portfolio-performance i inne, które znajdziesz. Dla każdego:
licencja, stack, czy da się wykorzystać jako bazę lub zapożyczyć moduł,
czy szybciej będzie napisać samemu. Wnioski w `docs/09-decyzje/ADR-001-baza-projektu.md`.

---

## 3. WYMAGANIA PRODUKTOWE

### 3.1 Funkcje rdzeniowe
1. **Analiza rynku w czasie rzeczywistym** — notowania, wykresy świecowe z wskaźnikami
   (SMA/EMA/RSI/MACD/Bollinger/ATR/Volume Profile), heatmapy sektorowe, screener,
   kalendarz earnings i danych makro, agregowane newsy z oceną sentymentu.
2. **Portfel — stan obecny** — pozycje, alokacja (klasa aktywów/sektor/geografia/waluta),
   wycena live, P/L zrealizowany i niezrealizowany, dywidendy, ekspozycja walutowa
   (istotne przy PLN vs USD).
3. **Analiza inwestycji przeszłych** — import transakcji (CSV od brokera + ręcznie),
   TWR i MWR/XIRR, cost basis (FIFO/średnia), benchmark vs. indeks, atrybucja wyniku,
   drawdowny, dziennik transakcji z postmortem, statystyki skuteczności decyzji.
4. **Analiza inwestycji przyszłych** — i tu obowiązuje dyscyplina: budujesz
   SCENARIUSZE I ROZKŁADY, nie prognozy punktowe. Symulacja Monte Carlo, optymalizacja
   portfela (Markowitz / Black-Litterman / risk parity), testy warunków skrajnych,
   analiza „co jeśli” dla hipotetycznej pozycji, kalkulator rebalancingu, screening
   kandydatów wg zdefiniowanych przez użytkownika kryteriów, backtest strategii.
   ZAKAZ: wyświetlania „cena za 30 dni = X”, wyroczni, sygnałów bez przedziału ufności
   i bez opisu założeń.
5. **System alertów** — cenowe, na wskaźnikach, na wynikach, na newsach; push + e-mail.
6. **Samouczki i warstwa edukacyjna** — interaktywny onboarding, kontekstowe wyjaśnienia
   wskaźników (tooltip „co to jest RSI i jak to czytać”), tryb demo z danymi sandbox,
   glosariusz. Ma uczyć inwestowania, nie tylko wyświetlać liczby.

### 3.2 Użytkownicy i administracja
- Rejestracja/logowanie: e-mail + hasło, OAuth (Google/GitHub), obowiązkowe 2FA (TOTP).
- Role: user / pro / admin, model RBAC.
- Panel administratora: zarządzanie użytkownikami, sesjami, limitami API, feature flagami,
  podgląd logów audytowych, statusem integracji, kolejkami zadań, health-checkami.
- Pełny audit log działań administracyjnych.

---

## 4. WYMAGANIA NIEFUNKCJONALNE — TRAKTUJ JAKO TWARDE

### 4.1 Wydajność (priorytet równy funkcjom)
- LCP < 2,0 s, INP < 200 ms, CLS < 0,1 na 4G i na telefonie średniej klasy.
- Initial JS bundle < 200 KB gzip. Code splitting per moduł. Brak eager-loadingu
  bibliotek wykresów i silnika analitycznego.
- Wykresy: virtualizacja, decymacja punktów, canvas/WebGL zamiast SVG na dużych seriach.
- Budżety wydajnościowe zapisane w dokumencie i egzekwowane w CI (Lighthouse CI).
- Zdefiniuj, co ładuje się server-side, co client-side, co jest streamowane.
„Nie ma to być długo ładujący się moloch” jest wymaganiem kontraktowym — jeśli jakaś
funkcja stoi z tym w konflikcie, zgłoś konflikt zamiast go ukrywać.

### 4.2 Modularność i rozszerzalność
- Monorepo (Turborepo lub Nx) z wyraźnym podziałem: `apps/` i `packages/`.
- Architektura modułowa z jawnymi granicami: każdy moduł funkcjonalny (market, portfolio,
  analytics, alerts, admin, education) ma własne API, własny model domenowy i może być
  dodany/usunięty bez modyfikacji pozostałych.
- Wewnętrzny system pluginów/feature flag: opisz, jak dodanie nowego modułu w przyszłości
  wygląda krok po kroku (checklista dla dewelopera).
- Warstwa dostawców danych jako wymienne adaptery (port/adapter).
- Zasady wersjonowania API, polityka breaking changes.

### 4.3 Bezpieczeństwo — pełny rozdział, nie akapit
Wymagany osobny dokument `docs/06-bezpieczenstwo/`:
- Model zagrożeń STRIDE dla każdego modułu, z macierzą ryzyk.
- Mapowanie na OWASP Top 10 (2021+) i OWASP ASVS L2 — kontrola po kontroli.
- Uwierzytelnianie: hashowanie (Argon2id), polityka sesji, rotacja refresh tokenów,
  ochrona przed credential stuffing, rate limiting i lockout, 2FA TOTP + kody zapasowe.
- Autoryzacja: RBAC + Row Level Security na poziomie bazy (obowiązkowe — dane finansowe
  użytkowników nie mogą wyciec przez błąd w kodzie aplikacji).
- Szyfrowanie: TLS 1.3, HSTS, szyfrowanie danych wrażliwych at-rest, zarządzanie
  kluczami i sekretami (co przechowuje serwer, czego NIE przechowuje).
- Nagłówki: CSP (bez unsafe-inline), X-Frame-Options, Referrer-Policy, Permissions-Policy.
- Walidacja wejścia (Zod), ochrona przed SQLi/XSS/CSRF/SSRF, sanityzacja danych z API.
- Bezpieczeństwo łańcucha dostaw: pinowanie zależności, Dependabot/Renovate, SCA,
  SBOM, podpisywanie obrazów kontenerów.
- Logowanie i monitoring bezpieczeństwa, wykrywanie anomalii, plan reagowania na incydent.
- RODO/GDPR: podstawa przetwarzania, retencja, eksport i usunięcie danych użytkownika.
- Backupy: strategia 3-2-1, szyfrowane, PRZETESTOWANY plan odtwarzania (RPO/RTO).
- Hardening serwera: firewall, fail2ban/CrowdSec, SSH bez haseł, nieuprzywilejowane
  kontenery, reverse proxy, automatyczna odnowa certyfikatów.

### 4.4 Wielo­platformowość i integracje mobilne
- Web (desktop + mobile) jako PWA: installable, offline shell, push notifications.
- Aplikacje mobilne iOS/Android — przeanalizuj i zarekomenduj: PWA vs. Capacitor
  vs. React Native/Expo. Kryteria: koszt (ma być 0), push, widgety, czas wdrożenia,
  konieczność konta developerskiego Apple (99 USD/rok — to KOSZT, uwzględnij
  i zaproponuj ścieżkę bezkosztową, np. PWA przez Safari + Skróty).
- **iOS**: integracja przez aplikację Skróty (Shortcuts) — App Intents / URL scheme /
  x-callback-url, co pozwala spiąć akcje aplikacji z „Stuknięcie w tył” (Back Tap),
  automatyzacjami, Siri i widgetami na ekranie blokady. Opisz konkretnie, jakie akcje
  wystawiamy (np. „pokaż mój portfel”, „dodaj transakcję”, „ile dziś zarobiłem”)
  i jak użytkownik to konfiguruje — to trafia do dokumentacji użytkownika.
- **Android**: widgety, Quick Settings tile, intencje/deep linki, integracja z Tasker.
- Współdzielona logika biznesowa w `packages/core` — jedna implementacja obliczeń
  finansowych dla wszystkich platform.

### 4.5 Ograniczenie budżetowe — twarde
Budżet operacyjny: 0 zł, poza już posiadanym serwerem, domeną i certyfikatem SSL.
Każdy komponent stosu musi być: self-hostowalny lub mieć trwały darmowy tier.
Jeżeli jakiekolwiek wymaganie jest niemożliwe do spełnienia za 0 zł — NIE udawaj,
że jest. Wypisz to jawnie w `docs/10-ograniczenia.md` z podaniem: czego dotyczy,
ile kosztuje najtańsza opcja, jaki jest darmowy substytut i co tracimy.

---

## 5. WYMAGANE PRODUKTY PRACY (deliverables)

Utwórz dokładnie taką strukturę (dopuszczalne rozszerzenie, nie okrojenie).
Język dokumentacji: polski. Nazwy techniczne, kod i identyfikatory: angielski.

```
docs/
├── 00-przeglad/
│   ├── wizja-produktu.md          # problem, użytkownik, zakres, poza zakresem
│   ├── wymagania.md               # funkcjonalne + niefunkcjonalne, z ID (FR-01, NFR-01)
│   └── slownik-pojec.md
├── 01-architektura/
│   ├── przeglad-architektury.md   # diagramy C4 (L1-L3) w Mermaid
│   ├── stack-technologiczny.md    # z uzasadnieniem KAŻDEGO wyboru
│   ├── moduly.md                  # granice, kontrakty, zależności
│   └── przeplywy-danych.md        # sekwencje Mermaid dla kluczowych scenariuszy
├── 02-api/
│   ├── openapi.yaml               # pełna specyfikacja REST
│   ├── realtime.md                # kontrakty WebSocket/SSE
│   └── konwencje-api.md           # błędy, paginacja, wersjonowanie, rate limity
├── 03-dane/
│   ├── zrodla-danych.md           # tabela z sekcji 2.1
│   ├── model-danych.md            # ERD w Mermaid
│   ├── schema.sql                 # DDL
│   ├── strategia-cache.md
│   └── obliczenia-finansowe.md    # DEFINICJE WZORÓW: TWR, XIRR, cost basis,
│                                  # Sharpe, max drawdown, VaR — z jednostkami
│                                  # i obsługą walut. To jest krytyczne.
├── 04-frontend/
│   ├── architektura-ui.md
│   ├── system-projektowy.md       # tokeny, typografia, kolory, dark mode,
│   │                              # kolorystyka zysk/strata z uwzgl. daltonizmu
│   ├── mapa-ekranow.md            # lista widoków + hierarchia nawigacji
│   ├── wydajnosc.md               # budżety, strategia ładowania
│   └── dostepnosc.md              # WCAG 2.1 AA
├── 05-mobile/
│   ├── strategia-mobilna.md
│   ├── ios-integracje.md          # Shortcuts, App Intents, Back Tap, widgety
│   └── android-integracje.md
├── 06-bezpieczenstwo/
│   ├── model-zagrozen.md          # STRIDE
│   ├── kontrole-bezpieczenstwa.md # mapowanie OWASP ASVS
│   ├── uwierzytelnianie-autoryzacja.md
│   ├── prywatnosc-rodo.md
│   └── plan-reagowania.md
├── 07-wdrozenie/
│   ├── infrastruktura.md          # topologia serwera, kontenery, sieć
│   ├── ci-cd.md
│   ├── monitoring.md              # metryki, logi, alerty, health checks
│   └── backup-dr.md
├── 08-plan/
│   ├── roadmapa.md                # etapy z kryteriami wyjścia
│   ├── mvp.md                     # najmniejszy użyteczny zakres — bądź bezlitosny
│   ├── backlog.md                 # zadania z estymacją i zależnościami
│   └── ryzyka.md                  # rejestr ryzyk z mitygacją
├── 09-decyzje/
│   ├── ADR-000-szablon.md
│   ├── ADR-001-... (jeden plik na decyzję: kontekst/opcje/decyzja/konsekwencje)
│   └── audyt-pluginow.md
├── 10-ograniczenia.md             # czego NIE da się zrobić za 0 zł i dlaczego
├── 11-zgodnosc-prawna.md          # MiFID II, status "rekomendacji inwestycyjnej",
│                                  # wymagane disclaimery, licencje danych
└── 12-dla-uzytkownika/
    ├── instrukcja.md
    └── samouczki.md
```

Dodatkowo w katalogu głównym: `README.md`, `CLAUDE.md`, `.mcp.json`, `.env.example`,
`.gitignore`, `CONTRIBUTING.md` (konwencje commitów, przepływ gałęzi, definition of done).

---

## 6. ZASADY, KTÓRYCH MASZ PRZESTRZEGAĆ

1. **Weryfikuj, nie zgaduj.** Limity API, wersje bibliotek, warunki licencji — sprawdź
   w sieci i podaj link. Jeśli czegoś nie udało się zweryfikować, oznacz jako
   NIEZWERYFIKOWANE zamiast podawać liczbę z pamięci.
2. **Nie wymyślaj gotowych rozwiązań, które nie istnieją.** Każdy link ma działać.
3. **Kwestionuj moje założenia.** Jeśli któreś z moich wymagań jest technicznie
   sprzeczne, nierealne przy budżecie 0 zł albo szkodliwe dla wydajności — napisz to
   wprost w osobnej sekcji „Zastrzeżenia do specyfikacji” i zaproponuj alternatywę.
   Nie chcę planu, który zgadza się ze wszystkim.
4. **Dyscyplina metodologiczna w części analitycznej.** Zastosuj skille krytyczne
   (strategy-critique, backtest-review). Każda funkcja predykcyjna musi mieć
   udokumentowane założenia, źródło danych, ograniczenia i ryzyko look-ahead bias,
   survivorship bias oraz przeuczenia.
5. **Status regulacyjny.** Aplikacja generująca sugestie inwestycyjne może w UE podlegać
   MiFID II i przepisom o rekomendacjach inwestycyjnych. Opisz to i zaprojektuj
   obowiązkowe disclaimery w UI. Aplikacja doradza edukacyjnie, nie wydaje poleceń.
6. **Prostota struktury.** Preferuj mniej warstw i mniej zależności. Każda dodatkowa
   biblioteka wymaga uzasadnienia. Jeśli coś da się zrobić standardem platformy — zrób.
7. **Dokumentacja jest produktem.** Ma być na tyle dobra, żeby nowy deweloper (albo ja
   za trzy miesiące, albo inna sesja Claude Code) mógł kontynuować pracę bez
   dopytywania. Każdy dokument zaczyna się od jednozdaniowego celu.

---

## 7. KOLEJNOŚĆ WYKONANIA

- **Krok 0**: Zadaj mi maksymalnie 8 pytań doprecyzowujących. STOP, czekaj.
- **Krok 1**: Faza 0 — środowisko, pluginy, audyt. Pokaż raport. STOP.
- **Krok 2**: Faza 1 — research API, bibliotek i istniejących OSS. Pokaż tabele
  i rekomendacje ze stackiem. STOP, czekaj na akceptację stacku.
- **Krok 3**: Dokumenty 00, 01, 09 (wizja, wymagania, architektura, ADR-y). STOP.
- **Krok 4**: Dokumenty 02–05 (API, dane, frontend, mobile). STOP.
- **Krok 5**: Dokumenty 06–07 (bezpieczeństwo, wdrożenie). STOP.
- **Krok 6**: Dokumenty 08, 10–12 (plan, ograniczenia, prawo, instrukcje) + README.
- **Krok 7**: Przegląd spójności całości: sprawdź, czy każde wymaganie z sekcji 3 i 4
  ma pokrycie w dokumentacji. Wygeneruj macierz śledzenia wymagań
  (`docs/00-przeglad/macierz-pokrycia.md`) — wymaganie → dokument → zadanie w backlogu.
  Wypisz luki, jeśli są.

Zacznij od Kroku 0. potem przygotuj caly plan i zapisz go wraz z promptem/promptami do codex jak potem zaczac budowe
