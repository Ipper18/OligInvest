# Kontrole bezpieczeństwa i mapowanie OWASP

**Cel:** zebrać w jednym miejscu techniczne kontrole bezpieczeństwa OligInvest (kryptografia i sekrety, transport i nagłówki, walidacja wejścia, łańcuch dostaw, logowanie zdarzeń) i pokazać ich pokrycie względem OWASP Top 10 (2021 i 2025) oraz OWASP ASVS 5.0.0 na poziomach 1–2 — wymaganie po wymaganiu, z jawnie opisanymi odstępstwami.

Powiązane: [`model-zagrozen.md`](model-zagrozen.md), [`uwierzytelnianie-autoryzacja.md`](uwierzytelnianie-autoryzacja.md), [`prywatnosc-rodo.md`](prywatnosc-rodo.md), [`plan-reagowania.md`](plan-reagowania.md), [`../07-wdrozenie/infrastruktura.md`](../07-wdrozenie/infrastruktura.md), [`../07-wdrozenie/ci-cd.md`](../07-wdrozenie/ci-cd.md), [`../02-api/konwencje-api.md`](../02-api/konwencje-api.md). Wymagania: NFR-03.01–NFR-03.13, NFR-11.01, Z-22, Z-28.

Źródła standardów (sprawdzone 2026-09-19): [OWASP ASVS 5.0.0](https://github.com/OWASP/ASVS/releases/tag/v5.0.0_release) (wydanie z 2025-05-30; lista wymagań z pliku CSV wydania, 253 wymagania L1+L2), [OWASP Top 10:2025](https://top10.owasp.org/2025/), [OWASP Top 10:2021](https://owasp.org/Top10/). Treści wymagań ASVS nie są tu kopiowane — tabela § 7 podaje identyfikatory, własne skróty tematów i sposób realizacji.

## 1. Kryptografia i sekrety

### 1.1 Inwentarz kryptograficzny (ASVS V11.1.2)

| Zastosowanie | Algorytm i parametry | Klucz — gdzie | Rotacja |
|---|---|---|---|
| TLS przeglądarka ↔ Caddy (VM) | TLS 1.3; certyfikat ECDSA P-256 z Let's Encrypt (ACME TLS-ALPN-01) | wolumen danych Caddy w VM | automatycznie przez Caddy |
| Konto ACME | klucz konta Caddy, przypięty rekordem CAA `accounturi` | wolumen danych Caddy (w kopii zapasowej) | przy utracie: nowe konto + zmiana CAA |
| Tunel VPS ↔ dom, dostęp administracyjny | WireGuard (X25519, ChaCha20-Poly1305) | pliki konfiguracyjne WireGuard poza repozytorium | raz w roku i po incydencie |
| SSH | Ed25519, tylko klucze | klucz prywatny na urządzeniu administratora | raz w roku |
| Podpis ciasteczka sesji | HMAC-SHA-256 | `BETTER_AUTH_SECRETS` | raz w roku i po incydencie — nowa wersja na początku listy |
| Sekrety TOTP, kody zapasowe, tokeny OAuth | XChaCha20-Poly1305, klucz = SHA-256(sekret), koperta `$ba$<wersja>$` | `BETTER_AUTH_SECRETS` | jw.; dane szyfrowane ponownie przy zapisie + zadanie migracyjne przed usunięciem starej wersji |
| Hasła | Argon2id, m = 19 MiB, t = 2, p = 1, sól per hasło | — | parametry podnoszone przy logowaniu |
| Tokeny PAT, tokeny zaproszeń | ≥ 256 bitów losowych; w bazie skrót SHA-256 | — | wygasanie (90 dni, 72 h) |
| Pseudonim aktora w audycie | HMAC-SHA-256(`user_id`) | `AUDIT_PSEUDONYM_KEY` | tylko po wycieku (zmiana zrywa ciągłość pseudonimów) |
| Web Push | VAPID ES256 (ECDSA P-256); treść szyfrowana wg RFC 8291 (ECDH P-256 + AES-128-GCM) | `VAPID_PRIVATE_KEY` | tylko po wycieku (wymaga ponownej subskrypcji urządzeń) |
| SMTP do Brevo | TLS wymagany (STARTTLS, `requireTLS`) | `SMTP_PASSWORD` | raz w roku |
| Kopie lokalne bazy | pgBackRest, AES-256-CBC (jedyny szyfr obsługiwany przez narzędzie) — odstępstwo O-03 | `PGBACKREST_REPO1_CIPHER_PASS` | przy nowym repozytorium |
| Kopie poza domem | restic: AES-256-CTR + Poly1305-AES, klucz z hasła przez scrypt | hasło repozytorium restic | raz w roku (`restic key add/remove`) |
| rest-server na VPS | bcrypt (`.htpasswd`), transport w WireGuard | hasło klienta kopii | raz w roku |
| Konta usług w bazie i Valkey | PostgreSQL SCRAM-SHA-256; Valkey ACL (użytkownik per usługa) | sekrety Compose | raz w roku i po incydencie — odstępstwo O-05 |
| TOTP | HMAC-SHA-1 (RFC 6238, zgodność z aplikacjami uwierzytelniającymi) | sekret TOTP (zaszyfrowany, wyżej) | przy zmianie urządzenia |
| Sprawdzanie wycieków haseł | prefiks SHA-1 (protokół usługi Pwned Passwords) | — | — |

**Polityka kluczy (ASVS V11.1.1, idea NIST SP 800-57):** klucze i hasła generowane wyłącznie generatorem kryptograficznym (skrypt instalacyjny, ≥ 256 bitów); każdy sekret ma jednego właściciela (usługę) i trafia tylko do jej kontenera; kopia depozytowa wyłącznie w menedżerze haseł właściciela (i wydruk kluczy kopii w bezpiecznym miejscu); nigdy w repozytorium, obrazach, logach ani w kopiach poza domem w postaci jawnej. Przegląd raz w roku (przypomnienie w kalendarzu) i natychmiastowa rotacja przy podejrzeniu wycieku ([`plan-reagowania.md`](plan-reagowania.md) P3). Stare wersje kluczy są usuwane po zakończeniu ponownego szyfrowania.

### 1.2 Poziomy ochrony danych (ASVS V14.1)

| Poziom | Dane | Wymagania ochrony |
|---|---|---|
| **3 — sekrety uwierzytelniania** | skróty haseł, sekrety TOTP, kody zapasowe, tokeny sesji, PAT, sekrety serwera, hasła kopii | nigdy w logach ani odpowiedziach (poza jednorazowym pokazaniem użytkownikowi); szyfrowane lub haszowane; dostęp tylko rola `oliginvest_auth`; rotacja wg § 1.1 |
| **2 — dane finansowe i osobowe** | operacje, pozycje, wyceny, importy i ich pliki, dziennik, analizy, alerty, zgody, e-mail, adresy IP w logach | RLS; `Cache-Control: no-store`; brak w logach (poza identyfikatorami); e-mail i push bez kwot; eksport wyłącznie właścicielowi po step-upie; retencja wg [`prywatnosc-rodo.md`](prywatnosc-rodo.md) § 6; kopie szyfrowane; brak w pamięci przeglądarki poza migawką na żądanie (O-07) |
| **1 — dane wewnętrzne** | konfiguracja, flagi, limity, metryki, logi techniczne bez danych osobowych | dostęp administratora; zmiany w audycie |
| **0 — publiczne i rynkowe** | notowania, katalog instrumentów, dokumentacja | integralność (bramki jakości danych); dostęp tylko dla zalogowanych ze względu na licencje (NFR-07.04) |

### 1.3 Co serwer przechowuje, a czego nie

**Przechowuje:** skróty haseł (Argon2id), zaszyfrowane sekrety TOTP i kody zapasowe, skróty tokenów PAT i zaproszeń, tokeny sesji (w bazie jawnie — ciasteczko wymaga jednak podpisu HMAC sekretem spoza bazy), dane portfela, pliki importu (90 dni), zgody, audyt.

**Nie przechowuje:** haseł do rachunków maklerskich ani sesji brokerów (NFR-03.08), pełnych numerów rachunków (tylko etykieta użytkownika), danych kart płatniczych, haseł w jawnej postaci, pełnych tokenów PAT, zaproszeń i linków resetu w jawnej postaci (poza krótkotrwałym tokenem resetu w tabeli `verifications` Better Auth, 30 min), treści powiadomień push (po wysłaniu), kluczy prywatnych TLS i WireGuard na VPS.

## 2. Transport i nagłówki

### 2.1 TLS

- **TLS 1.3 wyłącznie** (Caddy); wszystkie zestawy szyfrów TLS 1.3 to AEAD z poufnością przyszłą. Wspierane przeglądarki (NFR-04.01) obsługują TLS 1.3.
- **HTTP/3 wyłączony** (`servers { protocols h1 h2 }`): VPS przekazuje wyłącznie TCP, więc ogłaszanie QUIC w `Alt-Svc` prowadziłoby do nieudanych prób.
- **Terminacja w domu**, VPS przekazuje zaszyfrowany strumień po SNI ([ADR-011](../09-decyzje/ADR-011-topologia-wdrozenia.md)).
- **CAA** z `accounturi` i `validationmethods=tls-alpn-01` — Let's Encrypt obsługuje oba parametry (RFC 8657, [dokumentacja CAA](https://letsencrypt.org/docs/caa/)); przejęty VPS nie uzyska certyfikatu dla naszej nazwy, choć przez niego przechodzi ruch ACME.
- **Monitoring Certificate Transparency:** codzienne zapytanie do crt.sh o certyfikaty dla `invest.oligi.pl` i wildcard `*.oligi.pl` (wildcard obejmuje subdomenę mimo CAA na subdomenie); certyfikat nieznanego numeru seryjnego → alert ([`plan-reagowania.md`](plan-reagowania.md) P12).

### 2.2 Nagłówki odpowiedzi (NFR-03.06)

| Nagłówek | Wartość | Ustawia |
|---|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` (bez `preload` — wymagałby objęcia całej domeny `oligi.pl`) | Caddy |
| `Content-Security-Policy` | § 2.3, nonce per żądanie | `web` (`proxy.ts`) |
| `X-Content-Type-Options` | `nosniff` | Caddy + `api` |
| `Referrer-Policy` | `no-referrer` | Caddy |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=(), display-capture=(), browsing-topics=()` | Caddy |
| `X-Frame-Options` | `DENY` (dla starszych przeglądarek; właściwą ochroną jest `frame-ancestors`) | Caddy |
| `Cross-Origin-Opener-Policy` | `same-origin` | Caddy |
| `Cross-Origin-Resource-Policy` | `same-origin` | Caddy + `api` |
| `Cache-Control` | dane użytkownika `no-store`; dane rynkowe `private, max-age=300`; zasoby `/_next/static/*` `public, max-age=31536000, immutable` | `api` / `web` |
| `Clear-Site-Data` | `"cache", "cookies", "storage"` przy wylogowaniu | `api` |
| `Server`, `X-Powered-By` | usunięte (`-Server` w Caddy, `poweredByHeader: false` w Next.js) | Caddy / `web` |

### 2.3 Content Security Policy

```text
default-src 'self';
script-src 'self' 'nonce-{NONCE}' 'strict-dynamic';
style-src 'self' 'nonce-{NONCE}';
img-src 'self' data: blob:;
font-src 'self';
connect-src 'self';
worker-src 'self';
manifest-src 'self';
frame-src 'none';
frame-ancestors 'none';
object-src 'none';
base-uri 'none';
form-action 'self';
upgrade-insecure-requests
```

Bez `unsafe-inline` i `unsafe-eval` (w trybie deweloperskim Next.js wymaga `unsafe-eval` — tylko lokalnie). Motyw strony ustawia serwer atrybutem `data-theme`, więc nie ma skryptów inline bez nonce. `require-trusted-types-for 'script'` sprawdzamy w trybie `Content-Security-Policy-Report-Only` w M6 i włączamy, jeśli Next.js i biblioteki wykresów działają bez naruszeń. Konsekwencję CSP z nonce (renderowanie dynamiczne) opisuje Z-25.

## 3. Walidacja wejścia i ochrona przed wstrzyknięciami (NFR-03.07)

### 3.1 Zasady ogólne

- **Każda granica waliduje:** Zod `.strict()` w `api` dla ciała, parametrów ścieżki i zapytania oraz nagłówków; ten sam schemat w `jobs` dla zadań; JSON Schema (eksport z Zod) i `jsonschema` w workerze Python. Nieznane pola i parametry → `422`.
- **Limity:** ciało JSON ≤ 1 MB (import ≤ 10 MB), każdy ciąg z `maxLength`, każda tablica z `maxItems`, liczby z zakresami; limity czasu parsowania.
- **Typ treści:** mutacje wyłącznie `application/json` lub `multipart/form-data` (inny → `415`).

### 3.2 Wstrzyknięcia SQL i poleceń

Drizzle z parametrami; surowy SQL tylko przez szablon `sql` z parametrami (lint blokuje `sql.raw` z danymi wejściowymi); dynamiczne sortowanie tylko z allowlisty kolumn. Valkey przez klienty z argumentami poleceń. Brak wywołań powłoki w kodzie aplikacji.

### 3.3 XSS

React/JSX koduje wyjście; zakaz `dangerouslySetInnerHTML` (lint); treści użytkownika (notatki, dziennik, nazwy) renderowane jako tekst; linki zewnętrzne tylko `https:` z `rel="noopener noreferrer"`; CSP z nonce jako druga linia obrony.

### 3.4 Pliki

| Wejście | Kontrole |
|---|---|
| Import brokera (XLSX, XLS, CSV) | ≤ 10 MB (Caddy i `api`); sygnatura pliku zamiast rozszerzenia; XLSX: odczyt katalogu ZIP przed parsowaniem — suma rozmiarów ≤ 50 MB, ≤ 100 wpisów, współczynnik kompresji ≤ 100 (ochrona przed bombą ZIP); bez rozwiązywania encji zewnętrznych XML; ≤ 50 000 wierszy; parsowanie w zadaniu `jobs` z limitem czasu i pamięci; formuły arkusza nie są wykonywane (odczyt wartości zapisanych) |
| Import notowań (admin: XLS z archiwum GPW, CSV ze Stooq) | jw. + bramki jakości danych przed zapisem ([`../03-dane/obliczenia-finansowe.md`](../03-dane/obliczenia-finansowe.md) § 14) |
| Pobierane pliki (eksporty) | nazwa generowana przez serwer, `Content-Disposition: attachment` |

### 3.5 Wstrzyknięcie formuł w eksportach CSV

Pole eksportu zaczynające się od `=`, `+`, `-`, `@`, tabulatora lub znaku powrotu karetki dostaje prefiks `'` — arkusz nie wykona formuły z nazwy instrumentu lub notatki. Wyjątek: kolumny liczbowe eksportowane jako liczby (ujemna kwota nie jest formułą).

### 3.6 CSRF

Jeden origin, bez CORS; `SameSite=Lax`; `api` i Better Auth sprawdzają `Origin` (lub `Sec-Fetch-Site: same-origin`) przy metodach modyfikujących z ciasteczkiem; GET nie zmienia stanu; żądania z PAT nie używają ciasteczek.

### 3.7 SSRF i połączenia wychodzące (ASVS V13.2.4)

- Brak funkcji pobierających adres podany przez użytkownika. Linki z newsów są tylko wyświetlane, serwer ich nie otwiera.
- Klient HTTP w `packages/data-providers`: allowlista hostów per adapter (np. archiwum GPW, API NBP, Yahoo, dostawcy USA), wyłącznie HTTPS na porcie 443, rozwiązanie DNS i odrzucenie adresów prywatnych, pętli zwrotnej, link-local i ULA (IPv4 i IPv6), bez podążania za przekierowaniami, limity czasu i rozmiaru odpowiedzi.
- Subskrypcja Web Push: endpoint musi należeć do znanych usług push przeglądarek (lista hostów w konfiguracji); wysyłka bez przekierowań.
- Sieci kontenerów: `web` i `analytics` bez wyjścia do internetu; wychodzą tylko `api` (Pwned Passwords, OAuth), `jobs` (dostawcy, SMTP, push) i `caddy` (ACME) — [`../07-wdrozenie/infrastruktura.md`](../07-wdrozenie/infrastruktura.md) § 5.

### 3.8 Dane z zewnętrznych API

Odpowiedzi dostawców walidowane schematami (typy, zakresy cen i wolumenów, daty w oknie); pola tekstowe (nazwy, tytuły newsów) przycinane do limitu długości, bez znaków sterujących i znaczników HTML; adresy URL tylko `https:`; wartości odrzucone przez bramki jakości trafiają do `market.data_quality_issues`, nie do obliczeń.

### 3.9 Inne klasy błędów

Wyrażenia regularne stałe i zakotwiczone (bez katastrofalnego nawracania), dynamiczne — przez funkcję escapującą; ochrona przed prototype pollution (`Map`, `Object.create(null)`, brak głębokiego scalania danych wejściowych); deserializacja wyłącznie JSON; przekierowania tylko na ścieżki względne; nagłówki e-maili bez znaków nowej linii z danych użytkownika.

## 4. Łańcuch dostaw (NFR-03.09, A03:2025)

### 4.1 Kontrole

| Kontrola | Narzędzie | Skutek |
|---|---|---|
| Lockfile i dokładne wersje | pnpm (`pnpm-lock.yaml`, `save-exact`), uv (`uv.lock` z sumami) | instalacja w CI tylko `--frozen-lockfile` / `uv sync --frozen` |
| Opóźnienie świeżych wersji | pnpm `minimumReleaseAge` (domyślnie 1 dzień od pnpm 11 — ustawiamy 3 dni), Renovate `minimumReleaseAge: "3 days"` | złośliwe wydania wykrywane zwykle w ciągu godzin nie trafiają do projektu |
| Spadek poziomu zaufania pakietu | pnpm `trustPolicy: no-downgrade` | instalacja przerywana, gdy nowa wersja ma słabszy dowód pochodzenia niż poprzednie (np. publikacja z wykradzionego tokenu bez provenance) |
| Skrypty instalacyjne zależności | pnpm `strictDepBuilds: true` + `allowBuilds` (jawna lista) | nieprzejrzany skrypt `postinstall` = czerwony build |
| Zależności z URL/Git w drzewie | pnpm `blockExoticSubdeps: true` | wyjątek jawny: tarball SheetJS z CDN z sumą kontrolną |
| Znane podatności | osv-scanner (PR i co tydzień), alerty Dependabot | podatność powyżej progu z dostępną poprawką blokuje scalenie |
| Analiza kodu | CodeQL (JS/TS, Python, GitHub Actions) | alerty w zakładce Security |
| Sekrety | skanowanie sekretów GitHub z push protection | push z sekretem odrzucony |
| SBOM | syft (CycloneDX) dla każdego obrazu | załącznik wydania |
| Pochodzenie i podpis obrazów | GitHub artifact attestations (provenance) + cosign keyless (OIDC GitHub) | wdrożenie weryfikuje podpis i tożsamość workflow przed uruchomieniem |
| Obrazy bazowe | przypięte digestem, aktualizowane przez Renovate | brak niekontrolowanych zmian |
| Akcje GitHub | przypięte pełnym SHA commitu (dokumentacja GitHub: jedyny sposób na niezmienną wersję akcji) | brak podmiany akcji |
| Runnery | wyłącznie hostowane przez GitHub (dokumentacja GitHub odradza runnery własne w repozytoriach publicznych) | kod z PR nie trafia na serwer domowy |

### 4.2 Terminy usuwania podatności (ASVS V15.1.1)

| Waga | Termin od publikacji poprawki |
|---|---|
| Krytyczna lub aktywnie wykorzystywana (katalog CISA KEV) | 72 h |
| Wysoka | 7 dni |
| Średnia | 30 dni |
| Niska | 90 dni lub przy aktualizacji miesięcznej |
| Aktualizacje bez podatności | raz w miesiącu (grupy Renovate) |
| Komponent nieutrzymywany > 12 miesięcy | plan wymiany w backlogu (dla skilli społecznościowych próg 6 miesięcy — [`../09-decyzje/audyt-pluginow.md`](../09-decyzje/audyt-pluginow.md)) |

Podatność bez poprawki: ocena, czy dotyczy używanej ścieżki kodu, wpis w rejestrze ryzyk i środek tymczasowy (np. wyłączenie funkcji flagą).

### 4.3 Konfiguracja menedżera pakietów

```yaml
# pnpm-workspace.yaml — fragment ilustracyjny (pnpm 12)
packages: ["apps/*", "modules/*", "packages/*"]
minimumReleaseAge: 4320          # minuty = 3 dni
trustPolicy: no-downgrade
strictDepBuilds: true
blockExoticSubdeps: true
allowBuilds:
  esbuild: true                  # lista uzupełniana wyłącznie w przeglądzie PR
```

### 4.4 Licencje

Dozwolone bez przeglądu: MIT, ISC, BSD-2/3-Clause, Apache-2.0, 0BSD, CC0-1.0, Unlicense. Wymagają przeglądu: MPL-2.0 (na poziomie pliku — dopuszczalna), LGPL (tylko linkowanie dynamiczne), licencje z klauzulami dodatkowymi (vectorbt: Apache-2.0 + Commons Clause — dopuszczalne dla projektu niekomercyjnego). Niedozwolone w kodzie aplikacji: GPL i AGPL. Kontrola licencji w CI na podstawie SBOM.

## 5. Logowanie, monitoring bezpieczeństwa i wykrywanie (NFR-03.10, ASVS V16)

### 5.1 Inwentarz logów (ASVS V16.1.1)

| Log | Zawartość | Format i miejsce | Retencja | Dostęp |
|---|---|---|---|---|
| nginx `stream` na VPS | czas, adres IP klienta, nazwa SNI, bajty, czas połączenia — bez treści | tekst, dziennik VPS | 14 dni | root VPS |
| CrowdSec (LAPI na VPS) | alerty i decyzje: adres IP, scenariusz, czas | baza CrowdSec na VPS | alerty 30 dni, decyzje wg czasu blokady | root VPS |
| Caddy (VM) | żądania: czas, metoda, ścieżka, status, czas odpowiedzi, IP, `X-Request-Id`; nagłówki `Cookie` i `Authorization` redagowane domyślnie przez Caddy | JSON, wolumen logów | 14 dni | root VM |
| `api`, `jobs`, `web` | zdarzenia aplikacji z `request_id`, `user_id` (UUID), trasą, statusem; bez danych finansowych i sekretów | JSON (pino), sterownik logów Dockera z rotacją | 14 dni | root VM |
| `analytics` (Python) | zadania: identyfikator, typ, czas, wynik; bez danych wejściowych | JSON (structlog) | 14 dni | root VM |
| PostgreSQL | błędy, wolne zapytania > 500 ms **bez wartości parametrów** (`log_parameter_max_length = 0`), połączenia odrzucone | tekst, wolumen bazy | 14 dni | root VM |
| `platform.audit_log` | zdarzenia bezpieczeństwa i administracyjne (§ 5.2) | tabela append-only | 2 lata (pseudonim po usunięciu konta) | administrator (UI), użytkownik — własne wpisy |
| SSH i system (VM, VPS) | logowania, sudo | journald; agent CrowdSec | 30 dni | root |
| Uptime Kuma (VPS) | wyniki sond i sygnałów życia — bez danych osobowych | baza Kuma | 90 dni | administrator przez WireGuard |
| Kopie zapasowe | przebieg, rozmiary, wyniki weryfikacji | JSON, VM + sygnał życia do Kuma | 90 dni | root VM |

Logi trafiają wyłącznie do miejsc z tej tabeli (ASVS V16.2.3); znaczniki czasu w UTC, zegary synchronizowane przez chrony (V16.2.2).

### 5.2 Zdarzenia bezpieczeństwa (w `platform.audit_log`)

| Zdarzenie | `action` | Alert |
|---|---|---|
| Logowanie udane / nieudane (hasło) | `auth.sign_in`, `auth.sign_in_failed` | seria — § 5.3 |
| Drugi czynnik udany / nieudany / blokada | `auth.2fa_verified`, `auth.2fa_failed`, `auth.2fa_locked` | blokada → e-mail do użytkownika |
| Kod zapasowy użyty / nowy komplet | `auth.backup_code_used`, `auth.backup_codes_regenerated` | e-mail do użytkownika |
| Zmiana i reset hasła | `auth.password_changed`, `auth.password_reset` | e-mail do użytkownika |
| Step-up udany / nieudany | `auth.step_up`, `auth.step_up_failed` | seria nieudanych → e-mail |
| Sesja: utworzona z nowego urządzenia, odwołana, przekroczony limit sesji | `session.new_device`, `session.revoked`, `session.limit_evicted` | nowe urządzenie → e-mail do użytkownika |
| Token PAT: utworzony, pierwsze użycie z nowej sieci, odwołany, wygasły | `pat.created`, `pat.new_network`, `pat.revoked` | nowa sieć → e-mail |
| Eksport RODO: zlecony, pobrany | `identity.export_requested`, `identity.export_downloaded` | § 5.3 |
| Usunięcie konta: zlecone, anulowane, wykonane | `identity.deletion_*` | e-mail do użytkownika |
| Akceptacja regulaminu, zgoda udzielona / wycofana | `legal.accepted`, `legal.consent_changed` | — |
| Odmowa dostępu: 403, 404 na cudzy zasób, brak zakresu PAT | `authz.denied` | seria → administrator |
| Przekroczenie limitu żądań | `ratelimit.exceeded` | seria → CrowdSec |
| Naruszenie polityki RLS (błąd `42501` przy zapisie) | `security.rls_violation` | **natychmiast** — nie powinno wystąpić nigdy |
| Każda akcja administratora | `admin.*` (stan przed i po) | zmiana roli, reset 2FA, flagi → e-mail do właściciela instancji |

### 5.3 Reguły wykrywania anomalii

| Reguła | Próg startowy | Reakcja |
|---|---|---|
| Nieudane logowania na jedno konto | ≥ 5 w 15 min | e-mail do użytkownika; narastające opóźnienie |
| Nieudane logowania z jednego adresu na wiele kont | ≥ 10 kont w 15 min | decyzja CrowdSec (blokada na VPS) + alert admina |
| Logowanie z nowego urządzenia | przeglądarka i prefiks sieci nieobecne w 90 dniach | e-mail „nowe logowanie” z linkiem do listy sesji |
| Masowy eksport | > 3 eksporty w 24 h albo eksport + nowy token PAT + nowe urządzenie w ciągu 1 h | alert admina, wstrzymanie pobrania do step-upu |
| Nieudane step-upy | ≥ 5 w 15 min | blokada step-upu 15 min + e-mail |
| Skanowanie API | ≥ 30 odpowiedzi 404/401 z adresu w 5 min | CrowdSec (scenariusz sondowania HTTP) |
| Naruszenie RLS | 1 | alert natychmiastowy, incydent SEV1 ([`plan-reagowania.md`](plan-reagowania.md)) |
| Zmiany administracyjne poza oknem | zmiana roli, flag lub limitów | e-mail do właściciela instancji po każdej zmianie |

### 5.4 Redakcja danych w logach (ASVS V16.2.5)

Nigdy nie logujemy: haseł, kodów TOTP i zapasowych, tokenów (sesji, PAT, zaproszeń, resetu), nagłówków `Cookie` i `Authorization`, treści plików importu, kwot, ilości i cen z portfela użytkownika, treści notatek i dziennika. Maskujemy: adres e-mail (`a***@d***.pl`) w logach aplikacji (pełny adres tylko w audycie), token sesji — wyłącznie jako skrót SHA-256. Logger ma listę ścieżek do redakcji (pino `redact`) i test, który sprawdza, że przykładowe żądania nie zostawiają tych wartości w logu.

## 6. OWASP Top 10 — mapowanie (2021 i 2025)

| OWASP Top 10:2021 | Odpowiednik 2025 | Główne kontrole OligInvest | Weryfikacja |
|---|---|---|---|
| A01 Broken Access Control | A01:2025 (obejmuje też SSRF) | domyślna odmowa, RBAC, RLS (FORCE), cudzy zasób → 404, admin bez danych finansowych, allowlista połączeń wychodzących | testy RLS, test listy operacji, testy IDOR |
| A02 Cryptographic Failures | A04:2025 | TLS 1.3, Argon2id, XChaCha20-Poly1305, wersjonowane klucze, § 1 | skan TLS, przegląd inwentarza |
| A03 Injection | A05:2025 | Zod `.strict()`, Drizzle z parametrami, React + CSP z nonce, neutralizacja formuł CSV | lint, testy negatywne |
| A04 Insecure Design | A06:2025 | model zagrożeń STRIDE per moduł, bramki MFA i regulaminu, limity zasobożernych funkcji, worker bez internetu | [`model-zagrozen.md`](model-zagrozen.md), przegląd przy nowym module |
| A05 Security Misconfiguration | A02:2025 | nagłówki § 2, kontenery bez roota z FS tylko do odczytu, brak debugowania, zablokowane trasy Better Auth | skan nagłówków, lista kontrolna hardeningu |
| A06 Vulnerable and Outdated Components | A03:2025 Software Supply Chain Failures | § 4: lockfile, opóźnienie wydań, `trustPolicy`, osv-scanner, SBOM, podpisane obrazy, akcje przypięte SHA | CI |
| A07 Identification and Authentication Failures | A07:2025 Authentication Failures | TOTP obowiązkowe, polityka haseł, limity, rotacja sesji, `__Host-` | testy uwierzytelniania |
| A08 Software and Data Integrity Failures | A08:2025 | weryfikacja podpisów obrazów przy wdrożeniu, JSON Schema dla zadań, bramki jakości danych rynkowych, append-only audytu i kopii | CI + test wdrożenia |
| A09 Security Logging and Monitoring Failures | A09:2025 Logging & Alerting Failures | § 5: katalog zdarzeń, reguły wykrywania, alerty, CrowdSec | testy zdarzeń, ćwiczenia z [`plan-reagowania.md`](plan-reagowania.md) |
| A10 Server-Side Request Forgery | w A01:2025 | § 3.7 | testy SSRF adapterów |
| — (nowa kategoria) | A10:2025 Mishandling of Exceptional Conditions | Problem Details bez szczegółów, brak „fail-open”, circuit breaker i flaga `stale`, transakcje wycofywane przy błędzie | testy chaos adapterów, testy błędów |

## 7. ASVS 5.0.0 — poziomy 1 i 2, wymaganie po wymaganiu

**Legenda.** Status: **P** — zaprojektowane (kontrola opisana w dokumentacji; weryfikacja przy implementacji i w przeglądzie bezpieczeństwa M6), **O** — odstępstwo z uzasadnieniem i środkami kompensującymi (§ 8), **N/D** — nie dotyczy (uzasadnienie w wierszu). Weryfikacja: **T** — test automatyczny w CI, **S** — skan lub kontrola konfiguracji, **R** — przegląd kodu lub dokumentacji, **M** — test ręczny. Oznaczenie „(P2)” — funkcja planowana w priorytecie P2 (OAuth).

<!-- ASVS-TABLE:START -->
Stan na 2026-09-19 (faza projektu): **253 wymagań L1+L2** — P: 184, O: 11, N/D: 58. Poziom L1: 70, L2: 183.


#### V1 Kodowanie i sanityzacja — 27 wymagań (P 18, O 0, N/D 9)

| ID | L | Temat (skrót własny) | Status | Realizacja w OligInvest | Weryf. |
|---|---|---|---|---|---|
| V1.1.1 | 2 | Jednokrotne dekodowanie do postaci kanonicznej | P | Hono i Zod dekodują JSON/URL raz, na granicy `api`; walidacja po dekodowaniu, bez wtórnego dekodowania w domenie | R |
| V1.1.2 | 2 | Kodowanie wyjścia na końcu, przez interpreter docelowy | P | JSX (React) koduje przy renderowaniu; SQL przez parametry Drizzle; CSV przez bibliotekę z cytowaniem pól | R |
| V1.2.1 | 1 | Kodowanie zależne od kontekstu (HTML, atrybuty, nagłówki) | P | React/JSX; zakaz `dangerouslySetInnerHTML` (lint); nagłówki przez API frameworka, bez sklejania wartości użytkownika | T, R |
| V1.2.2 | 1 | Budowanie URL-i; tylko bezpieczne schematy | P | `URL`/`URLSearchParams`; linki zewnętrzne (newsy) tylko `https:` — walidacja przy zapisie i przy renderowaniu | T |
| V1.2.3 | 1 | Kodowanie przy budowaniu JavaScript/JSON | P | JSON wyłącznie przez serializację frameworka; brak skryptów inline z danymi (CSP z nonce) | R |
| V1.2.4 | 1 | Zapytania parametryzowane | P | Drizzle z parametrami; surowy SQL tylko przez szablon `sql` z parametrami; lint blokuje `sql.raw` z danymi wejściowymi | T, R |
| V1.2.5 | 1 | Wstrzykiwanie poleceń systemowych | P | aplikacja nie uruchamia poleceń powłoki; skrypty operacyjne nie przyjmują danych od użytkowników | R |
| V1.2.6 | 2 | Wstrzykiwanie LDAP | N/D | brak LDAP | — |
| V1.2.7 | 2 | Wstrzykiwanie XPath | N/D | brak zapytań XPath (XLSX parsuje SheetJS) | — |
| V1.2.8 | 2 | Wstrzykiwanie LaTeX | N/D | brak LaTeX | — |
| V1.2.9 | 2 | Znaki specjalne w wyrażeniach regularnych | P | wzorce budowane z danych (wyszukiwarka) przez funkcję escapującą; wzorce Zod stałe i zakotwiczone, bez katastrofalnego nawracania | T, R |
| V1.3.1 | 1 | Sanityzacja HTML z edytorów | N/D | brak edytora HTML; notatki i dziennik to tekst renderowany jako tekst | — |
| V1.3.2 | 1 | Brak eval i dynamicznego kodu | P | zakaz `eval`/`new Function` (lint); w Pythonie brak `eval`, `exec`, `pickle`; strategie backtestu to deklaratywny JSON (JSON Schema) | T, R |
| V1.3.3 | 2 | Sanityzacja przed niebezpiecznym kontekstem | P | eksport CSV neutralizuje formuły (pole zaczynające się od `=`, `+`, `-`, `@`, tabulatora lub CR poprzedzone apostrofem); limity długości pól | T |
| V1.3.4 | 2 | SVG od użytkownika | N/D | brak przesyłania SVG (import: XLSX, XLS, CSV) | — |
| V1.3.5 | 2 | Markdown/CSS/szablony od użytkownika | P | MDX tylko z repozytorium (kompilacja w buildzie); treści użytkownika nie są interpretowane jako Markdown ani HTML | R |
| V1.3.6 | 2 | SSRF | P | brak pobierania URL-i od użytkownika; klient HTTP adapterów z allowlistą hostów, blokadą adresów prywatnych i bez przekierowań; endpoint push tylko z hostów usług push | T |
| V1.3.7 | 2 | Wstrzykiwanie szablonów | P | szablony e-maili i powiadomień stałe w kodzie, dane wstawiane jako wartości z escapingiem | R |
| V1.3.8 | 2 | Wstrzykiwanie JNDI | N/D | brak Javy i JNDI | — |
| V1.3.9 | 2 | Wstrzykiwanie do memcache | N/D | brak memcache; Valkey przez klienta z argumentami poleceń (bez sklejania tekstu poleceń) | — |
| V1.3.10 | 2 | Ciągi formatujące | P | logger strukturalny (pino, structlog) z polami zamiast formatowania tekstu danymi | R |
| V1.3.11 | 2 | Wstrzykiwanie SMTP | P | adresy walidowane (Zod), temat i nagłówki bez znaków nowej linii z danych użytkownika; nodemailer | T |
| V1.4.1 | 2 | Bezpieczne operacje na pamięci | N/D | TypeScript i Python z zarządzaną pamięcią; natywna zależność argon2 napisana w Ruście | — |
| V1.4.2 | 2 | Przepełnienia liczb całkowitych | P | kwoty w `decimal.js`/`NUMERIC`; zakresy wartości w Zod (ilości, ceny, parametry analiz) | T |
| V1.4.3 | 2 | Zwalnianie pamięci | N/D | pamięć zarządzana (GC); limity pamięci kontenerów i zadań | — |
| V1.5.1 | 1 | XXE w parserach XML | P | XLSX (Office Open XML) parsuje SheetJS bez rozwiązywania encji zewnętrznych; test z plikiem zawierającym encję zewnętrzną | T |
| V1.5.2 | 2 | Bezpieczna deserializacja | P | wyłącznie JSON ze schematem (Zod, JSON Schema w Pythonie); brak `pickle` i serializacji obiektów | R |

#### V2 Walidacja i logika biznesowa — 11 wymagań (P 11, O 0, N/D 0)

| ID | L | Temat (skrót własny) | Status | Realizacja w OligInvest | Weryf. |
|---|---|---|---|---|---|
| V2.1.1 | 1 | Dokumentacja reguł walidacji | P | `openapi.yaml` (typy, wzorce, zakresy) + schematy Zod w `packages/contracts` jako źródło prawdy | R |
| V2.1.2 | 2 | Reguły spójności danych złożonych | P | reguły typów operacji (`TransactionInput`, CHECK w `schema.sql`), wagi alokacji sumujące się do 1, `from ≤ to` | R |
| V2.1.3 | 2 | Limity logiki biznesowej | P | limity ról (`platform.role_limits`), granice parametrów analiz (Z-19), limity z konwencji API § 7 | R |
| V2.2.1 | 1 | Walidacja pozytywna całego wejścia | P | Zod `.strict()` dla ciał, parametrów i nagłówków: enumeracje, wzorce, zakresy | T |
| V2.2.2 | 1 | Walidacja w zaufanej warstwie | P | walidacja w `api` oraz ponownie w `jobs` i workerze Python; walidacja w przeglądarce tylko dla wygody | T |
| V2.2.3 | 2 | Spójność powiązanych pól | P | walidatory krzyżowe (SPLIT wymaga współczynnika, FX_CONVERSION dwóch nóg, waluty zgodne z rachunkiem) + CHECK w bazie | T |
| V2.3.1 | 1 | Kolejność kroków procesu | P | import `uploaded → parsed → committed`; rejestracja: zaproszenie → konto → TOTP; analiza `queued → running → done` — przejścia sprawdzane | T |
| V2.3.2 | 2 | Limity logiki wg dokumentacji | P | egzekwowane w `api`: kwoty analiz ciężkich, importów, tokenów PAT, reguł alertów | T |
| V2.3.3 | 2 | Transakcje w logice biznesowej | P | zatwierdzenie importu, zapis operacji i przeliczenia w transakcjach bazy; zdarzenia po `COMMIT` | T |
| V2.3.4 | 2 | Blokady zasobów ograniczonych | P | `Idempotency-Key`, jednorazowe zużycie zaproszeń i kodów zapasowych (warunkowy UPDATE), deduplikacja zadań (`jobId`) | T |
| V2.4.1 | 2 | Ochrona przed automatyzacją | P | limity żądań per IP, użytkownik i token; kwoty dzienne ról; limit strumieni SSE; CrowdSec | T |

#### V3 Bezpieczeństwo frontendu — 19 wymagań (P 18, O 1, N/D 0)

| ID | L | Temat (skrót własny) | Status | Realizacja w OligInvest | Weryf. |
|---|---|---|---|---|---|
| V3.2.1 | 1 | Treść w niewłaściwym kontekście | P | API zawsze JSON/`problem+json` z `nosniff`; pliki z `Content-Disposition: attachment`; pliki importu nigdy nie są serwowane | S |
| V3.2.2 | 1 | Tekst renderowany jako tekst | P | React domyślnie; brak `innerHTML`; treści alertów i notatek jako tekst | T |
| V3.3.1 | 1 | Ciasteczka `Secure` z przedrostkiem | P | przedrostek `__Host-` (docelowo) lub `__Secure-`, zawsze `Secure` | T |
| V3.3.2 | 2 | `SameSite` wg przeznaczenia | P | `Lax` dla sesji (działają linki z e-maili i powiadomień); mutacje chronione sprawdzaniem `Origin` | T |
| V3.3.3 | 2 | Przedrostek `__Host-` | **O** | Better Auth dokleja `__Secure-`; `__Host-` przez obejście konfiguracji ([`uwierzytelnianie-autoryzacja.md`](uwierzytelnianie-autoryzacja.md) § 4.1) — O-01 | T |
| V3.3.4 | 2 | `HttpOnly` dla tokenu sesji | P | token tylko w ciasteczku `HttpOnly`, nigdy w treści odpowiedzi ani w `localStorage` | T |
| V3.4.1 | 1 | HSTS ≥ 1 rok z subdomenami | P | `Strict-Transport-Security: max-age=63072000; includeSubDomains` na każdej odpowiedzi (Caddy) | S |
| V3.4.2 | 1 | CORS | P | brak nagłówków CORS — jeden origin | S |
| V3.4.3 | 2 | CSP z `object-src 'none'`, `base-uri 'none'`, nonce | P | CSP per żądanie z nonce i `strict-dynamic` (§ 2.3) | S, T |
| V3.4.4 | 2 | `X-Content-Type-Options: nosniff` | P | na wszystkich odpowiedziach (Caddy i `api`) | S |
| V3.4.5 | 2 | Referrer-Policy | P | `no-referrer` globalnie | S |
| V3.4.6 | 2 | `frame-ancestors` | P | `frame-ancestors 'none'` + `X-Frame-Options: DENY` dla starszych przeglądarek | S |
| V3.5.1 | 1 | CSRF bez mechanizmu preflight | P | sprawdzanie `Origin`/`Sec-Fetch-Site` przy metodach modyfikujących z ciasteczkiem (`api` i Better Auth), `SameSite=Lax` | T |
| V3.5.2 | 1 | Preflight nie do obejścia | P | mutacje tylko z `Content-Type: application/json` lub `multipart/form-data` i zgodnym `Origin` | T |
| V3.5.3 | 1 | Metody bezpieczne bez skutków | P | GET/HEAD bez zmian stanu (reguła przeglądu tras w OpenAPI) | T |
| V3.5.4 | 2 | Osobne aplikacje na osobnych hostach | P | OligInvest na `invest.oligi.pl`, Immich pod inną nazwą; panel admina w tej samej aplikacji (ten sam poziom zaufania) | R |
| V3.5.5 | 2 | Wiadomości `postMessage` | P | brak nasłuchu `message` z innych originów; `BroadcastChannel` w obrębie originu z kontrolą typu wiadomości | R |
| V3.7.1 | 2 | Wspierane technologie klienta | P | bez wtyczek przeglądarki; przeglądarki wg NFR-04.01 | R |
| V3.7.2 | 2 | Przekierowania tylko na allowlistę | P | `callbackURL`/`redirectTo` tylko ścieżki względne (Better Auth + Zod); linki zewnętrzne to zwykłe linki, nie przekierowania serwera | T |

#### V4 API i usługi sieciowe — 10 wymagań (P 4, O 0, N/D 6)

| ID | L | Temat (skrót własny) | Status | Realizacja w OligInvest | Weryf. |
|---|---|---|---|---|---|
| V4.1.1 | 1 | `Content-Type` z kodowaniem znaków | P | `application/json; charset=utf-8`, `text/plain; charset=utf-8`, `text/event-stream; charset=utf-8` | T |
| V4.1.2 | 2 | HTTP→HTTPS tylko dla stron | P | port 80 na VPS: 301 dla stron, 403 dla `/api/*`; HSTS | S |
| V4.1.3 | 2 | Nagłówki pośredników nienadpisywalne | P | Caddy ustawia od nowa `X-Forwarded-For` (adres z protokołu PROXY) i `X-Request-Id`; `api` ufa tylko sieci Caddy | T |
| V4.2.1 | 2 | Granice wiadomości HTTP (smuggling) | P | Caddy (Go) i Node (llhttp) zgodne z RFC; VPS przekazuje TCP bez parsowania HTTP; jeden pośrednik L7 | R |
| V4.3.1 | 2 | GraphQL — limity zapytań | N/D | brak GraphQL | — |
| V4.3.2 | 2 | GraphQL — introspekcja | N/D | brak GraphQL | — |
| V4.4.1 | 1 | WebSocket przez TLS | N/D | brak WebSocket — realtime przez SSE (ADR-007) | — |
| V4.4.2 | 2 | WebSocket — kontrola `Origin` | N/D | brak WebSocket — realtime przez SSE (ADR-007) | — |
| V4.4.3 | 2 | WebSocket — tokeny sesji | N/D | brak WebSocket — realtime przez SSE (ADR-007) | — |
| V4.4.4 | 2 | WebSocket — przejście z sesji HTTPS | N/D | brak WebSocket — realtime przez SSE (ADR-007) | — |

#### V5 Obsługa plików — 9 wymagań (P 8, O 0, N/D 1)

| ID | L | Temat (skrót własny) | Status | Realizacja w OligInvest | Weryf. |
|---|---|---|---|---|---|
| V5.1.1 | 2 | Dokumentacja typów i rozmiarów plików | P | import: XLSX/XLS/CSV ≤ 10 MB, XLSX po rozpakowaniu ≤ 50 MB i ≤ 100 wpisów; import notowań (admin): XLS/CSV ≤ 10 MB (§ 3.4) | R |
| V5.2.1 | 1 | Limit rozmiaru plików | P | limit w Caddy i `api` (10 MB), ≤ 50 000 wierszy, limit czasu i pamięci zadania parsowania | T |
| V5.2.2 | 1 | Rozszerzenie zgodne z treścią | P | sygnatury: XLSX (ZIP + `[Content_Types].xml`), XLS (nagłówek OLE), CSV (tekst bez bajtów NUL) | T |
| V5.2.3 | 2 | Archiwa: limit po rozpakowaniu i liczby plików | P | odczyt katalogu ZIP przed parsowaniem: suma ≤ 50 MB, ≤ 100 wpisów, współczynnik kompresji ≤ 100 | T |
| V5.3.1 | 1 | Pliki nie są wykonywane | P | pliki w bazie (`bytea`), nigdy w katalogu publicznym | R |
| V5.3.2 | 1 | Ścieżki z danych zaufanych | P | brak zapisu plików pod nazwą od użytkownika; nazwa pliku to tylko metadana tekstowa | R |
| V5.4.1 | 2 | Nazwy plików przy pobieraniu | P | `Content-Disposition` z nazwą generowaną przez serwer | T |
| V5.4.2 | 2 | Kodowanie nazw plików (RFC 6266) | P | nazwy ASCII z typu i daty, bez danych użytkownika | T |
| V5.4.3 | 2 | Skanowanie antywirusowe | N/D | pliki od użytkowników nie są nikomu serwowane — tylko parsowane w izolowanym zadaniu | — |

#### V6 Uwierzytelnianie — 35 wymagań (P 30, O 1, N/D 4)

| ID | L | Temat (skrót własny) | Status | Realizacja w OligInvest | Weryf. |
|---|---|---|---|---|---|
| V6.1.1 | 1 | Dokumentacja ochrony przed stuffingiem, bez złośliwych blokad | P | [`uwierzytelnianie-autoryzacja.md`](uwierzytelnianie-autoryzacja.md) § 3 | R |
| V6.1.2 | 2 | Lista słów kontekstowych | P | [`uwierzytelnianie-autoryzacja.md`](uwierzytelnianie-autoryzacja.md) § 2 | R |
| V6.1.3 | 2 | Dokumentacja wszystkich ścieżek uwierzytelniania | P | [`uwierzytelnianie-autoryzacja.md`](uwierzytelnianie-autoryzacja.md) § 1 | R |
| V6.2.1 | 1 | Minimalna długość hasła | P | 12 znaków (FR-07.02) przy obowiązkowym TOTP | T |
| V6.2.2 | 1 | Zmiana hasła | P | `/api/auth/change-password` | T |
| V6.2.3 | 1 | Zmiana wymaga bieżącego hasła | P | `currentPassword` obowiązkowe | T |
| V6.2.4 | 1 | Lista popularnych haseł | P | 10 000 najpopularniejszych haseł (offline) + HIBP | T |
| V6.2.5 | 1 | Brak reguł składu | P | brak wymagań co do rodzaju znaków | T |
| V6.2.6 | 1 | Maskowanie pól hasła | P | `type=password` z przyciskiem podglądu | T |
| V6.2.7 | 1 | Wklejanie i menedżery haseł | P | dozwolone; poprawne `autocomplete` | T |
| V6.2.8 | 1 | Hasło bez modyfikacji | P | bez przycinania i zmiany wielkości liter | T |
| V6.2.9 | 2 | Hasła ≥ 64 znaki | P | do 128 znaków | T |
| V6.2.10 | 2 | Brak okresowej rotacji | P | zmiana wymuszana tylko po wycieku | R |
| V6.2.11 | 2 | Blokada słów kontekstowych | P | sprawdzenie przy rejestracji i zmianie hasła | T |
| V6.2.12 | 2 | Hasła z wycieków | P | wtyczka `haveIBeenPwned` (k-anonimowość) | T |
| V6.3.1 | 1 | Kontrole przeciw stuffingowi i brute force | P | limity, narastające opóźnienia, blokada TOTP, CrowdSec ([`uwierzytelnianie-autoryzacja.md`](uwierzytelnianie-autoryzacja.md) § 3) | T |
| V6.3.2 | 1 | Brak kont domyślnych | P | pierwsze konto administratora powstaje z jednorazowego zaproszenia wygenerowanego poleceniem CLI | R |
| V6.3.3 | 2 | Uwierzytelnianie wieloskładnikowe | P | TOTP obowiązkowe dla każdego konta (bramka MFA) | T |
| V6.3.4 | 2 | Brak nieudokumentowanych ścieżek | P | test wylicza trasy Better Auth i sprawdza blokadę tych spoza listy | T |
| V6.4.1 | 1 | Kody aktywacyjne losowe i krótkotrwałe | P | zaproszenie: 256 bitów, 72 h, jednorazowe, skrót SHA-256 w bazie | T |
| V6.4.2 | 1 | Brak podpowiedzi i pytań pomocniczych | P | brak | R |
| V6.4.3 | 2 | Reset hasła nie omija MFA | P | po resecie logowanie wymaga TOTP | T |
| V6.4.4 | 2 | Utrata czynnika — weryfikacja jak przy rejestracji | P | reset 2FA tylko przez admina po potwierdzeniu tożsamości poza systemem ([`uwierzytelnianie-autoryzacja.md`](uwierzytelnianie-autoryzacja.md) § 9) | R |
| V6.5.1 | 2 | Jednorazowość TOTP i kodów zapasowych | P | kody zapasowe zużywane atomowo; ostatni krok TOTP zapamiętany per użytkownik | T |
| V6.5.2 | 2 | Kody zapasowe haszowane | **O** | Better Auth przechowuje kody zaszyfrowane (XChaCha20-Poly1305), nie haszowane — O-02 | R |
| V6.5.3 | 2 | Sekrety z CSPRNG | P | generatory Better Auth i `crypto.randomBytes` | R |
| V6.5.4 | 2 | Entropia kodów ≥ 20 bitów | P | kody zapasowe 10 znaków, TOTP 6 cyfr | R |
| V6.5.5 | 2 | Czas życia TOTP ≤ 30 s | P | okres 30 s, tolerancja jednego kroku wstecz na przesunięcie zegara (chrony) | T |
| V6.6.1 | 2 | OTP przez SMS/telefon | N/D | brak kodów SMS i telefonicznych | — |
| V6.6.2 | 2 | Wiązanie kodów out-of-band z żądaniem | N/D | brak czynników out-of-band (link resetu hasła nie jest czynnikiem logowania) | — |
| V6.6.3 | 2 | Ochrona kodów out-of-band | N/D | jw. | — |
| V6.8.1 | 2 | Wielu dostawców tożsamości — brak podszycia | P | (P2) konto = `providerId` + `accountId`; brak automatycznego łączenia po e-mailu | T |
| V6.8.2 | 2 | Podpisy asercji | P | (P2) ID Token Google walidowany przez bibliotekę; GitHub bez ID Token (wymiana kodu kanałem zwrotnym) | R |
| V6.8.3 | 2 | Asercje SAML | N/D | brak SAML | — |
| V6.8.4 | 2 | Siła uwierzytelnienia u dostawcy | P | po każdym logowaniu przez dostawcę wymagane nasze TOTP (bramka MFA) | T |

#### V7 Zarządzanie sesją — 18 wymagań (P 16, O 0, N/D 2)

| ID | L | Temat (skrót własny) | Status | Realizacja w OligInvest | Weryf. |
|---|---|---|---|---|---|
| V7.1.1 | 2 | Dokumentacja limitów sesji i odstępstw od NIST | P | [`uwierzytelnianie-autoryzacja.md`](uwierzytelnianie-autoryzacja.md) § 4 i § 4.2 (świadome odstępstwo od zaleceń NIST SP 800-63B-4 z uzasadnieniem — O-09) | R |
| V7.1.2 | 2 | Liczba równoległych sesji | P | maks. 10; przy przekroczeniu unieważnienie najstarszej i e-mail | T |
| V7.1.3 | 2 | Sesje federacyjne (SSO) | N/D | brak SSO; OAuth (P2) tylko jako pierwszy czynnik logowania | — |
| V7.2.1 | 1 | Weryfikacja tokenów w backendzie | P | każda weryfikacja w `api` (Better Auth + baza) | T |
| V7.2.2 | 1 | Tokeny generowane dynamicznie | P | token sesji losowy przy każdym logowaniu; PAT per użytkownik z wygasaniem | R |
| V7.2.3 | 1 | Entropia tokenów ≥ 128 bitów | P | token sesji ok. 190 bitów; PAT ≥ 256 bitów | R |
| V7.2.4 | 1 | Nowy token po uwierzytelnieniu | P | nowa sesja po logowaniu i 2FA; step-up rotuje token | T |
| V7.3.1 | 2 | Limit bezczynności | P | 7 dni (1 dzień bez „zapamiętaj mnie”) | T |
| V7.3.2 | 2 | Maksymalny czas życia | P | 30 dni od utworzenia sesji | T |
| V7.4.1 | 1 | Unieważnienie po wylogowaniu i wygaśnięciu | P | sesja usuwana w bazie; strumienie SSE zamykane ≤ 30 s | T |
| V7.4.2 | 1 | Unieważnienie przy blokadzie i usunięciu konta | P | blokada i usunięcie kasują sesje i tokeny PAT | T |
| V7.4.3 | 2 | Wylogowanie innych sesji po zmianie czynnika | P | zmiana hasła: domyślnie; zmiana TOTP i nowe kody: propozycja w UI | T |
| V7.4.4 | 2 | Widoczne wylogowanie | P | menu konta na każdym ekranie | M |
| V7.4.5 | 2 | Administrator zamyka sesje | P | `adminRevokeSession`, `adminRevokeUserSessions` | T |
| V7.5.1 | 2 | Pełne uwierzytelnienie przed zmianą atrybutów logowania | P | zmiana TOTP: hasło + kod; zmiana hasła: stare hasło; e-mail zmienia tylko admin | T |
| V7.5.2 | 2 | Przegląd i zamykanie sesji po ponownym uwierzytelnieniu | P | lista urządzeń; zamknięcie wymaga step-upu | T |
| V7.6.1 | 2 | Czas życia sesji RP/IdP | N/D | brak federacji sesji | — |
| V7.6.2 | 2 | Sesja tylko po akcji użytkownika | P | sesja wyłącznie po jawnym logowaniu | R |

#### V8 Autoryzacja — 7 wymagań (P 7, O 0, N/D 0)

| ID | L | Temat (skrót własny) | Status | Realizacja w OligInvest | Weryf. |
|---|---|---|---|---|---|
| V8.1.1 | 1 | Dokumentacja reguł dostępu | P | macierz RBAC (`moduly.md` § 6), RLS (`model-danych.md`), [`uwierzytelnianie-autoryzacja.md`](uwierzytelnianie-autoryzacja.md) § 10 | R |
| V8.1.2 | 2 | Reguły dostępu do pól | P | [`uwierzytelnianie-autoryzacja.md`](uwierzytelnianie-autoryzacja.md) § 10.2 | R |
| V8.2.1 | 1 | Dostęp do funkcji wg uprawnień | P | `x-permission` na każdej operacji; test na liście operacji z OpenAPI | T |
| V8.2.2 | 1 | Dostęp do obiektów (IDOR, BOLA) | P | RLS (FORCE) + warunki w zapytaniach; cudzy zasób → 404 | T |
| V8.2.3 | 2 | Dostęp do pól (BOPLA) | P | jawne schematy odpowiedzi, bez surowych wierszy z bazy | T |
| V8.3.1 | 1 | Autoryzacja w zaufanej warstwie | P | `api` + RLS; UI tylko ukrywa elementy | T |
| V8.4.1 | 2 | Izolacja najemców | P | każdy użytkownik to osobna przestrzeń danych (RLS, klucze cache i kanały SSE z `user_id`) | T |

#### V9 Tokeny samowystarczalne — 7 wymagań (P 0, O 0, N/D 7)

| ID | L | Temat (skrót własny) | Status | Realizacja w OligInvest | Weryf. |
|---|---|---|---|---|---|
| V9.1.1 | 1 | Podpis tokenów samowystarczalnych | N/D | brak tokenów samowystarczalnych: sesje referencyjne w bazie, `cookieCache` wyłączony | — |
| V9.1.2 | 1 | Allowlista algorytmów tokenów | N/D | brak tokenów samowystarczalnych: sesje referencyjne w bazie, `cookieCache` wyłączony | — |
| V9.1.3 | 1 | Zaufane źródła kluczy tokenów | N/D | brak tokenów samowystarczalnych: sesje referencyjne w bazie, `cookieCache` wyłączony | — |
| V9.2.1 | 1 | Okres ważności tokenu | N/D | brak tokenów samowystarczalnych: sesje referencyjne w bazie, `cookieCache` wyłączony (ważność sesji — V7) | — |
| V9.2.2 | 2 | Typ i przeznaczenie tokenu | N/D | brak tokenów samowystarczalnych: sesje referencyjne w bazie, `cookieCache` wyłączony | — |
| V9.2.3 | 2 | Odbiorca tokenu | N/D | brak tokenów samowystarczalnych: sesje referencyjne w bazie, `cookieCache` wyłączony | — |
| V9.2.4 | 2 | Ograniczenie odbiorców przy wspólnym kluczu | N/D | brak tokenów samowystarczalnych: sesje referencyjne w bazie, `cookieCache` wyłączony; tokeny VAPID dla usług push tylko wystawiamy | — |

#### V10 OAuth i OIDC — 29 wymagań (P 8, O 0, N/D 21)

| ID | L | Temat (skrót własny) | Status | Realizacja w OligInvest | Weryf. |
|---|---|---|---|---|---|
| V10.1.1 | 2 | Tokeny tylko tam, gdzie potrzebne | P | (P2) tokeny dostawców OAuth zostają zaszyfrowane w `api`, nigdy w przeglądarce, i nie są używane po zalogowaniu | R |
| V10.1.2 | 2 | Wiązanie odpowiedzi z sesją przeglądarki | P | (P2) `state` i PKCE Better Auth w ciasteczku związanym z przeglądarką | T |
| V10.2.1 | 2 | CSRF w przepływie kodu | P | (P2) PKCE + `state` | T |
| V10.2.2 | 2 | Pomylenie serwerów autoryzacji (mix-up) | P | (P2) osobny adres zwrotny per dostawca i `state` przypisany do dostawcy | R |
| V10.3.1 | 2 | Serwer zasobów — odbiorca tokenu | N/D | api nie przyjmuje tokenów OAuth; PAT to własne tokeny (V7) | — |
| V10.3.2 | 2 | Serwer zasobów — decyzje wg roszczeń | N/D | api nie przyjmuje tokenów OAuth; PAT to własne tokeny (V7) | — |
| V10.3.3 | 2 | Serwer zasobów — identyfikacja użytkownika | N/D | api nie przyjmuje tokenów OAuth; PAT to własne tokeny (V7) | — |
| V10.3.4 | 2 | Serwer zasobów — siła uwierzytelnienia | N/D | api nie przyjmuje tokenów OAuth; PAT to własne tokeny (V7) | — |
| V10.4.1 | 1 | Serwer autoryzacji — adresy zwrotne | N/D | OligInvest nie jest serwerem autoryzacji OAuth | — |
| V10.4.2 | 1 | Serwer autoryzacji — jednorazowy kod | N/D | OligInvest nie jest serwerem autoryzacji OAuth | — |
| V10.4.3 | 1 | Serwer autoryzacji — czas życia kodu | N/D | OligInvest nie jest serwerem autoryzacji OAuth | — |
| V10.4.4 | 1 | Serwer autoryzacji — dozwolone granty | N/D | OligInvest nie jest serwerem autoryzacji OAuth | — |
| V10.4.5 | 1 | Serwer autoryzacji — powtórka refresh tokenów | N/D | OligInvest nie jest serwerem autoryzacji OAuth | — |
| V10.4.6 | 2 | Serwer autoryzacji — wymóg PKCE | N/D | OligInvest nie jest serwerem autoryzacji OAuth | — |
| V10.4.7 | 2 | Serwer autoryzacji — dynamiczna rejestracja | N/D | OligInvest nie jest serwerem autoryzacji OAuth | — |
| V10.4.8 | 2 | Serwer autoryzacji — wygasanie refresh tokenów | N/D | OligInvest nie jest serwerem autoryzacji OAuth | — |
| V10.4.9 | 2 | Serwer autoryzacji — odwoływanie tokenów | N/D | OligInvest nie jest serwerem autoryzacji OAuth | — |
| V10.4.10 | 2 | Serwer autoryzacji — uwierzytelnienie klienta | N/D | OligInvest nie jest serwerem autoryzacji OAuth | — |
| V10.4.11 | 2 | Serwer autoryzacji — zakresy klienta | N/D | OligInvest nie jest serwerem autoryzacji OAuth | — |
| V10.5.1 | 2 | Powtórka ID Token (nonce) | P | (P2) OIDC Google z `nonce` — potwierdzenie w spiku OAuth (Z-04) | T |
| V10.5.2 | 2 | Identyfikacja użytkownika po `sub` | P | (P2) `accountId` = `sub` w obrębie dostawcy | R |
| V10.5.3 | 2 | Podrobione metadane serwera | P | (P2) stałe adresy dostawców w konfiguracji, bez dynamicznego discovery sterowanego z zewnątrz | R |
| V10.5.4 | 2 | `aud` = `client_id` | P | (P2) walidacja biblioteki | T |
| V10.5.5 | 2 | Wylogowanie back-channel | N/D | nie używamy wylogowania back-channel | — |
| V10.6.1 | 2 | Dostawca OpenID — tryby odpowiedzi | N/D | OligInvest nie jest dostawcą OpenID | — |
| V10.6.2 | 2 | Dostawca OpenID — wymuszone wylogowanie | N/D | OligInvest nie jest dostawcą OpenID | — |
| V10.7.1 | 2 | Zgoda na każde żądanie autoryzacji | N/D | OligInvest nie jest serwerem autoryzacji OAuth | — |
| V10.7.2 | 2 | Czytelna informacja przy zgodzie | N/D | OligInvest nie jest serwerem autoryzacji OAuth | — |
| V10.7.3 | 2 | Przegląd i odwołanie zgód | N/D | OligInvest nie jest serwerem autoryzacji OAuth | — |

#### V11 Kryptografia — 14 wymagań (P 12, O 2, N/D 0)

| ID | L | Temat (skrót własny) | Status | Realizacja w OligInvest | Weryf. |
|---|---|---|---|---|---|
| V11.1.1 | 2 | Polityka zarządzania kluczami | P | § 1 (inwentarz, cykl życia, rotacja, kto ma dostęp) | R |
| V11.1.2 | 2 | Inwentarz kryptograficzny | P | § 1.1 | R |
| V11.2.1 | 2 | Sprawdzone implementacje | P | Web Crypto i `crypto` Node, @noble/ciphers (Better Auth), @node-rs/argon2, kryptografia Go (Caddy), WireGuard, restic | R |
| V11.2.2 | 2 | Zwinność kryptograficzna | P | koperta z numerem klucza (`$ba$<wersja>$`), parametry Argon2 w skrócie (ponowne haszowanie przy logowaniu), wersjonowane sekrety | R |
| V11.2.3 | 2 | ≥ 128 bitów bezpieczeństwa | P | AES-256, XChaCha20, ECDSA P-256, X25519, SHA-256 | R |
| V11.3.1 | 1 | Brak ECB i słabych dopełnień | P | brak trybu ECB i PKCS#1 v1.5 w kodzie aplikacji | R |
| V11.3.2 | 1 | Zatwierdzone szyfry i tryby | **O** | aplikacja: XChaCha20-Poly1305; lokalne repozytorium pgBackRest obsługuje tylko AES-256-CBC — O-03 | R |
| V11.3.3 | 2 | Ochrona przed modyfikacją szyfrogramu | **O** | jw.: lokalny CBC bez MAC; integralność kopii sprawdzana `pgbackrest verify` i testem odtworzenia — O-03 | T |
| V11.4.1 | 1 | Zatwierdzone funkcje skrótu | P | SHA-256 i HMAC-SHA-256; SHA-1 tylko tam, gdzie wymaga protokół (TOTP RFC 6238, prefiks HIBP), nie do podpisów | R |
| V11.4.2 | 2 | Funkcja haszująca hasła | P | Argon2id m = 19 MiB, t = 2, p = 1 | T |
| V11.4.3 | 2 | Odporność skrótów na kolizje | P | SHA-256 dla podpisów, HMAC i skrótów tokenów | R |
| V11.4.4 | 2 | KDF przy kluczach z haseł | P | restic wyprowadza klucz scryptem; hasła repozytoriów losowe i długie; klucze aplikacji nie pochodzą z haseł | R |
| V11.5.1 | 2 | Losowość ≥ 128 bitów z CSPRNG | P | tokeny zaproszeń, resetu, PAT i sesji; UUIDv7 nigdy nie jest sekretem (np. `connectionId` wymaga autoryzacji) | R |
| V11.6.1 | 2 | Zatwierdzone algorytmy klucza publicznego | P | ECDSA P-256 (certyfikaty, VAPID), X25519 (WireGuard), Ed25519 (SSH) | R |

#### V12 Bezpieczna komunikacja — 9 wymagań (P 5, O 3, N/D 1)

| ID | L | Temat (skrót własny) | Status | Realizacja w OligInvest | Weryf. |
|---|---|---|---|---|---|
| V12.1.1 | 1 | Tylko aktualne wersje TLS | P | wyłącznie TLS 1.3 (Caddy) | S |
| V12.1.2 | 2 | Zalecane zestawy szyfrów | P | TLS 1.3 — wyłącznie AEAD z poufnością przyszłą | S |
| V12.1.3 | 2 | Certyfikaty klientów mTLS | N/D | brak mTLS | — |
| V12.2.1 | 1 | TLS do usług zewnętrznych bez obniżania | P | HTTPS do dostawców, SMTP z wymuszonym TLS, bez powrotu do połączeń jawnych | T |
| V12.2.2 | 1 | Publicznie zaufane certyfikaty | P | Let's Encrypt (ACME TLS-ALPN-01) | S |
| V12.3.1 | 2 | Szyfrowanie wszystkich połączeń | **O** | poza VM: TLS lub WireGuard; wewnątrz VM (sieci Dockera) bez TLS — O-04 | R |
| V12.3.2 | 2 | Walidacja certyfikatów przez klientów | P | domyślna walidacja Node i Pythona; zakaz wyłączania weryfikacji (lint, test) | T |
| V12.3.3 | 2 | TLS między wewnętrznymi usługami HTTP | **O** | `caddy → web/api` i `web → api` w sieci Dockera bez TLS — O-04 | R |
| V12.3.4 | 2 | Zaufane certyfikaty wewnętrzne | **O** | brak TLS wewnątrz VM — O-04 | R |

#### V13 Konfiguracja — 13 wymagań (P 11, O 2, N/D 0)

| ID | L | Temat (skrót własny) | Status | Realizacja w OligInvest | Weryf. |
|---|---|---|---|---|---|
| V13.1.1 | 2 | Dokumentacja komunikacji | P | [`../07-wdrozenie/infrastruktura.md`](../07-wdrozenie/infrastruktura.md) § 3 (przepływy sieciowe) + allowlista hostów adapterów | R |
| V13.2.1 | 2 | Uwierzytelnienie komunikacji backendu | **O** | osobne konta usług (role PostgreSQL, użytkownicy ACL Valkey), ale z hasłami — O-05 | R |
| V13.2.2 | 2 | Najmniejsze uprawnienia kont usług | P | role `app`, `auth`, `analytics_ro`, `backup`; ACL Valkey per usługa | T |
| V13.2.3 | 2 | Brak domyślnych poświadczeń | P | hasła generowane przy instalacji; wyłączony użytkownik `default` w Valkey | T |
| V13.2.4 | 2 | Allowlista zasobów zewnętrznych | P | allowlista hostów w `packages/data-providers`; sieci `web` i `analytics` bez wyjścia do internetu | T |
| V13.2.5 | 2 | Serwer z allowlistą celów | P | jw. + push tylko do hostów usług push, SMTP tylko do Brevo | T |
| V13.3.1 | 2 | Zarządzanie sekretami | **O** | pliki sekretów Compose (`/run/secrets`), `root:root 0600`, poza repozytorium i obrazami, bez sejfu — O-06 | R |
| V13.3.2 | 2 | Najmniejszy dostęp do sekretów | P | każdy kontener montuje tylko własne sekrety | R |
| V13.4.1 | 1 | Brak metadanych repozytorium | P | obrazy bez `.git` (`.dockerignore`) | S |
| V13.4.2 | 2 | Brak trybów debugowania | P | `NODE_ENV=production`, bez map źródeł w przeglądarce, bez tras debugowych | S |
| V13.4.3 | 2 | Brak listowania katalogów | P | Caddy bez `browse`; Next.js nie listuje katalogów | S |
| V13.4.4 | 2 | Brak metody TRACE | P | Caddy i Node odrzucają TRACE | S |
| V13.4.5 | 2 | Dokumentacja i monitoring niewystawione | P | `/api/v1/openapi.json` celowo publiczny (kopia z repozytorium); metryki `/internal/*` tylko w sieci wewnętrznej; UI Uptime Kuma tylko przez WireGuard | S |

#### V14 Ochrona danych — 9 wymagań (P 8, O 1, N/D 0)

| ID | L | Temat (skrót własny) | Status | Realizacja w OligInvest | Weryf. |
|---|---|---|---|---|---|
| V14.1.1 | 2 | Klasyfikacja danych wrażliwych | P | § 1.2 | R |
| V14.1.2 | 2 | Wymagania ochrony dla poziomów | P | § 1.2 | R |
| V14.2.1 | 1 | Dane wrażliwe poza URL | P | tokeny we fragmencie adresu i w treści; PAT tylko w nagłówku | T |
| V14.2.2 | 2 | Brak cache danych wrażliwych w serwerze | P | Caddy bez cache; `valkey-cache` z kluczami per użytkownik i krótkim TTL, bez danych uwierzytelniania | R |
| V14.2.3 | 2 | Brak wysyłki do nieufnych stron | P | brak trackerów i analityki zewnętrznej (NFR-11.01); e-mail i push bez kwot | S |
| V14.2.4 | 2 | Kontrole wg poziomu ochrony | P | § 1.2 i [`prywatnosc-rodo.md`](prywatnosc-rodo.md) | R |
| V14.3.1 | 1 | Czyszczenie danych w przeglądarce | P | `Clear-Site-Data` + czyszczenie po stronie klienta, także offline | T |
| V14.3.2 | 2 | `Cache-Control: no-store` | P | dane użytkownika zawsze `no-store` (konwencje API § 8) | S |
| V14.3.3 | 2 | Brak danych wrażliwych w pamięci przeglądarki | **O** | migawka offline (FR-09.02) tylko na żądanie użytkownika — O-07 | T |

#### V15 Bezpieczne programowanie i architektura — 13 wymagań (P 13, O 0, N/D 0)

| ID | L | Temat (skrót własny) | Status | Realizacja w OligInvest | Weryf. |
|---|---|---|---|---|---|
| V15.1.1 | 1 | Terminy usuwania podatności | P | § 4.2 | R |
| V15.1.2 | 2 | SBOM i zaufane repozytoria | P | syft (CycloneDX) dla każdego obrazu; npm, PyPI i jeden tarball SheetJS z sumą kontrolną w lockfile | S |
| V15.1.3 | 2 | Dokumentacja funkcji zasobożernych | P | analizy (Z-19), import, eksport, backtest — kolejki, limity, czasy | R |
| V15.2.1 | 1 | Komponenty w terminach aktualizacji | P | osv-scanner blokuje scalenie; Renovate | S |
| V15.2.2 | 2 | Ochrona dostępności przed kosztownymi funkcjami | P | kolejki ze współbieżnością 1, limity czasu i pamięci, kwoty dzienne | T |
| V15.2.3 | 2 | Brak funkcji testowych w produkcji | P | obrazy bez zależności deweloperskich, fixtures i seedów; tryb demo to funkcja produktu | S |
| V15.3.1 | 1 | Tylko potrzebne pola w odpowiedziach | P | jawne schematy odpowiedzi | T |
| V15.3.2 | 2 | Bez podążania za przekierowaniami | P | klient HTTP adapterów nie podąża za przekierowaniami (poza jawną listą) | T |
| V15.3.3 | 2 | Mass assignment | P | Zod `.strict()` + jawne mapowanie pól wejścia na kolumny | T |
| V15.3.4 | 2 | Prawdziwy adres IP klienta | P | protokół PROXY (VPS → Caddy), `X-Forwarded-For` ustawia Caddy, `api` ufa tylko Caddy | T |
| V15.3.5 | 2 | Typy i ścisłe porównania | P | TypeScript `strict`, Biome (zakaz `==`), Zod | T |
| V15.3.6 | 2 | Prototype pollution | P | `Map`/`Object.create(null)` dla danych dynamicznych; brak głębokiego scalania danych wejściowych; Zod odrzuca nieznane klucze | T |
| V15.3.7 | 2 | HTTP parameter pollution | P | parametry z jednego źródła; wielowartościowe tylko jako zadeklarowane tablice | T |

#### V16 Logowanie i obsługa błędów — 16 wymagań (P 15, O 1, N/D 0)

| ID | L | Temat (skrót własny) | Status | Realizacja w OligInvest | Weryf. |
|---|---|---|---|---|---|
| V16.1.1 | 2 | Inwentarz logów | P | § 5.1 | R |
| V16.2.1 | 2 | Metadane zdarzeń | P | `ts`, `request_id`, `user_id`, `actor_type`, `ip`, `route`, `outcome` | T |
| V16.2.2 | 2 | Synchronizacja czasu, UTC | P | chrony na VM i VPS; znaczniki czasu UTC z `Z` | S |
| V16.2.3 | 2 | Logi tylko do udokumentowanych miejsc | P | wg inwentarza § 5.1; brak zewnętrznych usług logów | R |
| V16.2.4 | 2 | Wspólny format | P | JSON (pino, structlog, Caddy) ze wspólnymi nazwami pól | T |
| V16.2.5 | 2 | Dane wrażliwe w logach | P | redakcja: hasła, kody, tokeny, ciasteczka, kwoty, treść plików (§ 5.4) | T |
| V16.3.1 | 2 | Logowanie operacji uwierzytelniania | P | logowanie, 2FA, kody zapasowe, reset, step-up — sukces i porażka w `audit_log` | T |
| V16.3.2 | 2 | Logowanie nieudanych autoryzacji | P | 401, 403 i 404 dla cudzego zasobu z trasą i użytkownikiem | T |
| V16.3.3 | 2 | Zdarzenia bezpieczeństwa i próby obejścia | P | katalog § 5.2 (walidacja, limity, bramki) | T |
| V16.3.4 | 2 | Nieoczekiwane błędy i awarie kontroli | P | 5xx, błędy TLS do dostawców, naruszenia RLS (kod 42501) → log i alert | T |
| V16.4.1 | 2 | Wstrzyknięcia do logów | P | serializacja JSON escapuje znaki sterujące | T |
| V16.4.2 | 2 | Ochrona logów przed dostępem i zmianą | P | logi kontenerów tylko dla roota; `audit_log` append-only | R |
| V16.4.3 | 2 | Logi na osobnym systemie | **O** | alerty CrowdSec na VPS, audyt kopiowany ciągle (WAL) i co godzinę poza dom; logi kontenerów tylko lokalnie — O-08 | R |
| V16.5.1 | 2 | Ogólne komunikaty błędów | P | Problem Details bez stosu i szczegółów; `instance` do korelacji | T |
| V16.5.2 | 2 | Bezpieczna praca przy awarii zasobów zewnętrznych | P | circuit breaker, flaga `stale`, degradacja do EOD (NFR-09.02) | T |
| V16.5.3 | 2 | Brak „fail-open” | P | błąd walidacji lub autoryzacji przerywa operację; transakcje wycofywane; bramki domyślnie zamknięte | T |

#### V17 WebRTC — 7 wymagań (P 0, O 0, N/D 7)

| ID | L | Temat (skrót własny) | Status | Realizacja w OligInvest | Weryf. |
|---|---|---|---|---|---|
| V17.1.1 | 2 | TURN — adresy specjalne | N/D | brak WebRTC | — |
| V17.2.1 | 2 | Klucz certyfikatu DTLS | N/D | brak WebRTC | — |
| V17.2.2 | 2 | Zestawy DTLS-SRTP | N/D | brak WebRTC | — |
| V17.2.3 | 2 | Uwierzytelnienie SRTP | N/D | brak WebRTC | — |
| V17.2.4 | 2 | Odporność na błędne pakiety SRTP | N/D | brak WebRTC | — |
| V17.3.1 | 2 | Sygnalizacja — zalewanie | N/D | brak WebRTC | — |
| V17.3.2 | 2 | Sygnalizacja — błędne wiadomości | N/D | brak WebRTC | — |
<!-- ASVS-TABLE:END -->

## 8. Odstępstwa (Z-28)

| ID | Wymagania | Odstępstwo | Dlaczego | Środki kompensujące | Warunek powrotu |
|---|---|---|---|---|---|
| O-01 | ASVS V3.3.3 | Ciasteczko sesji może zostać z przedrostkiem `__Secure-` zamiast `__Host-` | Better Auth dokleja `__Secure-`; `__Host-` wymaga obejścia konfiguracji ([`uwierzytelnianie-autoryzacja.md`](uwierzytelnianie-autoryzacja.md) § 4.1) | ciasteczko bez `Domain` i z `Path=/`; nowa sesja po każdym logowaniu; brak innych aplikacji pod `invest.oligi.pl` | odstępstwo zamknięte, jeśli spike w M0 potwierdzi obejście testem e2e |
| O-02 | ASVS V6.5.2 | Kody zapasowe szyfrowane (XChaCha20-Poly1305), nie haszowane | biblioteka weryfikuje kody przez odszyfrowanie listy; własny magazyn wymagałby rozwidlenia wtyczki | klucz spoza bazy (`BETTER_AUTH_SECRETS`), zużycie atomowe, blokada po 5 próbach, sam wyciek bazy nie ujawnia kodów | wtyczka zacznie wspierać skróty lub przejdziemy na passkeys jako czynnik zapasowy |
| O-03 | ASVS V11.3.2, V11.3.3 | Lokalne repozytorium pgBackRest szyfrowane AES-256-CBC bez MAC | pgBackRest obsługuje tylko ten szyfr | repozytorium lokalne w domu (atakujący z zapisem do niego ma już dostęp do bazy); kopia poza domem przez restic z szyfrowaniem uwierzytelnionym; `pgbackrest verify` i comiesięczny test odtworzenia | zmiana narzędzia lub wsparcie AEAD w pgBackRest |
| O-04 | ASVS V12.3.1, V12.3.3, V12.3.4 | Brak TLS między kontenerami wewnątrz VM (Caddy → web/api, api → PostgreSQL/Valkey) | ruch nie opuszcza jądra jednej VM; wewnętrzny urząd certyfikacji i TLS w PostgreSQL, Valkey i Node to znaczący koszt przy niewielkiej korzyści | sieci Dockera `internal` bez dostępu z zewnątrz, kontenery bez `CAP_NET_RAW` i bez roota, zapora VM, ruch poza VM zawsze TLS lub WireGuard | rozdzielenie komponentów na różne hosty lub VM |
| O-05 | ASVS V13.2.1 | Konta usług w bazie i Valkey uwierzytelniane hasłami | brak infrastruktury krótkotrwałych poświadczeń (sejf, certyfikaty klienta) za 0 zł | osobne konto per usługa z minimalnymi uprawnieniami, hasła losowe ≥ 256 bitów, sieć tylko wewnętrzna, rotacja raz w roku | wdrożenie TLS z certyfikatami klienta (O-04) |
| O-06 | ASVS V13.3.1 | Sekrety w plikach Compose zamiast sejfu | jeden host, jeden administrator; sejf (np. Vault, OpenBao) zwiększa złożoność i zużycie pamięci | pliki `root:root 0600` poza repozytorium i obrazami, montowane tylko do właściwego kontenera, kopia depozytowa w menedżerze haseł, rotacja wg § 1.1 | więcej hostów lub administratorów |
| O-07 | ASVS V14.3.3 | Migawka portfela w IndexedDB (FR-09.02) | funkcja wymagana przez specyfikację (podgląd bez sieci) | wyłącznie w zainstalowanej aplikacji i na wyraźne żądanie, zakres minimalny, 30 dni, kasowanie przy wylogowaniu i `401`, blokada urządzenia jako założenie | rezygnacja z funkcji lub szyfrowanie migawki kluczem odblokowywanym passkeyem |
| O-08 | ASVS V16.4.3 | Logi kontenerów przechowywane tylko w VM | centralny system logów (np. Loki) przekracza budżet pamięci | zdarzenia bezpieczeństwa w audycie kopiowanym ciągle (WAL) i co godzinę poza dom w repozytorium append-only; alerty CrowdSec na VPS; alerty e-mail | większy budżet zasobów |
| O-09 | NIST SP 800-63B-4 (dokumentowane wg ASVS V7.1.1) | Sesja 7 dni bezczynności i 30 dni maksymalnie zamiast zaleceń AAL2 (≤ 1 h / ≤ 24 h) | wygoda PWA na prywatnym telefonie | TOTP przy każdym logowaniu, step-up ≤ 15 min dla działań wrażliwych, lista urządzeń i zdalne wylogowanie, e-mail o nowym urządzeniu | passkeys (FR-07.11) — odblokowanie biometrią po 1 h bezczynności |

## 9. Weryfikacja

| Kiedy | Co | Jak |
|---|---|---|
| Każdy PR | testy bezpieczeństwa (§ 7, kolumna T), lint, osv-scanner, CodeQL, skan sekretów | CI ([`../07-wdrozenie/ci-cd.md`](../07-wdrozenie/ci-cd.md)) |
| Każde wydanie | skan nagłówków i TLS na środowisku docelowym; podpis i SBOM obrazów | skrypt po wdrożeniu + SSL Labs |
| Koniec każdego etapu | przegląd nowych modułów wg STRIDE ([`model-zagrozen.md`](model-zagrozen.md)) | lista kontrolna z [`../01-architektura/moduly.md`](../01-architektura/moduly.md) § 8.1 |
| M6 (hardening) | przegląd całej tabeli § 7 z dowodami (test, konfiguracja, zrzut) i pasywny skan DAST (ZAP baseline) na lokalnej instancji | protokół przeglądu w `docs/06-bezpieczenstwo/przeglady/` |
| Raz w roku | rotacja sekretów, przegląd odstępstw § 8, ćwiczenie z [`plan-reagowania.md`](plan-reagowania.md) | kalendarz właściciela |
