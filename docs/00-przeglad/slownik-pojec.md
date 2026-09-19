# Słownik pojęć

**Cel:** ujednolicić znaczenie terminów finansowych, metodologicznych, prawnych i technicznych używanych w dokumentacji i w kodzie, tak aby każdy czytelnik (i agent budujący aplikację) rozumiał je tak samo.

Konwencja: **Termin (ang. odpowiednik, identyfikator w kodzie)** — definicja. Wzory liczbowe są zdefiniowane wyłącznie w [`../03-dane/obliczenia-finansowe.md`](../03-dane/obliczenia-finansowe.md); tutaj tylko znaczenie. Glosariusz dla użytkowników aplikacji (FR-06.03) powstaje na bazie tego słownika, ale prostszym językiem.

## 1. Rynki i instrumenty

- **Akcja** (*share, stock*) — papier udziałowy spółki notowany na giełdzie.
- **ETF** (*Exchange Traded Fund*) — fundusz notowany na giełdzie, zwykle odwzorowujący indeks.
- **CFD** (*Contract for Difference*) — kontrakt na różnicę kursową oferowany przez brokera (np. XTB); instrument pochodny z dźwignią, bez własności instrumentu bazowego. W OligInvest nieobsługiwany w modelu portfela (Z-15).
- **GPW** — Giełda Papierów Wartościowych w Warszawie; kod rynku (MIC) `XWAR`.
- **NewConnect** — alternatywny system obrotu prowadzony przez GPW.
- **MIC** (*Market Identifier Code*, ISO 10383) — kod rynku, np. `XWAR`, `XNYS`, `XNAS`.
- **ISIN** (ISO 6166) — międzynarodowy, 12-znakowy identyfikator papieru wartościowego, np. `PLPKO0000016`.
- **Ticker / symbol** — skrót notowania; różny u różnych dostawców (np. `PKO`, `PKO.WA`). W systemie mapowany na kanoniczny identyfikator instrumentu.
- **Identyfikator instrumentu** (`instrument_id`) — kanoniczna tożsamość instrumentu w OligInvest (ISIN + MIC), niezależna od dostawcy danych.
- **Indeks giełdowy** — miara wartości koszyka instrumentów, np. WIG20 (20 największych spółek GPW), WIG, mWIG40, sWIG80, S&P 500, Nasdaq-100.
- **Subindeks sektorowy** — indeks GPW obejmujący spółki jednego sektora (np. WIG-banki); w OligInvest źródło klasyfikacji sektorowej spółek GPW (Z-10).
- **Sesja giełdowa** — okres notowań; dla GPW notowania ciągłe ok. 9:00–17:00 czasu warszawskiego (dokładny kalendarz w tabeli `trading_calendar`).
- **OHLCV** — cena otwarcia (*Open*), maksimum (*High*), minimum (*Low*), zamknięcia (*Close*) i wolumen (*Volume*) w danym interwale.
- **Świeca** (*candlestick*) — graficzna reprezentacja OHLC dla interwału.
- **EOD** (*End of Day*) — dane dzienne dostępne po zamknięciu sesji.
- **Dane opóźnione** (*delayed quotes*) — notowania udostępniane z opóźnieniem (typowo ~15 min).
- **Kurs skorygowany** (*adjusted price*) — historyczny kurs przeliczony tak, by uwzględniać splity (i czasem dywidendy); używany na wykresach, **nie** do wyceny i rozliczeń.
- **Split / scalenie** (*split / reverse split*) — podział lub połączenie akcji zmieniające liczbę akcji i cenę bez zmiany wartości pozycji.
- **Zdarzenie korporacyjne** (*corporate action*) — split, scalenie, dywidenda, zmiana ISIN itp.
- **Dywidenda** — wypłata części zysku akcjonariuszom; dzień ustalenia prawa (*record date*), dzień wypłaty (*pay date*), dzień „bez dywidendy” (*ex-date*).
- **Podatek u źródła** (*withholding tax, WHT*) — podatek pobrany przy wypłacie dywidendy zagranicznej w kraju emitenta.
- **Wolumen** — liczba sztuk instrumentu, które zmieniły właściciela w interwale.
- **Obrót** (*turnover*) — wartość transakcji w interwale (wolumen × cena).
- **Kapitalizacja** — wartość rynkowa wszystkich akcji spółki.
- **Spread** — różnica między ceną kupna i sprzedaży.
- **Prowizja** — opłata brokera za wykonanie zlecenia.
- **Przewalutowanie** — wymiana waluty przez brokera przy zakupie instrumentu w innej walucie niż waluta rachunku; ma koszt (Z-15).
- **Rachunek** (*account*, `account`) — rachunek maklerski u brokera odwzorowany w OligInvest; ma walutę i typ (zwykły, IKE, IKZE, demo).
- **Watchlista** — lista obserwowanych instrumentów użytkownika.
- **Benchmark** — punkt odniesienia dla wyniku portfela (indeks lub ETF).

