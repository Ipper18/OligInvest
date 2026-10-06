# Środowisko deweloperskie M0-1

**Cel:** opisać samodzielny plik Compose dla lokalnych danych syntetycznych i sposób jego walidacji bez instalowania zależności aplikacji (BL-034, NFR-10.01).

Stan 2026-09-28: `pnpm dev` uruchamia cztery aplikacje na hoście, przygotowuje role/migracje i ładuje seed; testy `queues:test`, `db:seed:test` i `dev:test` korzystają z izolowanych projektów tego samego Compose. Wyniki CI i pozostały DoD: [raport sesji](../08-plan/m0-1-session-report.md). Korekta sieci developerskiej pozostaje ograniczona do § 5.

## 1. Usługi i izolacja

[compose.dev.yaml](../../compose.dev.yaml) jest samodzielny: nie rozszerza produkcyjnego Compose, nie wymaga obrazów aplikacji ani profilu. Aplikacje będą uruchamiane lokalnie poza kontenerami.

Izolacja sieciowa analytics (sieć bez bramy wychodzącej) obowiązuje w `compose.yaml` od M3 zgodnie z ADR-003; w dev brak dostępu do sieci zapewniają brak dodatkowych bibliotek sieciowych w zależnościach analytics (poza klientami infrastruktury BullMQ/Redis i psycopg) oraz fixture pytest ze standardowej biblioteki, która w procesie testowym blokuje połączenia gniazd do hostów innych niż `valkey-queue` (nie jest to izolacja systemowa procesu uruchomionego poza testami).

| Usługa | Wersja | Dane / polityka | Domyślny port na lokalnym hoście |
|---|---|---|---|
| PostgreSQL | 18.6-trixie | trwały wolumen w `/var/lib/postgresql` (układ obrazu PG 18); uwierzytelnianie hosta SCRAM | 5432 |
| Valkey kolejki | 9.1.2 | osobny wolumen, AOF co sekundę, `noeviction`, 256 MB | 6379 |
| Valkey cache | 9.1.2 | `allkeys-lru`, 128 MB; bez AOF/RDB, katalog danych w tmpfs | 6380 |
| Mailpit | 1.31.1 | lokalna skrzynka SMTP, bez konfiguracji przekazywania wiadomości, limit 500 wiadomości | SMTP 1025, panel 8025 |

