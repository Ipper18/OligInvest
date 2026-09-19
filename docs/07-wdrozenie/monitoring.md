# Monitoring — health-checki, metryki, logi, alerty

**Cel:** określić, jak OligInvest sprawdza własne zdrowie i świeżość danych, jakie metryki i logi zbiera, kiedy i jak alarmuje administratora oraz co robić przy typowych awariach — w wersji lekkiej, która mieści się w budżecie zasobów VM i VPS i wykrywa także awarię całego domu (NFR-09.01, NFR-09.04, NFR-03.10).

Powiązane: [`infrastruktura.md`](infrastruktura.md), [`backup-dr.md`](backup-dr.md), [`ci-cd.md`](ci-cd.md), [`../06-bezpieczenstwo/kontrole-bezpieczenstwa.md`](../06-bezpieczenstwo/kontrole-bezpieczenstwa.md) § 5, [`../06-bezpieczenstwo/plan-reagowania.md`](../06-bezpieczenstwo/plan-reagowania.md), [`../03-dane/strategia-cache.md`](../03-dane/strategia-cache.md), [`../02-api/openapi.yaml`](../02-api/openapi.yaml) (tag `health`, trasy `/admin/*`).

## 1. Założenia i wybór narzędzi

- **Uptime Kuma 2.5 na VPS** sprawdza aplikację z zewnątrz (przez publiczną nazwę — ta sama ścieżka co użytkownik: DNS → VPS → tunel → Caddy → `api`) i przyjmuje sygnały życia z zadań w domu. Działa także wtedy, gdy dom jest niedostępny, i wysyła e-maile przez SMTP Brevo.
- **Wykresy VM w Proxmoxie** (CPU, RAM, dysk, sieć — wbudowane) zamiast osobnego stosu metryk.
- **Metryki aplikacji** w formacie Prometheus na trasach wewnętrznych i bieżący podgląd w panelu admina.
- **Bez** Prometheus/Grafana/Loki (pamięć RAM), bez Dozzle i Beszel (wymagają dostępu do gniazda Dockera, czyli uprawnień roota na hoście), bez Sentry i GlitchTip (pamięć RAM i dane błędów poza aplikacją). Opcja na później: VictoriaMetrics (jeden proces, ok. 100 MB) z wbudowanym podglądem, gdy potrzebna będzie historia metryk.

## 2. Cele poziomu usług

| Wskaźnik | Cel | Pomiar |
|---|---|---|
| Dostępność aplikacji | ≥ 99 % miesięcznie (ok. 7 h 18 min przerwy na miesiąc) | sonda Uptime Kuma co 60 s; raport miesięczny |
| Czas odpowiedzi odczytów API | p95 < 300 ms (NFR-01.05) | histogram w `api` |
| Opóźnienie SSE | < 2 s od zapisu (NFR-01.06) | metryka `jobs` → `api` |
| Świeżość EOD GPW | dane sesji w bazie do 19:30 w dni sesyjne | sygnał życia zadania `market.gpw-eod` |
| Świeżość kursów NBP | tabela A dnia w bazie do 14:00 w dni robocze | sygnał życia zadania FX |
| RPO bazy | archiwum WAL opóźnione ≤ 15 min lokalnie, kopia poza domem ≤ 1 h | sygnały życia kopii ([`backup-dr.md`](backup-dr.md)) |

Przerwy planowane (okno nocne) liczą się do niedostępności — raport pokazuje je osobno.

## 3. Sondy i sygnały życia (Uptime Kuma)