## 2. Portfel i wyniki

- **Operacja / transakcja** (*transaction*, `transaction`) — każde zdarzenie zmieniające stan rachunku: kupno, sprzedaż, dywidenda, odsetki, opłata, podatek, wpłata, wypłata, przelew, przewalutowanie, split, przeniesienie papierów.
- **Pozycja** (*position*) — łączna ilość instrumentu na rachunku z kosztem nabycia i wyceną.
- **Partia** (*lot*, `lot`) — część pozycji nabyta jedną transakcją; podstawa rozliczania kosztu metodą FIFO.
- **Koszt nabycia** (*cost basis*) — wydatek poniesiony na nabycie pozycji wraz z kosztami (prowizje, przewalutowanie).
- **FIFO** (*First In, First Out*) — metoda przypisywania kosztu: sprzedaż zużywa najpierw najstarsze partie. Wymagana przez polskie prawo podatkowe dla papierów wartościowych (art. 24 ust. 10 ustawy o PIT — odrębnie dla każdego rachunku; [`../11-zgodnosc-prawna.md`](../11-zgodnosc-prawna.md) § 5).
- **Średnia ważona** (*average cost*) — koszt jednostkowy jako średnia ważona ilością wszystkich zakupów; w OligInvest wyłącznie widok informacyjny.
- **P/L zrealizowany** (*realized P/L*) — wynik na zamkniętej (sprzedanej) części pozycji.
- **P/L niezrealizowany** (*unrealized P/L*) — różnica między bieżącą wyceną a kosztem nabycia otwartej pozycji.
- **Wynik ekonomiczny / podatkowy** — dwa widoki P/L: ekonomiczny liczony po faktycznych kursach przewalutowania brokera; podatkowy — po kursie średnim NBP z dnia poprzedzającego (Z-16, ADR-014).
- **Wynik dnia** (*day change*) — zmiana wartości portfela od poprzedniego zamknięcia z pominięciem przepływów dnia.
- **Przepływ** (*cash flow*) — wpłata lub wypłata środków z/do rachunku (zewnętrzna); wpływa na MWR, a jest neutralizowany w TWR.
- **Wartość rynkowa** (*market value*) — ilość × bieżący kurs (w walucie instrumentu, przeliczona na PLN).
- **Alokacja** — podział wartości portfela wg klasy aktywów, sektora, geografii lub waluty.
- **Alokacja docelowa** (*target allocation*) — zadany przez użytkownika podział, względem którego liczymy odchylenia i rebalancing.
- **Rebalancing** — transakcje przywracające alokację docelową.
- **Ekspozycja walutowa** — udział aktywów denominowanych w danej walucie; wynik pozycji zagranicznej rozkłada się na **efekt ceny** i **efekt kursu**.
- **Stopa zwrotu prosta** — zmiana wartości względem kosztu, bez uwzględnienia czasu i przepływów.
- **TWR** (*Time-Weighted Return*) — stopa zwrotu ważona czasem, neutralizująca wpływ wpłat i wypłat; mierzy jakość zarządzania portfelem.
- **MWR / IRR / XIRR** (*Money-Weighted Return*) — stopa zwrotu ważona kapitałem: wewnętrzna stopa zwrotu przepływów; XIRR to jej wariant dla nieregularnych dat. Mierzy wynik inwestora wraz z decyzjami o wpłatach.
- **Annualizacja / CAGR** — przeliczenie stopy zwrotu na roczną.
- **Atrybucja wyniku** — rozłożenie wyniku okresu na wkłady pozycji, sektorów i walut.
- **Dywersyfikacja / koncentracja** — rozproszenie lub skupienie ryzyka w małej liczbie pozycji.