Wersje obrazów są przypięte digestami indeksów wieloplatformowych odczytanymi 2026-09-20 przez `docker buildx imagetools inspect`; odczyt metadanych nie pobrał warstw ani nie uruchomił obrazów. Źródła: [oficjalny PostgreSQL](https://hub.docker.com/_/postgres), [Valkey 9.1.2](https://github.com/valkey-io/valkey/releases/tag/9.1.2), [Mailpit 1.31.1](https://github.com/axllent/mailpit/releases/tag/v1.31.1) i [obrazy Mailpit](https://mailpit.axllent.org/docs/install/docker/). Przypięcie nie zastępuje skanowania podatności obrazu przed użyciem.

Sieć developerskiego Compose jest zwykłą siecią bridge (`internal: false`, decyzja właściciela 2026-09-21). Wszystkie opublikowane porty wymagają jawnego `DEV_BIND_ADDRESS` ustawionego na pętlę zwrotną hosta; nie wpisuj adresu interfejsu LAN ani wildcard. W repozytorium nie przechowujemy adresów IP. Są to porty wyłącznie developerskie, konfigurowalne zmiennymi `DEV_*_PORT`, bez związku z infrastrukturą domową. Hasła PostgreSQL i obu Valkey są wymagane, osobne i lokalne; nie kopiuj poświadczeń produkcji. Mailpit przechowuje tylko syntetyczne wiadomości.

Konto `postgres` służy wyłącznie do lokalnego bootstrapu/migracji i utworzenia konta syntetycznego. Seed zapisuje dane rynkowe i portfel przez `SET LOCAL ROLE oliginvest_app` z kontekstem `app.user_id`. API dostaje hasła ról app/auth, analytics wyłącznie hasło roli read-only (w M0 nie łączy się z bazą). Hasła ról syntetycznych są generowane przy starcie i przekazywane tylko właściwym procesom; nie uruchamiaj równolegle dwóch sesji dev na tej samej bazie.

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

1. Wykonaj `pnpm install --frozen-lockfile` oraz dwa kroki `uv sync` z [README analytics](../../apps/analytics/README.md). Wymagane Node 24, Python 3.13, uv 0.12.16 i działający Docker.
2. Uzupełnij ignorowany `.env`: jawne `NODE_ENV=development`, `DEV_BIND_ADDRESS` (pętla zwrotna jak w § 2) i trzy różne hasła `DEV_POSTGRES_PASSWORD`, `DEV_VALKEY_QUEUE_PASSWORD`, `DEV_VALKEY_CACHE_PASSWORD`. Porty `DEV_*_PORT` są opcjonalne; API/web domyślnie 3001/3000. Nie używaj znaczników walidacyjnych jako haseł.
3. `pnpm dev` buduje wymagane pakiety, uruchamia usługi Compose, tworzy role, wykonuje migracje i seed z asercjami, następnie startuje api/web/jobs/analytics. Pokaże adres web po gotowości API i web. Jobs otrzymuje własne parametry DB/cache oraz lokalny transport Mailpit (`DEV_SMTP_PORT`, syntetyczny nadawca `example.test`, bez poświadczeń produkcyjnych). Konto seeda nie ma hasła ani ominięcia MFA; pierwsze rzeczywiste konto tworzy CLI. Zmiany TypeScript wymagają ponownego uruchomienia polecenia; Next działa w trybie dev.
4. `pnpm queues:test`, `pnpm db:seed:test` i `pnpm dev:test` tworzą własne projekty Compose, losowe porty i syntetyczne hasła, a w `finally` usuwają wyłącznie swoje kontenery/wolumeny. Pierwszy test sprawdza Node → Python i blokadę gniazd pytest; drugi wszystkie `expected`, idempotencję i rollback; trzeci start czterech aplikacji, gotowość bazy/cache/kolejki i Mailpit. Diagnostyka w `.git/m0-workers/`. Sondy: `node apps/jobs/dist/healthcheck.js` i `python -m oliginvest_analytics --health`, z tym samym środowiskiem co dany worker.
5. Ctrl+C kończy procesy aplikacji. `docker compose -f compose.dev.yaml down` zatrzymuje usługi i zachowuje trwałe wolumeny. Zwykłe `pnpm dev` nigdy ich nie usuwa. Ponowny seed sprawdza istniejące dane; nie nadpisuje zmienionego portfela. Reset danych wymaga świadomej decyzji lokalnego operatora.

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

Seed ładuje się wyłącznie w jawnym trybie `development` lub w izolowanym teście `test`, nigdy w produkcji; operacje mają `source: "demo"`. Loader odczytuje surowy zapis liczb JSON jako tekst i zapisuje go parametrami do `NUMERIC`. Testowy oracle SQL liczy asercje wyłącznie dla tego zestawu zakupów, bez implementacji wzorów aplikacji poza `packages/core`; przy wartości portfela sumuje niezaokrąglone wyceny i zaokrągla dopiero wynik końcowy.

## 5. Wynik testu hosta i proponowana korekta

2026-09-21, Windows x64, Docker Desktop Linux / Engine 29.4.3 / Compose 5.1.3: cztery kontenery osiągają stan healthy. Przy `internal: true` host otrzymuje `ECONNREFUSED` dla PostgreSQL, obu Valkey i Mailpit. W pierwszej próbie domyślny port PostgreSQL zajmował istniejący proces; jego błąd hasła nie potwierdzał połączenia z kontenerem. Dlatego właściwe porównanie wykonano na wolnych portach hosta wybranych przez system, z osobnym projektem Compose i własnymi tymczasowymi hasłami.

Tymczasowy override diagnostyczny `internal: false` przechodzi wszystkie sondy: uwierzytelnione `SELECT 1`, dwa `AUTH` + `PING` Valkey oraz HTTP `/livez` Mailpit. [Dowód obu wariantów](../08-plan/audits/m0-1-compose-probe.json). Po testach usunięto wyłącznie utworzone projekty i ich puste wolumeny. Istniejącej usługi hosta nie zmieniano.

**Zatwierdzona i zastosowana korekta BL-034 (2026-09-21):** w developerskim `compose.dev.yaml` użyć zwykłej sieci bridge:

```yaml
networks:
  default:
    internal: false
```

Publikowanie portów nadal wymaga pętli zwrotnej przez `DEV_BIND_ADDRESS`. Zwykły bridge dopuszcza ruch wychodzący usług developerskich; jest to jawny kompromis dla aplikacji działających na hoście. Na sprawdzonym Docker Desktop publikacja portów dla aplikacji uruchamianych na hoście wymaga sieci nie-internal; podstawą jest wynik `audits/m0-1-compose-probe.json` podlinkowany powyżej. Zmiana dotyczy wyłącznie `compose.dev.yaml`. Sieci `internal` w produkcyjnym `compose.yaml` (BL-022) pozostają bez zmian. Migracje, seed i integracja workerów zostały wykonane w BL-034 (2026-09-28); wspólny DoD paczki pozostaje otwarty. Przed uruchomieniem wybierz wolne porty `DEV_*_PORT`, jeśli domyślne są zajęte.