| Monitor | Typ | Cel lub źródło | Interwał | Alert |
|---|---|---|---|---|
| `app-ready` | HTTP(S) | `https://invest.oligi.pl/api/v1/health/ready` — status 200 i `"status":"ok"` | 60 s | 3 kolejne porażki |
| `app-login-page` | HTTP(S) + słowo kluczowe | strona `/logowanie` | 5 min | 2 porażki |
| `app-certificate` | ważność certyfikatu (funkcja monitora HTTPS) | `invest.oligi.pl` | codziennie | < 14 dni |
| `vm-health` | sygnał życia (push) | skrypt w VM: dysk, RAM, kontenery zdrowe, odchyłka zegara | 5 min | brak 15 min lub status `down` |
| `jobs-scheduler` | push | pętla harmonogramu w `jobs` | 5 min | brak 15 min |
| `wal-archive` | push | skrypt: wiek ostatniego zarchiwizowanego segmentu WAL | 5 min | brak 15 min lub wiek > 15 min |
| `backup-local` | push | pgBackRest: kopia dzienna + `check` | 24 h | brak 26 h |
| `backup-offsite` | push | restic → rest-server na VPS | 1 h | brak 3 h |
| `restore-test` | push | comiesięczny automatyczny test odtworzenia | 30 dni | brak 32 dni lub błąd |
| `eod-gpw` | push | zadanie EOD GPW po zapisie sesji | dni sesyjne | brak do 19:30 |
| `fx-nbp` | push | zadanie kursów NBP | dni robocze | brak do 14:00 |
| `ct-check` | push | skrypt: certyfikaty dla `invest.oligi.pl` i wildcard `*.oligi.pl` w crt.sh porównane z listą znanych numerów seryjnych | 24 h | brak 26 h lub nieznany certyfikat |
| `crowdsec-agent` | push | stan agenta w VM i połączenie z LAPI | 1 h | brak 3 h |

Adresy monitorów push zawierają tokeny — są sekretami ([`infrastruktura.md`](infrastruktura.md) § 8). Kuma nasłuchuje wyłącznie na adresie tunelu i sieci administracyjnej.

## 4. Health-checki usług

| Usługa | Sonda | Znaczenie |
|---|---|---|
| `api` | `GET /api/v1/health/live` (proces), `GET /api/v1/health/ready` (PostgreSQL, `valkey-queue`, `valkey-cache`) | publiczne, bez szczegółów wewnętrznych |
| `web` | wewnętrzna trasa zdrowia Next.js | tylko sieć `edge` |
| `jobs`, `analytics` | polecenie w kontenerze: połączenie z Valkey i wiek ostatniego obiegu pętli | `healthcheck` Dockera |
| `postgres` | `pg_isready` | `healthcheck` Dockera |
| `valkey-*` | `PING` (użytkownik ACL tylko do tej komendy) | `healthcheck` Dockera |
| `caddy` | port 443 odpowiada | `healthcheck` Dockera |

Szczegóły (wersje, zasoby) pokazuje wyłącznie panel admina (`/admin/system/health`, FR-08.08).

## 5. Metryki aplikacji

`api` i `jobs` wystawiają metryki w formacie Prometheus na `/internal/metrics` — trasa dostępna tylko w sieci wewnętrznej Dockera (nie przez Caddy). Panel admina pokazuje wartości bieżące i p95 z okna 15 minut liczone w procesie.

| Metryka | Etykiety | Po co |
|---|---|---|
| `http_requests_total` | trasa (wzorzec), metoda, status | błędy 5xx, 4xx |
| `http_request_duration_seconds` (histogram) | trasa, metoda | p95 < 300 ms |
| `sse_connections` | — | limity i obciążenie |
| `auth_events_total` | typ, wynik | nieudane logowania, blokady |
| `rate_limit_rejections_total` | grupa limitu | nadużycia |
| `queue_jobs` | kolejka, stan | zaległości i zadania nieudane |
| `job_duration_seconds` (histogram) | kolejka, typ zadania | analizy, importy |
| `provider_requests_total` | dostawca, wynik | awarie dostawców |
| `provider_quota_remaining` | dostawca, okno | planowanie kwot ([`../03-dane/strategia-cache.md`](../03-dane/strategia-cache.md)) |
| `provider_circuit_open` | dostawca | degradacja |
| `data_quality_issues_open` | waga | jakość danych rynkowych |
| `db_pool_in_use`, `valkey_used_memory_bytes` | instancja | zasoby |