## 3. Ryzyko i statystyka

- **Zmienność** (*volatility*) — odchylenie standardowe stóp zwrotu, zwykle annualizowane.
- **Obsunięcie / drawdown** — spadek wartości od poprzedniego maksimum; **maksymalne obsunięcie** (*max drawdown*) to największe takie obsunięcie w okresie.
- **Wykres „underwater”** — przebieg obsunięcia w czasie.
- **Stopa wolna od ryzyka** — stopa porównawcza w miarach ryzyka (np. rentowność bonów/obligacji krótkoterminowych); jej źródło jest zawsze pokazywane jako założenie.
- **Wskaźnik Sharpe’a** — nadwyżka stopy zwrotu nad stopą wolną od ryzyka podzielona przez zmienność.
- **Wskaźnik Sortino** — jak Sharpe, ale z odchyleniem liczonym tylko dla stóp ujemnych.
- **Beta** — wrażliwość stóp zwrotu portfela na stopy zwrotu benchmarku.
- **Korelacja** — miara współzmienności dwóch serii (od −1 do 1).
- **VaR** (*Value at Risk*) — strata, której z założonym prawdopodobieństwem nie przekroczymy w danym horyzoncie (np. 95 %, 1 dzień).
- **CVaR / Expected Shortfall** — średnia strata w najgorszych przypadkach poza progiem VaR.
- **Rozkład, percentyl, przedział** — sposób prezentacji wyników analiz przyszłości; np. percentyl 5 % = wartość, poniżej której znalazło się 5 % symulowanych ścieżek.
- **Symulacja Monte Carlo** — generowanie wielu losowych ścieżek przyszłych zwrotów w celu oszacowania rozkładu wyników.
- **Bootstrap (blokowy)** — losowanie historycznych zwrotów (w blokach, aby zachować autokorelację) jako model przyszłości w symulacji.
- **Ziarno losowe** (*seed*) — wartość inicjująca generator liczb losowych; zapisywana, by wynik był odtwarzalny (NFR-08.05).
- **Efektywna granica** (*efficient frontier*, Markowitz) — zbiór portfeli o najwyższej oczekiwanej stopie zwrotu dla danego ryzyka.
- **Black-Litterman** — model łączący równowagę rynkową z poglądami inwestora w oczekiwane stopy zwrotu.
- **Risk parity / HRP** — alokacja wyrównująca wkład w ryzyko; HRP (*Hierarchical Risk Parity*) wykorzystuje hierarchiczne grupowanie korelacji.
- **Błąd estymacji** — niepewność parametrów (średnich, kowariancji) szacowanych z historii; główne źródło niestabilności optymalizacji.
- **Test warunków skrajnych** (*stress test*) — wycena portfela w historycznym lub hipotetycznym scenariuszu kryzysowym.
- **Analiza „co jeśli”** — porównanie cech portfela przed i po hipotetycznej zmianie.

## 4. Metodologia analiz i backtestów

- **Backtest** — symulacja działania reguł inwestycyjnych na danych historycznych.
- **Look-ahead bias** — błąd użycia informacji niedostępnej w chwili podejmowania decyzji (np. kursu zamknięcia do decyzji podjętej w trakcie sesji).
- **Survivorship bias** — błąd wynikający z analizy tylko instrumentów, które „przetrwały” (bez spółek wycofanych z obrotu).
- **Przeuczenie** (*overfitting, data snooping*) — dopasowanie reguł do szumu w danych; ryzyko rośnie z liczbą testowanych wariantów.
- **In-sample / out-of-sample** — dane użyte do doboru parametrów vs dane odłożone do sprawdzenia.
- **Walk-forward** — cykliczne przesuwanie okna dopasowania i testu w czasie.
- **Koszty transakcyjne i poślizg** (*slippage*) — prowizje, spread, przewalutowanie i różnica między ceną zakładaną a osiągalną.
- **Trafność** (*win rate*) — odsetek zyskownych transakcji.
- **Expectancy** — oczekiwany wynik na transakcję (trafność × średni zysk − (1 − trafność) × średnia strata).
- **Profit factor** — suma zysków / suma strat.
- **Postmortem** — ustrukturyzowana ocena zamkniętej transakcji: teza, przebieg, jakość procesu niezależnie od wyniku.

## 5. Wskaźniki techniczne

