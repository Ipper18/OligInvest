# Środowisko deweloperskie M0-1

**Cel:** opisać samodzielny plik Compose dla lokalnych danych syntetycznych i sposób jego walidacji bez instalowania zależności aplikacji (BL-034, NFR-10.01).

Stan 2026-09-21: kontenery uruchomiono lokalnie; test wykazał niedostępność opublikowanych portów przy `internal: true` (wyniki i zatwierdzona korekta w § 4). **Nie uruchomiono jeszcze w CI.** Brakuje migracji, ról RLS, seedów i integracji workerów; pełne BL-034 nadal zależy od BL-013 i BL-014. Źródła: [CI/CD](ci-cd.md), [stos](../01-architektura/stack-technologiczny.md), [raport sesji](../08-plan/m0-1-session-report.md).

## 1. Usługi i izolacja

[compose.dev.yaml](../../compose.dev.yaml) jest samodzielny: nie rozszerza produkcyjnego Compose, nie wymaga obrazów aplikacji ani profilu. Aplikacje będą uruchamiane lokalnie poza kontenerami.

| Usługa | Wersja | Dane / polityka | Domyślny port na lokalnym hoście |
|---|---|---|---|
| PostgreSQL | 18.6-trixie | trwały wolumen w `/var/lib/postgresql` (układ obrazu PG 18); uwierzytelnianie hosta SCRAM | 5432 |
| Valkey kolejki | 9.1.2 | osobny wolumen, AOF co sekundę, `noeviction`, 256 MB | 6379 |
| Valkey cache | 9.1.2 | `allkeys-lru`, 128 MB; bez AOF/RDB, katalog danych w tmpfs | 6380 |
| Mailpit | 1.31.1 | lokalna skrzynka SMTP, bez konfiguracji przekazywania wiadomości, limit 500 wiadomości | SMTP 1025, panel 8025 |