Etykiety nigdy nie zawierają identyfikatorów użytkowników ani instrumentów z portfeli (NFR-03.05). Historia zasobów VM — wykresy Proxmoxa; historia wydajności z przeglądarek — RUM w bazie (90 dni, tylko przy zgodzie użytkownika).

## 6. Logi i błędy

- **Inwentarz, retencja i redakcja:** [`../06-bezpieczenstwo/kontrole-bezpieczenstwa.md`](../06-bezpieczenstwo/kontrole-bezpieczenstwa.md) § 5.1 i § 5.4.
- **Format:** JSON, jedna linia na zdarzenie; wspólne pola: `ts` (UTC), `level`, `service`, `msg`, `request_id`, `user_id` (UUID lub brak), `route`, `status`, `duration_ms`, `job_id`, `queue`, `provider`, `err.code`. Ten sam `request_id` w odpowiedzi (`X-Request-Id`), w logach, w zadaniach i w polu `instance` błędu.
- **Dostęp:** przez SSH w sieci administracyjnej (`docker compose logs`, `journalctl`); bez interfejsu webowego do logów.
- **Błędy zamiast Sentry:** każdy błąd 5xx i nieobsłużony wyjątek w zadaniu ma wpis z `request_id` lub `job_id` i skrótem stosu (tylko w logu, nigdy w odpowiedzi); `jobs` wysyła administratorowi **dzienny raport błędów** (liczba wg trasy lub typu zadania i kodu błędu, przykładowe identyfikatory żądań — bez danych użytkowników). Błędy z przeglądarek — opcja P3, tylko przy zgodzie na diagnostykę.

## 7. Alerty

| Warunek | Waga | Kanał | Postępowanie |
|---|---|---|---|
| `app-ready` niedostępne | krytyczny | e-mail (Kuma) | R1 |
| Naruszenie RLS, nieznany certyfikat w CT, reguły z [`kontrole-bezpieczenstwa.md`](../06-bezpieczenstwo/kontrole-bezpieczenstwa.md) § 5.3 | krytyczny | e-mail + push do administratora | [`plan-reagowania.md`](../06-bezpieczenstwo/plan-reagowania.md) |
| Archiwum WAL opóźnione > 15 min, brak kopii lokalnej > 26 h, test odtworzenia nieudany | krytyczny | e-mail | R2, [`backup-dr.md`](backup-dr.md) |
| Kontener niezdrowy > 5 min, zabity przez brak pamięci | krytyczny | e-mail | R3 |
| Odchyłka zegara > 2 s | krytyczny (TOTP) | e-mail | R4 |
| `valkey-queue` > 80 % limitu pamięci | krytyczny (przy `noeviction` zapisy zadań zaczną się nie udawać) | e-mail | R5 |
| Dysk VM, HDD kopii lub VPS > 80 % (> 90 % — krytyczny) | ostrzeżenie | e-mail | R6 |
| Kopia poza domem brak > 3 h | ostrzeżenie | e-mail | [`backup-dr.md`](backup-dr.md) |
| Certyfikat ważny < 14 dni | ostrzeżenie | e-mail | R7 |
| Błędy 5xx > 2 % żądań w 10 min | ostrzeżenie | e-mail | R8 |
| p95 odczytów > 300 ms przez 30 min | ostrzeżenie | e-mail | R8 |
| Zadania nieudane w `import`, `notify`, `analytics-results` lub > 100 oczekujących przez 15 min | ostrzeżenie | e-mail + panel `/admin/kolejki` | R9 |
| Brak EOD GPW do 19:30, brak kursów NBP do 14:00, dostawca z otwartym obwodem > 1 h | ostrzeżenie | e-mail | R10 |
| Problemy jakości danych o wadze BLOCK | ostrzeżenie | panel `/admin/dane-rynkowe` + e-mail | [`plan-reagowania.md`](../06-bezpieczenstwo/plan-reagowania.md) P11 |
| Wysyłka e-mail > 80 % dziennego limitu Brevo | ostrzeżenie | panel + e-mail | R11 |
| Dzienny raport błędów, pozostałe kwoty dostawców | informacja | e-mail raz dziennie | — |