- **SMA** (*Simple Moving Average*) — średnia krocząca prosta.
- **EMA** (*Exponential Moving Average*) — średnia krocząca wykładnicza.
- **RSI** (*Relative Strength Index*) — oscylator siły względnej w skali 0–100.
- **MACD** — różnica dwóch EMA z linią sygnału i histogramem.
- **Wstęgi Bollingera** — średnia krocząca ± k odchyleń standardowych.
- **ATR** (*Average True Range*) — średni zakres prawdziwy; miara zmienności.
- **Volume Profile** — rozkład wolumenu według poziomów cen; w OligInvest przybliżenie z barów dziennych (Z-14).

## 6. Podatki i regulacje (Polska / UE)

- **Podatek Belki** — potoczna nazwa 19 % zryczałtowanego podatku od dochodów kapitałowych (m.in. sprzedaż papierów wartościowych, dywidendy).
- **PIT-38** — roczne zeznanie o dochodach kapitałowych; OligInvest nie generuje zeznań (poza zakresem, wizja § 6).
- **Kurs NBP D-1** — kurs średni NBP (tabela A) z ostatniego dnia roboczego poprzedzającego dzień przychodu lub kosztu; stosowany do przeliczeń podatkowych (ADR-014).
- **Tabela A / C NBP** — tabela kursów średnich (A) oraz kupna i sprzedaży (C) Narodowego Banku Polskiego.
- **IKE / IKZE** — Indywidualne Konto Emerytalne / Indywidualne Konto Zabezpieczenia Emerytalnego; rachunki z preferencjami podatkowymi (transakcje na nich nie są rozliczane jak na rachunku zwykłym).
- **MiFID II** — dyrektywa UE 2014/65/UE regulująca usługi inwestycyjne, w tym doradztwo inwestycyjne (osobista rekomendacja dla klienta).
- **Rekomendacja inwestycyjna** — informacja rekomendująca lub sugerująca strategię inwestycyjną (rozporządzenie MAR i akty delegowane); obowiązki i nasza pozycja w [`../11-zgodnosc-prawna.md`](../11-zgodnosc-prawna.md) § 3.
- **KNF** — Komisja Nadzoru Finansowego.
- **Disclaimer** — obowiązkowe zastrzeżenie w UI, że treści mają charakter edukacyjny i nie są rekomendacją (NFR-07.01).
- **RODO / GDPR** — rozporządzenie UE 2016/679 o ochronie danych osobowych.

## 7. Architektura i technika

