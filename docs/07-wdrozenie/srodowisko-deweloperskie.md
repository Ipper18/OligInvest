# Środowisko deweloperskie M0-1

**Cel:** opisać samodzielny plik Compose, logowanie do lokalnego demo oraz odizolowany profil właściciela do prób importu (BL-034, NFR-10.01).

Stan 2026-10-23: `pnpm dev` uruchamia cztery aplikacje na hoście, przygotowuje role/migracje i w profilu demo ładuje seed; profil owner pomija seed i może uruchomić interaktywne tworzenie właściciela. Testy `queues:test`, `db:seed:test` i `dev:test` korzystają z izolowanych projektów tego samego Compose. [Raport lokalnych kont](../08-plan/dev-local-accounts-session-report.md); wcześniejszy DoD: [M0-1](../08-plan/m0-1-session-report.md). Korekta sieci developerskiej pozostaje ograniczona do § 5.

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

Sieć developerskiego Compose jest zwykłą siecią bridge (`internal: false`, decyzja właściciela 2026-09-21). Wszystkie opublikowane porty wymagają jawnego `DEV_BIND_ADDRESS` ustawionego na pętlę zwrotną hosta; nie wpisuj adresu interfejsu LAN ani wildcard. W repozytorium nie przechowujemy adresów IP. Są to porty wyłącznie developerskie, konfigurowalne zmiennymi `DEV_*_PORT`, bez związku z infrastrukturą domową. Hasła PostgreSQL i obu Valkey są wymagane, osobne i lokalne; nie kopiuj poświadczeń produkcji. Mailpit w demo przechowuje wiadomości syntetyczne; w profilu owner może zawierać lokalne wiadomości związane z kontem właściciela.

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
3. Wybierz profil z § 3.1 lub § 3.2. `pnpm dev` buduje wymagane pakiety, uruchamia usługi Compose, tworzy role i wykonuje migracje; tylko profil demo ładuje seed. Następnie startuje api/web/jobs/analytics i pokazuje adres web po gotowości API i web. Jobs otrzymuje własne parametry DB/cache oraz lokalny transport Mailpit (`DEV_SMTP_PORT`, syntetyczny nadawca `example.test`, bez poświadczeń produkcyjnych). Zmiany TypeScript wymagają ponownego uruchomienia polecenia; Next działa w trybie dev.
4. `pnpm queues:test`, `pnpm db:seed:test` i `pnpm dev:test` tworzą własne projekty Compose, losowe porty i syntetyczne hasła, a w `finally` usuwają wyłącznie swoje kontenery/wolumeny. Pierwszy test sprawdza Node → Python i blokadę gniazd pytest; drugi wszystkie `expected`, idempotencję i rollback; trzeci start czterech aplikacji, gotowość bazy/cache/kolejki i Mailpit. Diagnostyka w `.git/m0-workers/`. Sondy: `node apps/jobs/dist/healthcheck.js` i `python -m oliginvest_analytics --health`, z tym samym środowiskiem co dany worker.
5. Ctrl+C kończy procesy aplikacji. `docker compose -p oliginvest-dev -f compose.dev.yaml down` zatrzymuje demo i zachowuje trwałe wolumeny; dla właściciela użyj `-p oliginvest-dev-owner`. Zwykłe `pnpm dev` nigdy ich nie usuwa. Ponowny seed sprawdza istniejące dane; nie nadpisuje zmienionego portfela. Reset danych wymaga świadomej decyzji lokalnego operatora.

### 3.1 Logowanie do demo

1. W `.env` ustaw `DEV_PROFILE=demo` (także wartość pusta oznacza demo) i własne `DEV_DEMO_PASSWORD`. Hasło musi spełniać tę samą politykę co rejestracja: 12–128 znaków, kontrola popularnych i kontekstowych haseł, HIBP, Argon2id. Nie używaj hasła do innej usługi. Hasło wpisuj do pliku, nie do argumentów polecenia.
   **Uwaga na `#`:** parser `.env` (`node:util` `parseEnv`) traktuje niecytowany `#` jako początek komentarza i ucina resztę wartości, więc `DEV_DEMO_PASSWORD=abc#def` trafiłoby do seeda jako `abc`. Wartości z `#` (i ze spacjami) ujmij w apostrofy: `DEV_DEMO_PASSWORD='abc#def'`. `pnpm dev` porównuje surowe linie z wynikiem parsowania i przy takiej rozbieżności przerywa start komunikatem z nazwą klucza, bez ujawniania wartości (poprawka po demo 2026-10-26).
2. Uruchom `pnpm dev` w terminalu. Konto `dev@example.invalid` otrzyma poświadczenie przy pierwszym seedzie z hasłem, także gdy istnieje już dawny seed bez hasła. Puste `DEV_DEMO_PASSWORD` pozostawia konto bez nowego poświadczenia. Kolejny start z tym samym hasłem niczego nie resetuje; inne hasło przerywa seed (zmianę wykonaj w aplikacji, następnie uaktualnij `.env`).
3. Otwórz pokazany adres i `/logowanie`, podaj `dev@example.invalid` i ustawione hasło. Skonfiguruj TOTP, potwierdź kod i zapisz kody zapasowe. Zaakceptuj bieżący regulamin i informację o prywatności. Seed nie ustawia MFA ani zgód.
4. Otwórz portfel i obejrzyj dane syntetyczne. Wyłącz i uruchom ponownie `pnpm dev`: hasło, TOTP i kody zapasowe pozostają ważne dzięki kluczom w `.env`. Do prób rzeczywistych importów użyj profilu właściciela; zmiana transakcji demo powoduje odmowę asercji przy następnym seedzie.

### 3.2 Profil właściciela i rzeczywisty import XTB