Wersje obrazów są przypięte digestami indeksów wieloplatformowych odczytanymi 2026-09-20 przez `docker buildx imagetools inspect`; odczyt metadanych nie pobrał warstw ani nie uruchomił obrazów. Źródła: [oficjalny PostgreSQL](https://hub.docker.com/_/postgres), [Valkey 9.1.2](https://github.com/valkey-io/valkey/releases/tag/9.1.2), [Mailpit 1.31.1](https://github.com/axllent/mailpit/releases/tag/v1.31.1) i [obrazy Mailpit](https://mailpit.axllent.org/docs/install/docker/). Przypięcie nie zastępuje skanowania podatności obrazu przed użyciem.

Sieć developerskiego Compose jest zwykłą siecią bridge (`internal: false`, decyzja właściciela 2026-09-21). Wszystkie opublikowane porty wymagają jawnego `DEV_BIND_ADDRESS` ustawionego na pętlę zwrotną hosta; nie wpisuj adresu interfejsu LAN ani wildcard. W repozytorium nie przechowujemy adresów IP. Są to porty wyłącznie developerskie, konfigurowalne zmiennymi `DEV_*_PORT`, bez związku z infrastrukturą domową. Hasła PostgreSQL i obu Valkey są wymagane, osobne i lokalne; nie kopiuj poświadczeń produkcji. Mailpit przechowuje tylko syntetyczne wiadomości.

Konto `postgres` służy wyłącznie do lokalnego bootstrapu/migracji. Nie ustawiaj nim `DATABASE_URL_APP` ani połączenia analityki. Role bez `BYPASSRLS`, migracje i pule aplikacji powstaną w BL-007/008; ich brak nie jest zgodą na obejście RLS.

## 2. Walidacja bez instalacji

W PowerShell poniższe wartości są publicznymi znacznikami testowymi wyłącznie do parsowania konfiguracji, nie hasłami działającej usługi. Uruchomienie w osobnej powłoce pozwala je usunąć wraz z zamknięciem powłoki. Polecenie `config` nie tworzy kontenerów ani wolumenów. `.env.example` ma puste wartości; użycie go przez `--env-file` zapobiega odczytowi lokalnego `.env`.

```powershell
$env:DEV_BIND_ADDRESS = [System.Net.IPAddress]::Loopback.ToString()
$env:DEV_POSTGRES_PASSWORD = 'config-validation-only'
$env:DEV_VALKEY_QUEUE_PASSWORD = 'config-validation-only'
$env:DEV_VALKEY_CACHE_PASSWORD = 'config-validation-only'
docker compose --env-file .env.example -f compose.dev.yaml config --quiet
```

Wynik tej kontroli potwierdza wyłącznie składnię, interpolację i model Compose. Nie dowodzi dostępności usług, trwałości danych, poprawności healthchecków, połączeń aplikacji ani działania RLS. Nie zapisuj rozwiniętego `config` z rzeczywistymi lokalnymi hasłami do pliku śledzonego przez Git.

## 3. Uruchomienie po przygotowaniu aplikacji

1. Uzupełnij tylko lokalne wartości `DEV_*` w ignorowanym `.env` na podstawie [.env.example](../../.env.example), z osobnymi hasłami do środowiska syntetycznego. Adres pętli zwrotnej wyznacz jak w § 2. Nie używaj znaczników walidacyjnych jako haseł.
2. Po zakończeniu karencji i kontroli obrazów sprawdź `docker compose -f compose.dev.yaml config --quiet`, następnie `docker compose -f compose.dev.yaml up -d` i `docker compose -f compose.dev.yaml ps`.
3. Po BL-007/008 utwórz role i wykonaj migracje oraz testy RLS. Dopiero wtedy ustaw połączenia aplikacji z właściwymi rolami.
4. Po BL-013/014 podłącz aplikacje, wykonaj seed syntetyczny i zweryfikuj `pnpm dev`, kolejki, cache oraz dostarczenie wiadomości do Mailpit. Te polecenia aplikacji nie są jeszcze gotowe w obecnym szkielecie plików.
5. Zatrzymanie: `docker compose -f compose.dev.yaml down` zachowuje trwałe wolumeny PostgreSQL i kolejki. Nie usuwaj wolumenów automatycznie; reset danych wymaga świadomej decyzji lokalnego operatora.

## 4. Dane przykładowe (seed)

Plik [`../03-dane/fixtures/seed-dev.json`](../03-dane/fixtures/seed-dev.json) zawiera kompletny, **w pełni fikcyjny** zestaw danych dla `pnpm dev` (BL-034). Jest deterministyczny (ziarno w `meta.seed`), więc każdy dostaje ten sam obraz aplikacji.

| Blok | Zawartość |
|---|---|
| `user` | jedno konto deweloperskie (`dev@example.invalid`, rola `admin`) |
| `accounts` | dwa rachunki: XTB i mBank eMakler, waluta PLN |
| `instruments` | sześć pozycji (ETF, dwie spółki z GPW, dwie z NASDAQ, indeks WIG20) z tablicą `closes` dla 798 sesji od 2023-09-01 do 2026-09-22 |
| `fxRates` | USD/PLN i EUR/PLN, źródło `nbp`, ten sam zakres dat |
| `transactions` | 19 operacji: wpłaty, zakupy w trzech walutach i dywidenda z podatkiem u źródła |
| `expected` | stan końcowy (gotówka, pozycje, wartość portfela, wpłaty netto) — do asercji w teście ładowania |

Zasady, których trzyma się loader:

- Nazwy pól odpowiadają kolumnom z [`../03-dane/schema.sql`](../03-dane/schema.sql); `account` i `instrument` to klucze tekstowe, które loader zamienia na UUID.
- Do `market.bars_daily` trafia wyłącznie `close` (pozostałe kolumny są opcjonalne) — pełne świece OHLC pojawią się z prawdziwym dostawcą w M2. Nie dopisujemy zmyślonych wartości otwarcia, maksimum i minimum.
- Instrumenty nie mają ISIN: nie podajemy identyfikatorów, których nie zweryfikowaliśmy. Rozpoznanie odbywa się po `mic` i `ticker`.
- Daty rozliczenia wyliczone zgodnie z [`../03-dane/obliczenia-finansowe.md`](../03-dane/obliczenia-finansowe.md) § 2.2: GPW i XETR T+2, USA T+1.
- Sesje to dni robocze bez świąt — prawdziwy kalendarz sesji dodaje BL-136.
- Prowizje w danych: XTB 0 %, mBank 0,39 % min. 5,00 zł. To **przykładowa taryfa na potrzeby danych testowych**, nie odwzorowanie cennika brokera (**NIEZWERYFIKOWANE**).
- Marża przewalutowania 0,5 % zawarta w kursie `fx_rate` operacji walutowych (`fx_source: broker`), zgodnie z decyzją z [`../11-zgodnosc-prawna.md`](../11-zgodnosc-prawna.md) § 5.

Stan końcowy zestawu: wartość portfela **47 064,47 zł**, gotówka **1220,78 zł**, wpłaty netto **41 500,00 zł**, pięć pozycji (VWCE 36, PKO 200, CDR 25, AAPL 12, MSFT 3). Test ładowania porównuje własne wyliczenia z blokiem `expected` — to pierwszy pełny sprawdzian ścieżki „dane → wycena” jeszcze przed importem prawdziwych plików.

Seed ładuje się wyłącznie do środowiska deweloperskiego i nigdy do produkcji; operacje mają `source: "demo"`.

## 5. Wynik testu hosta i proponowana korekta

2026-09-21, Windows x64, Docker Desktop Linux / Engine 29.4.3 / Compose 5.1.3: cztery kontenery osiągają stan healthy. Przy `internal: true` host otrzymuje `ECONNREFUSED` dla PostgreSQL, obu Valkey i Mailpit. W pierwszej próbie domyślny port PostgreSQL zajmował istniejący proces; jego błąd hasła nie potwierdzał połączenia z kontenerem. Dlatego właściwe porównanie wykonano na wolnych portach hosta wybranych przez system, z osobnym projektem Compose i własnymi tymczasowymi hasłami.

Tymczasowy override diagnostyczny `internal: false` przechodzi wszystkie sondy: uwierzytelnione `SELECT 1`, dwa `AUTH` + `PING` Valkey oraz HTTP `/livez` Mailpit. [Dowód obu wariantów](../08-plan/audits/m0-1-compose-probe.json). Po testach usunięto wyłącznie utworzone projekty i ich puste wolumeny. Istniejącej usługi hosta nie zmieniano.

**Zatwierdzona i zastosowana korekta BL-034 (2026-09-21):** w developerskim `compose.dev.yaml` użyć zwykłej sieci bridge:

```yaml
networks:
  default:
    internal: false
```

Publikowanie portów nadal wymaga pętli zwrotnej przez `DEV_BIND_ADDRESS`. Zwykły bridge dopuszcza ruch wychodzący usług developerskich; jest to jawny kompromis dla aplikacji działających na hoście. Na sprawdzonym Docker Desktop publikacja portów dla aplikacji uruchamianych na hoście wymaga sieci nie-internal; podstawą jest wynik `audits/m0-1-compose-probe.json` podlinkowany powyżej. Zmiana dotyczy wyłącznie `compose.dev.yaml`. Sieci `internal` w produkcyjnym `compose.yaml` (BL-022) pozostają bez zmian. Pełne BL-034 nadal otwarte (migracje, seed i integracja workerów). Przed uruchomieniem wybierz wolne porty `DEV_*_PORT`, jeśli domyślne są zajęte.