- **PWA** (*Progressive Web App*) — aplikacja webowa instalowalna na urządzeniu, z trybem offline i powiadomieniami push.
- **Service worker** — skrypt przeglądarki działający w tle; obsługuje cache offline i Web Push.
- **Web Push / VAPID** — standard powiadomień push dla aplikacji webowych; VAPID to para kluczy identyfikująca serwer aplikacji.
- **SSE** (*Server-Sent Events*) — jednokierunkowy strumień zdarzeń serwer → przeglądarka po HTTP (ADR-007).
- **WebSocket** — dwukierunkowy kanał; w OligInvest nieużywany.
- **REST / OpenAPI** — styl API opartego na zasobach HTTP / standard opisu takiego API (`docs/02-api/openapi.yaml`).
- **Monolit modułowy** (*modular monolith*) — jedna aplikacja podzielona na moduły o jawnych granicach, wdrażana razem.
- **Moduł fundamentowy / funkcjonalny** — warstwy modułów: fundamentowe (identity, notifications, market, portfolio) są wymagane; funkcjonalne (analytics, alerts, education, admin, quick-actions) można wyłączyć i usunąć (`01-architektura/moduly.md`).
- **Port / adapter** — wzorzec: moduł domenowy zależy od interfejsu (portu), a konkretne implementacje (adaptery) są wymienne; np. `DataProvider`.
- **DataProvider** — port dostawcy danych rynkowych (`03-dane/strategia-cache.md`).
- **Circuit breaker** — mechanizm tymczasowo odcinający awaryjnego dostawcę.
- **Token bucket** — algorytm limitowania liczby żądań w oknie czasu; u nas do planowania kwot API.
- **Single-flight** — scalanie równoczesnych identycznych żądań w jedno pobranie.
- **Stale-while-revalidate (SWR)** — natychmiastowe zwrócenie danych z cache i odświeżenie w tle.
- **TTL** (*Time To Live*) — czas ważności wpisu w cache.
- **Kolejka zadań** (*job queue*, BullMQ) — asynchroniczne wykonywanie pracy przez workery (`jobs`, `analytics`).
- **Idempotencja** — właściwość operacji, której wielokrotne wykonanie daje ten sam efekt (np. ponowny import, nagłówek `Idempotency-Key`).
- **Feature flag** — przełącznik włączający funkcję lub moduł globalnie, per rola albo per użytkownik.
- **Audit log** — niemodyfikowalny dziennik działań administracyjnych i wrażliwych.
- **RBAC** (*Role-Based Access Control*) — kontrola dostępu oparta na rolach (user / pro / admin) i uprawnieniach.
- **RLS** (*Row Level Security*) — mechanizm PostgreSQL ograniczający widoczne wiersze do danych bieżącego użytkownika, niezależnie od kodu aplikacji.
- **2FA / MFA / TOTP** — uwierzytelnianie wieloskładnikowe; TOTP to jednorazowe kody czasowe z aplikacji uwierzytelniającej.
- **Kody zapasowe** (*backup codes*) — jednorazowe kody awaryjne na wypadek utraty urządzenia z TOTP.
- **Passkey / WebAuthn** — logowanie kluczem kryptograficznym powiązanym z urządzeniem (np. Face ID).
- **PAT** (*Personal Access Token*) — token API użytkownika o ograniczonych zakresach, używany przez Skróty i HTTP Shortcuts.
- **Bramka MFA** (*MFA gate*) — warstwa API odrzucająca żądania z sesji bez zweryfikowanego drugiego składnika.
- **OAuth 2.0 / OIDC** — protokoły logowania przez dostawcę tożsamości (Google, GitHub).
- **Argon2id** — algorytm hashowania haseł odporny na ataki sprzętowe (rekomendowany przez OWASP).
- **CSP** (*Content Security Policy*) — nagłówek ograniczający źródła skryptów i zasobów; z *nonce* zamiast `unsafe-inline`.
- **HSTS** — nagłówek wymuszający HTTPS.
- **CSRF / XSS / SQLi / SSRF** — klasy podatności: fałszowanie żądań między witrynami, wstrzyknięcie skryptu, wstrzyknięcie SQL, fałszowanie żądań po stronie serwera.
- **STRIDE** — model zagrożeń: Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege.
- **OWASP ASVS** — standard weryfikacji bezpieczeństwa aplikacji; celujemy w poziom L2.
- **SBOM** — wykaz składników oprogramowania (format CycloneDX).
- **Core Web Vitals** — LCP (czas renderowania największego elementu), INP (opóźnienie reakcji na interakcję), CLS (przesunięcia układu).
- **Code splitting** — dzielenie JavaScriptu na części ładowane na żądanie.
- **Decymacja** — redukcja liczby punktów serii bez utraty kształtu (np. agregacja świec do tygodni).
- **Wirtualizacja list** — renderowanie tylko widocznych wierszy długiej listy.
- **Monorepo / Turborepo / pnpm** — jedno repozytorium z wieloma pakietami / narzędzie orkiestracji zadań budowania / menedżer pakietów z izolacją zależności.
- **ADR** (*Architecture Decision Record*) — zapis decyzji architektonicznej (`09-decyzje/`).
- **C4** — model opisu architektury na poziomach: kontekst, kontenery, komponenty, kod.
- **RPO / RTO** — maksymalna akceptowalna utrata danych / maksymalny czas przywrócenia działania.
- **Zasada 3-2-1** — 3 kopie danych, na 2 różnych nośnikach, 1 poza lokalizacją.
- **Proxmox VE / VM** — platforma wirtualizacji na serwerze domowym / maszyna wirtualna, w której działa OligInvest.
- **Edge** — serwer brzegowy (VPS) przyjmujący ruch z internetu i przekazujący go tunelem WireGuard do serwera domowego.
- **WireGuard** — protokół VPN łączący VPS z siecią domową.
- **CrowdSec** — system wykrywania i blokowania złośliwego ruchu na podstawie logów.
- **Valkey** — magazyn klucz-wartość zgodny z protokołem Redis (licencja BSD); u nas kolejki, cache, pub/sub.