1. Zatrzymaj demo (`Ctrl+C`, następnie `docker compose -p oliginvest-dev -f compose.dev.yaml down`). Oba profile domyślnie używają tych samych portów hosta, więc uruchamiaj je kolejno.
2. W `.env` ustaw `DEV_PROFILE=owner`. Nie ustawiaj własnego `COMPOSE_PROJECT_NAME`: launcher wybiera `oliginvest-dev-owner`, a demo `oliginvest-dev`. Profile mają odrębne kontenery, wolumeny PostgreSQL i kolejki; obie bazy nazywają się `oliginvest_dev`. Profil owner pomija cały seed, również `DEV_DEMO_PASSWORD`.
3. Przy pierwszym uruchomieniu wykonaj w interaktywnym terminalu (PowerShell, podstaw własne dane):

   ```powershell
   pnpm dev --create-owner --email '<adres właściciela>' --name '<nazwa właściciela>'
   ```

   Po migracjach launcher uruchomi istniejące `create-owner` z tymi samymi hasłami ról DB i kluczami co API, przed startem aplikacji. Potwierdź kontrolę adresu i dokumenty przez `TAK`, następnie wpisz hasło w ukrytym wejściu. Wymagane TTY; hasła nie można przekazać argumentem ani potokiem. Polecenie działa wyłącznie dla pierwszego konta w pustej bazie. Odmowa lub błąd CLI zatrzymuje start aplikacji. Kolejne uruchomienia: samo `pnpm dev`, nadal z `DEV_PROFILE=owner`.
4. Zaloguj się, skonfiguruj TOTP i zachowaj kody zapasowe. Utwórz rachunek XTB. Plik właściciela przechowuj poza repozytorium; wskaż go w formularzu importu (limit 10 MB). Dane pozostają w lokalnym profilu; wiadomości aplikacji trafiają do lokalnego Mailpit.
5. **Pusty katalog wymaga uzupełnienia.** Parser XTB nie pobiera instrumentów z internetu: mapuje po ISIN, symbolach brokera i zapisanych wyborach. Nieznany instrument otrzyma `needs_mapping`. W podglądzie wybierz mapowanie instrumentu, wpisz nazwę lub symbol Yahoo (np. `AAPL`, `PKO.WA`, `VWCE.DE`) i wyszukaj. Pierwsze żądanie może zwrócić pustą listę: uruchamia `market.search` w workerze. Po kilku sekundach ponów wyszukiwanie i wybierz właściwy instrument, sprawdzając giełdę i walutę. Symbol XTB, np. `AAPL.US`, nie musi odpowiadać symbolowi Yahoo. Rozstrzygnij wiersze przed zatwierdzeniem.
6. GPW uzupełnia katalog z archiwum w zadaniu `market.gpw` (dni robocze 18:30 Europe/Warsaw; wymaga uruchomionego jobs i dat w kalendarzu sesji). Nie jest to synchroniczny krok startu. Yahoo działa best effort; przy blokadzie/awarii nie obchodź ograniczeń. Brak wyniku albo niejednoznaczność zatrzymuje mapowanie — nie zastępuj instrumentu podobnym. Katalog nie dostarcza automatycznie całej historii kursów/FX dla wycen: brakujące dane pozostają jawne w aplikacji.
7. Sprawdź uzgodnienie gotówki i ilości, następnie zatwierdź import. Nie traktuj samego przetworzenia pliku jako dowodu zgodności wyniku z brokerem. Ponowne uruchomienie profilu nie zmienia portfela ani konfiguracji TOTP. Zatrzymanie usług: `docker compose -p oliginvest-dev-owner -f compose.dev.yaml down` (bez usuwania wolumenów).

Ścieżki lokalnych kont wymagają jednocześnie `NODE_ENV=development` i `DB_NAME=oliginvest_dev`. Nie dodają tras HTTP ani flag omijających MFA, regulamin, limity czy RLS. Skrypty izolowanych testów zachowują istniejący tryb `test` wyłącznie dla syntetycznego seeda bez hasła i bez profilu właściciela. Nie uruchamiaj dwóch launcherów na tej samej bazie: każdy start zmienia hasła ról DB.

Next dev dopuszcza zasoby developerskie dla `localhost`, pętli zwrotnej IPv4 i `::1` (`allowedDevOrigins` wyłącznie w development). Przekazuje `/api/*` do `API_INTERNAL_URL`, aby SSE i żądania przeglądarki trafiały do API; w produkcji nadal robi to Caddy. Logowanie argumentów Server Functions jest wyłączone (`logging.serverFunctions: false`), ponieważ argumenty zawierają hasła i kody. Formularze czekają na hydratację i mają metodę POST, aby szybkie wysłanie nie umieszczało poświadczeń w URL. Nie zmienia to CSP ani atrybutów ciasteczek produkcyjnych.

## 4. Dane przykładowe (seed)

### Trwałe klucze lokalne

`pnpm dev` wymaga `NODE_ENV=development` i bazy `oliginvest_dev` (puste `DB_NAME` oznacza tę nazwę). Przy pierwszym uruchomieniu generuje `DEV_AUTH_SECRET` i `DEV_AUDIT_KEY` (każdy 32 losowe bajty, zapis hex) i dopisuje je do ignorowanego `.env`. Nie wypisuje wartości. Kolejne starty używają tych samych kluczy do TOTP, kodów zapasowych, sesji i pseudonimizacji audytu; hasła ról DB nadal są losowane. Sprzeczna wartość klucza w powłoce i `.env` przerywa start zamiast cichej rotacji. Zachowaj `.env` razem z lokalną bazą; usunięcie albo zmiana klucza uniemożliwia odczyt wcześniej zaszyfrowanego TOTP. Stare sekrety losowane przed tą poprawką nie są możliwe do odzyskania z nowego `.env`.

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