**Zasady:** ostrzeżenia tylko w godzinach 7–22 (poza krytycznymi), grupowanie alertów tego samego rodzaju (1 e-mail na 30 min), każdy alert zawiera link do panelu lub runbooka; alerty krytyczne dotyczące kopii i bezpieczeństwa także w cichych godzinach. Rezerwa limitu e-maili Brevo na alerty krytyczne i bezpieczeństwa (T-NT-04).

## 8. Runbooki operacyjne

| # | Objaw | Sprawdź po kolei | Działanie |
|---|---|---|---|
| R1 | Aplikacja niedostępna | szczegóły monitora (DNS / TLS / timeout / 5xx) → VPS (nginx, WireGuard) → tunel (handshake) → VM (zasilanie, sieć) → `docker compose ps` → `health/ready` → logi `api` | naprawa warstwy, która zawiodła; przy dłuższej awarii domu — komunikat dla użytkowników; > 4 h → [`backup-dr.md`](backup-dr.md) scenariusze |
| R2 | Problem z kopiami | log timera kopii, `pgbackrest check`, miejsce na HDD, łączność z rest-server | ręczna kopia po naprawie; brak kopii > 26 h to incydent SEV2 |
| R3 | Kontener niezdrowy lub OOM | `docker compose ps`, logi kontenera, pamięć VM | restart usługi; przy powtarzalnym OOM — podniesienie limitu lub naprawa wycieku (zgłoszenie w backlogu) |
| R4 | Odchyłka zegara | `chronyc tracking`, źródła NTP | naprawa synchronizacji; do tego czasu logowanie TOTP może zawodzić |
| R5 | `valkey-queue` blisko limitu | liczba zadań per kolejka, zadania zakończone nieusunięte | czyszczenie zakończonych zadań, wstrzymanie kolejek generujących zadania, podniesienie limitu |
| R6 | Pełny dysk | wolumeny, logi, obrazy Dockera, repozytorium kopii | usunięcie starych obrazów, sprawdzenie retencji logów i kopii |
| R7 | Certyfikat nie odnawia się | logi Caddy (ACME), rekord CAA, routing SNI na VPS | naprawa przyczyny; ręczne wymuszenie odnowienia |
| R8 | Błędy 5xx lub wolne odpowiedzi | panel metryk (trasy), logi z `request_id`, obciążenie bazy, zadania analityczne | wyłączenie flagą funkcji, która szkodzi; poprawka |
| R9 | Zaległe lub nieudane zadania | panel `/admin/kolejki`, logi `jobs`/`analytics` | ponowienie po naprawie; usunięcie zadań trwale błędnych (audyt) |
| R10 | Brak danych rynkowych | panel `/admin/dostawcy`, kwoty, odpowiedzi dostawcy | aplikacja pokazuje dane jako nieaktualne (bez błędów); import ręczny notowań, jeśli przerwa się przedłuża ([ADR-005](../09-decyzje/ADR-005-strategia-danych-rynkowych.md)) |
| R11 | Limit e-maili | dziennik doręczeń, burza alertów | cooldown reguł, wstrzymanie mniej ważnych kanałów do jutra |

## 9. Raport miesięczny

Pierwszego dnia miesiąca `jobs` wysyła administratorowi podsumowanie: dostępność (Kuma), p95 odczytów, liczba błędów 5xx, stan kopii i ostatni test odtworzenia, awarie dostawców, zdarzenia bezpieczeństwa (liczby), wykorzystanie dysku. Raport służy też jako dowód spełnienia NFR-09.01 i NFR-09.03.
