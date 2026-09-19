# Ograniczenia budżetu 0 zł

**Cel:** wypisać jawnie, czego OligInvest nie zrobi albo zrobi gorzej przy budżecie 0 zł — z najtańszą płatną opcją, darmowym substytutem i tym, co tracimy — tak, aby każda taka decyzja była świadoma i odwracalna (NFR-05.01, NFR-01.09, §4.5 specyfikacji).

Powiązane: [`00-przeglad/wymagania.md`](00-przeglad/wymagania.md) § 3 (zastrzeżenia Z-01…Z-28), [`01-architektura/stack-technologiczny.md`](01-architektura/stack-technologiczny.md) § 8, [`03-dane/zrodla-danych.md`](03-dane/zrodla-danych.md), [`04-frontend/wydajnosc.md`](04-frontend/wydajnosc.md) § 8, [`08-plan/ryzyka.md`](08-plan/ryzyka.md).

Ceny sprawdzone **2026-09-19** (link przy każdej); ceny w walutach obcych podajemy w oryginalnej walucie. **NIEZWERYFIKOWANE** = cena lub warunek nie zostały sprawdzone u źródła.

## 1. Jak czytać

Każde ograniczenie ma identyfikator `L-xx`. Kolumny odpowiadają wymaganiu specyfikacji: czego dotyczy, ile kosztuje najtańsza opcja, jaki jest darmowy substytut i co tracimy. Kolumna „Kiedy wrócić” mówi, jakie zdarzenie powinno uruchomić ponowną decyzję (zapisywaną w ADR).

Koszt bieżący projektu: **0 zł miesięcznie** — serwer, domena, certyfikat i VPS już istnieją; wszystkie składniki stosu są self-hostowane albo mają trwały darmowy plan.

## 2. Infrastruktura i dostępność

| ID | Ograniczenie | Najtańsza opcja płatna | Darmowy substytut (stan obecny) | Co tracimy | Kiedy wrócić |
|---|---|---|---|---|---|
| L-01 | **Brak UPS** (potwierdzone przez właściciela 2026-09-19) | UPS line-interactive 650 VA, np. Eaton 5E 650i — od ok. 268 zł jednorazowo ([Ceneo](https://www.ceneo.pl/28642461)) + NUT (Network UPS Tools) do łagodnego wyłączenia | BIOS: *AC Recovery = Power On*, VM „Start at boot” ([`07-wdrozenie/infrastruktura.md`](07-wdrozenie/infrastruktura.md) § 10); PostgreSQL z WAL i sumami kontrolnymi stron (domyślne w wersji 18); kopia poza domem co godzinę | przy zaniku prądu twarde wyłączenie i przerwa do powrotu zasilania; dysk konsumencki bez ochrony przed utratą zasilania może zgubić ostatnie zapisy (wtedy odtworzenie z kopii — procedura B); brak ochrony przed przepięciami | pierwsze uszkodzenie danych po zaniku prądu albo więcej niż 2 zaniki w kwartale |
| L-02 | **Jeden węzeł: dom + VPS** (Z-27) | drugi węzeł z kopią aplikacji (np. większy VPS) — cena NIEZWERYFIKOWANE; do tego koszt złożoności (replikacja bazy, przełączanie) | cel 99 % miesięcznie, monitoring z VPS, procedury odtworzenia D i E ([`07-wdrozenie/backup-dr.md`](07-wdrozenie/backup-dr.md)) | ciągłość przy awarii domu lub VPS (RTO do 4 h od dostępności sprzętu) | gdy aplikacja stanie się potrzebna codziennie wielu osobom |
| L-03 | **Dysk VM nieszyfrowany** (decyzja właściciela 2026-09-19: użytek prywatny) | 0 zł — kosztem jest ręczne odblokowanie VM po każdym restarcie | kopie zapasowe szyfrowane; sekrety tylko w `/etc/oliginvest/secrets` (pliki `0600`); ścieżka zmiany poniżej | przy kradzieży serwera dostęp do danych użytkowników i sekretów (także kluczy kopii); takie zdarzenie jest naruszeniem do oceny i zwykle do zgłoszenia UODO ([`06-bezpieczenstwo/plan-reagowania.md`](06-bezpieczenstwo/plan-reagowania.md) § 7) | zaproszenie osób spoza najbliższego kręgu, przeniesienie serwera, zmiana decyzji właściciela |
| L-04 | **Łącze domowe i tunel a LCP** (Z-18) | przeniesienie `web` lub zasobów statycznych na VPS (0 zł, ale nowy ADR i dane na VPS) albo większy VPS — cena NIEZWERYFIKOWANE | HTML strumieniowany, długi cache zasobów w przeglądarce, pomiar RUM ([`04-frontend/wydajnosc.md`](04-frontend/wydajnosc.md) § 7) | pewność budżetu LCP < 2 s przy słabym wysyłaniu łącza domowego | RUM p75 LCP > 2,0 s przez 2 tygodnie |
| L-05 | **Kopie poza domem ograniczone dyskiem VPS** (≤ 8 GB z 20 GB) | magazyn obiektowy lub większy dysk VPS — cena NIEZWERYFIKOWANE | restic z deduplikacją, retencja 35 dni (baza 1–2 GB), miesięczna kopia offline na dysku zewnętrznym | dłuższą historię kopii poza domem | repozytorium restic > 6 GB |
| L-06 | **Brak centralnych logów, APM i śledzenia błędów** (O-08) | rozbudowa RAM serwera (❓ maksimum płyty i cena modułów DDR3 do sprawdzenia); usługi SaaS odrzucone — dane poza serwerem (NFR-11.01) | logi JSON w VM (14 dni), dzienny raport błędów, Uptime Kuma, metryki w panelu admina ([`07-wdrozenie/monitoring.md`](07-wdrozenie/monitoring.md)) | wygodną korelację zdarzeń i długie historie metryk | powtarzające się incydenty trudne do diagnozy |
| L-07 | **Brak ochrony przed DDoS wolumetrycznym** | usługa anty-DDoS/CDN z terminacją TLS u dostawcy — sprzeczna z [ADR-011](09-decyzje/ADR-011-topologia-wdrozenia.md) (klucze TLS tylko w domu) | limity połączeń na VPS, CrowdSec; ❓ podstawowa ochrona sieci OVHcloud dla VPS — zakres do sprawdzenia | dostępność podczas ataku | pierwszy atak, który wyłączy usługę na > 4 h |

### 2.1 Ścieżka włączenia szyfrowania dysku (L-03)

Projekt zachowuje tę możliwość bez zmian w aplikacji: cały stan jest w `/srv/oliginvest`, `/etc/oliginvest/secrets` i w kopiach, więc migracja to odtworzenie na nowy dysk.

1. Nowa VM (albo nowy dysk) z Debianem 13 zainstalowanym na szyfrowanym LVM (LUKS2).
2. Odtworzenie procedurą C z [`07-wdrozenie/backup-dr.md`](07-wdrozenie/backup-dr.md) § 5 i test dymny.
3. Odblokowanie po restarcie: konsola VM w panelu Proxmoxa przez WireGuard administracyjny (host pozostaje nieszyfrowany) albo SSH w initramfs (`dropbear-initramfs`).
4. `unattended-upgrades`: automatyczny restart po aktualizacji jądra wyłączony albo z powiadomieniem, bo po restarcie VM czeka na hasło.
5. Monitoring: brak sygnału `vm-health` przez 10 min po restarcie = alert „VM czeka na odblokowanie”.
6. Klucz odzyskiwania LUKS w menedżerze haseł właściciela; zapis decyzji w nowym ADR i aktualizacja T-INF-04 w [`06-bezpieczenstwo/model-zagrozen.md`](06-bezpieczenstwo/model-zagrozen.md).

Warunek utrzymania tej ścieżki (sprawdzany w przeglądzie PR): aplikacja nie zapisuje danych poza wolumenami z [`07-wdrozenie/infrastruktura.md`](07-wdrozenie/infrastruktura.md) § 5.3, a sekretów — poza `/etc/oliginvest/secrets`.

## 3. Dane rynkowe

| ID | Ograniczenie | Najtańsza opcja płatna | Darmowy substytut (stan obecny) | Co tracimy | Kiedy wrócić |
|---|---|---|---|---|---|
| L-10 | **Brak danych czasu rzeczywistego** (Z-01) | licencjonowane dane GPW w czasie rzeczywistym — cena NIEZWERYFIKOWANE (dystrybucja danych GPW jest licencjonowana) | notowania opóźnione ~15 min i EOD z etykietą wieku danych (FR-01.15) | reakcję na zdarzenia w trakcie sesji; alerty cenowe spóźnione o czas opóźnienia | nie planujemy — sprzeczne z celem produktu (brak handlu) |
| L-11 | **Intraday GPW tylko z nieoficjalnego Yahoo** (Z-03) | plan płatny z danymi XWAR (np. Twelve Data — ❓ ok. 29 USD/mies., [`03-dane/zrodla-danych.md`](03-dane/zrodla-danych.md)) | Yahoo „best effort” z degradacją do trybu „tylko EOD” ([ADR-005](09-decyzje/ADR-005-strategia-danych-rynkowych.md)) | stabilność notowań intraday GPW | Yahoo niedostępny dłużej niż 5 dni sesyjnych |
| L-12 | **EOD GPW bez gwarancji** (archiwum GPW dla automatów) | EODHD „All World” 19,99 USD/mies. ([cennik](https://eodhd.com/pricing), sprawdzone 2026-09-18) | archiwum GPW (1 żądanie na sesję, uczciwa identyfikacja), import ręczny XLS/Stooq przez admina (FR-08.09) | automatyzację EOD, gdy GPW zablokuje pobieranie | 2 dni sesyjne bez danych EOD |
| L-13 | **Brak fundamentów spółek GPW** | płatne serwisy danych fundamentalnych — cena NIEZWERYFIKOWANE | pola ręczne; screener GPW bez wskaźników finansowych | screening po danych finansowych GPW | — |
| L-14 | **Screener USA tylko na zdefiniowanym uniwersum** (Z-11) | plan z danymi masowymi USA (np. EODHD 19,99 USD/mies.) | lista admina + watchlisty użytkowników | pełny rynek USA | — |
| L-15 | **Kalendarz wyników GPW, klasyfikacja sektorowa GPW, sentyment newsów** (Z-10, Z-12, Z-13) | płatne źródła — cena NIEZWERYFIKOWANE | wpisy admina, portfele subindeksów sektorowych, „ton” artykułów GDELT (nie sentyment) | kompletność i automatyzację | — |
| L-16 | **Volume Profile tylko przybliżony** (Z-14) | dane intraday lub tickowe — płatne | przybliżenie z barów dziennych, oznaczone | dokładność profilu | — |

## 4. Urządzenia mobilne

| ID | Ograniczenie | Najtańsza opcja płatna | Darmowy substytut (stan obecny) | Co tracimy | Kiedy wrócić |
|---|---|---|---|---|---|
| L-20 | **Brak natywnej aplikacji iOS** (App Intents, widżety WidgetKit, własny schemat URL — Z-06) | Apple Developer Program **99 USD/rok** ([Apple](https://developer.apple.com/programs/enroll/)) + czas budowy aplikacji (np. Capacitor) | PWA + Skróty z tokenem PAT ([`05-mobile/ios-integracje.md`](05-mobile/ios-integracje.md)); widżety z danymi przez Scriptable (P3) | widżety z danymi bez aplikacji zewnętrznych, akcje w Siri bez konfiguracji, linki otwierające aplikację zamiast Safari | natywne widżety okażą się kluczowe dla właściciela |
| L-21 | **Android: brak natywnych kafelków i widżetów** (Z-07) | Tasker — ok. 3,5–4,5 USD jednorazowo (Z-07) | HTTP Shortcuts (MIT, darmowa): widżety, kafelek Szybkich ustawień ([`05-mobile/android-integracje.md`](05-mobile/android-integracje.md)) | praktycznie nic | — |
| L-22 | **Web Push bez gwarancji doręczenia** (Z-08) | płatne kanały z gwarancją (np. SMS) — cena NIEZWERYFIKOWANE | e-mail dla alertów krytycznych, historia alertów w aplikacji | pewność natychmiastowego powiadomienia | — |

## 5. Komunikacja

| ID | Ograniczenie | Najtańsza opcja płatna | Darmowy substytut (stan obecny) | Co tracimy | Kiedy wrócić |
|---|---|---|---|---|---|
| L-30 | **E-mail: 300 wiadomości/dobę i logo Brevo w stopce** (Z-09) | płatny plan Brevo lub innego dostawcy SMTP — cena NIEZWERYFIKOWANE | plan darmowy Brevo; kolejka `notify` pilnuje limitu; alerty głównie przez push | własny wygląd e-maili, wyższe limity | > 200 e-maili dziennie przez tydzień |

## 6. Licencje i prawo

| ID | Ograniczenie | Najtańsza opcja płatna | Darmowy substytut (stan obecny) | Co tracimy | Kiedy wrócić |
|---|---|---|---|---|---|
| L-40 | **Licencje darmowych danych:** brak prawa do redystrybucji; Yahoo „personal use only”; darmowe plany Alpha Vantage, Finnhub, Twelve Data do użytku osobistego | płatne licencje z prawem do pokazywania danych innym osobom — cena NIEZWERYFIKOWANE | dane wyłącznie dla zalogowanych użytkowników, bez stron publicznych (NFR-07.04), atrybucje źródeł ([`11-zgodnosc-prawna.md`](11-zgodnosc-prawna.md) § 6) | możliwość otwarcia aplikacji publicznie lub komercyjnie; pewność, że pokazywanie danych kilku zaproszonym osobom mieści się w „użytku osobistym” (szara strefa, R-06) | przed jakimkolwiek upublicznieniem lub przy sygnale od dostawcy |
| L-41 | **vectorbt z Commons Clause** (zakaz sprzedaży oprogramowania, którego wartość wynika z vectorbt) | licencja komercyjna lub inna biblioteka — cena NIEZWERYFIKOWANE | vectorbt 1.1 do użytku prywatnego ([ADR-003](09-decyzje/ADR-003-hybryda-obliczen-i-kolejki.md)) | możliwość sprzedaży aplikacji z backtestem opartym na vectorbt | gdyby aplikacja miała być płatna |
| L-42 | **Dokumenty prawne bez prawnika** | konsultacja prawnika — cena NIEZWERYFIKOWANE | dokumenty przygotowane według przepisów i oznaczone jako „nie opinia prawna” ([`11-zgodnosc-prawna.md`](11-zgodnosc-prawna.md), [`12-dla-uzytkownika/`](12-dla-uzytkownika/regulamin.md)) | pewność interpretacji | zaproszenie osób spoza najbliższego kręgu, spór, pytanie organu |

## 7. Wydajność kontra funkcje (NFR-01.09)

Konflikty wydajności z funkcjami i sposób ich rozstrzygnięcia opisuje [`04-frontend/wydajnosc.md`](04-frontend/wydajnosc.md) § 8 (CSP z nonce bez renderowania statycznego, framework zajmujący ~130 KB z budżetu 200 KB, wykresy 10-letnie, screener, heatmapa, onboarding, panel admina, offline). Po stronie serwera: ciężkie analizy (Monte Carlo, optymalizacja, backtest) mają limity parametrów i jedno zadanie naraz (Z-19, [ADR-003](09-decyzje/ADR-003-hybryda-obliczen-i-kolejki.md)), bo i5-4590 jest współdzielony z Immichem. Żaden z tych konfliktów nie wymaga pieniędzy — wymaga świadomego uproszczenia funkcji.

## 8. Jeśli pojawi się budżet — kolejność zakupów

| Kolejność | Zakup | Koszt | Co poprawia |
|---|---|---|---|
| 1 | UPS 650 VA (L-01) | od ok. 268 zł jednorazowo | niezawodność i ochrona danych przy zanikach prądu — największy zysk na złotówkę |
| 2 | EODHD „All World” (L-12, L-14) | 19,99 USD/mies. | niezależność EOD od archiwum GPW; szerszy screener USA |
| 3 | Apple Developer Program (L-20) | 99 USD/rok + praca | natywne widżety i akcje iOS — tylko jeśli Skróty okażą się niewystarczające |
