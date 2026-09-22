# Konwencje API

**Cel:** ustalić jednolite zasady dla każdego endpointu OligInvest — adresy i wersjonowanie, uwierzytelnianie, formaty danych, błędy, paginację, idempotencję, limity, cache i operacje asynchroniczne — tak, aby [`openapi.yaml`](openapi.yaml) i implementacja w `api` były spójne, a klienci (przeglądarka, Skróty iOS, HTTP Shortcuts) zachowywali się przewidywalnie.

Powiązane: [`openapi.yaml`](openapi.yaml), [`realtime.md`](realtime.md), [ADR-012](../09-decyzje/ADR-012-api-jako-granica-domenowa.md), [ADR-004](../09-decyzje/ADR-004-postgres-better-auth-rls.md), [`../01-architektura/moduly.md`](../01-architektura/moduly.md).

## 1. Adresy i wersjonowanie

| Zasób | Adres | Uwagi |
|---|---|---|
| API domenowe | `https://invest.oligi.pl/api/v1/<moduł>/…` | host potwierdzony przez właściciela (Q-01); konfigurowany zmienną `PUBLIC_BASE_URL` |
| Uwierzytelnianie (Better Auth) | `/api/auth/*` | trasy biblioteki; bez wersji w ścieżce; pełny opis generuje wtyczka OpenAPI Better Auth |
| Strumień SSE | `/api/v1/stream` | [`realtime.md`](realtime.md) |
| Specyfikacja | `/api/v1/openapi.json` | generowana z Zod (`@hono/zod-openapi`); w CI porównywana z `openapi.yaml` |
| Health | `/api/v1/health/live`, `/api/v1/health/ready` | bez uwierzytelniania, bez szczegółów wewnętrznych |

**Wersjonowanie:** wersja główna w ścieżce (`/v1`). Zmiany **zgodne** (nowe pola opcjonalne, nowe endpointy, nowe wartości enum oznaczone jako rozszerzalne) wchodzą bez zmiany wersji. Zmiana **niezgodna** (usunięcie/zmiana znaczenia pola, zmiana typu, zaostrzenie walidacji) wymaga: (a) nowej wersji ścieżki albo (b) okresu przejściowego **≥ 90 dni** z nagłówkami `Deprecation` ([RFC 9745](https://www.rfc-editor.org/rfc/rfc9745.html)) i `Sunset` ([RFC 8594](https://www.rfc-editor.org/rfc/rfc8594.html)) oraz `Link: <…>; rel="deprecation"`; każda zmiana w `docs/02-api/CHANGELOG.md` (tworzony w M0). Endpointy `/api/v1/quick/*` używane przez Skróty traktujemy jako **zamrożone** — zmiany tylko addytywne (NFR-02.05).

## 2. Uwierzytelnianie i autoryzacja

| Klient | Mechanizm | Zakres |
|---|---|---|
| Przeglądarka / PWA | ciasteczko sesji Better Auth `__Host-oliginvest.session_token` (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, bez `Domain`; zapasowo przedrostek `__Secure-` — [`uwierzytelnianie-autoryzacja.md`](../06-bezpieczenstwo/uwierzytelnianie-autoryzacja.md) § 4) | wszystkie endpointy wg roli |
| Skróty iOS / HTTP Shortcuts | `Authorization: Bearer oli_pat_…` (PAT z wtyczki API key) | wyłącznie `/api/v1/quick/*`, wg zakresów tokenu (`portfolio:read`, `transactions:write`, `alerts:read`, `market:read`) |

- **Bramka MFA:** sesja użytkownika bez skonfigurowanego TOTP → `403` z kodem `MFA_ENROLLMENT_REQUIRED` na każdej trasie poza `/api/auth/two-factor/*`, `/api/auth/sign-out`, `GET /api/v1/me`.
- **Bramka regulaminu:** brak akceptacji bieżącej wersji regulaminu (FR-07.12) → `403 TERMS_ACCEPTANCE_REQUIRED` na każdej trasie poza `GET /api/v1/me`, `/api/v1/me/legal*`, `/api/v1/me/step-up`, `/api/v1/me/exports*`, `/api/v1/me/deletion-request*` i `/api/auth/sign-out` (prawa z RODO nie zależą od akceptacji zmian regulaminu); dotyczy także tokenów PAT. Kolejność: najpierw bramka MFA, potem regulaminu.
- **Step-up:** działania wrażliwe (tworzenie PAT, eksport danych, usunięcie konta, zmiany admina, nowe kody zapasowe lub zmiana urządzenia TOTP, wylogowanie innych urządzeń; samo wyłączenie 2FA jest zablokowane) wymagają weryfikacji TOTP nie starszej niż 15 min → w przeciwnym razie `403 STEP_UP_REQUIRED`; klient wywołuje `POST /api/v1/me/step-up` z kodem i ponawia żądanie. Udana weryfikacja rotuje token sesji (ASVS V7.2.4).
- **Role i uprawnienia:** macierz w `moduly.md` § 6; brak uprawnienia → `403 FORBIDDEN`; zasób innego użytkownika → `404 NOT_FOUND` (nie ujawniamy istnienia); moduł wyłączony flagą → `404 NOT_FOUND`.
- **CSRF:** ten sam origin (brak CORS); dla metod modyfikujących z ciasteczkiem `api` sprawdza nagłówek `Origin` (lub `Sec-Fetch-Site: same-origin`); żądania z PAT nie używają ciasteczek.
- **Sekrety nigdy w adresie URL:** tokeny zaproszenia i resetu hasła są we fragmencie adresu (`#t=…` — nie trafia do serwera ani nagłówka `Referer`) i przechodzą do API w treści żądania; PAT wyłącznie w nagłówku `Authorization`, parametr `?token=` jest odrzucany (ASVS V14.2.1).

## 3. Formaty danych

- `Content-Type: application/json; charset=utf-8`; nazwy pól **camelCase**; wartości enum jak w bazie (np. typy operacji `BUY`, `SELL`; statusy małymi literami `queued`, `done`).
- **Identyfikatory:** UUIDv7 jako ciąg.
- **Daty:** `YYYY-MM-DD` (daty sesji, operacji); **znaczniki czasu:** RFC 3339 w UTC z `Z` (`2026-09-18T15:42:07Z`).
- **Pieniądze:** obiekt `Money` `{"amount": "1234.56", "currency": "PLN"}` — kwota jako **ciąg** z kropką dziesiętną, maks. 8 miejsc po przecinku, bez separatorów tysięcy (ADR-014). Nigdy liczba JSON.
- **Ilości i ceny:** ciągi dziesiętne (`"0.3069"`, `"119.84"`); ceny z polem waluty.
- **Stopy, udziały, wskaźniki:** liczby JSON jako **ułamki** (`0.0084` = 0,84 %); nazwy pól bez sufiksu `Pct` (np. `dayChangeRatio`, `twr`, `weight`).
- **Serie do wizualizacji** (wykresy świecowe, wartość portfela w czasie, wachlarze percentyli): **tablice kolumnowe liczb JSON** (`{"t": [...], "c": [...]}`) zamiast ciągów — mniejszy rozmiar i szybsze parsowanie na telefonie (NFR-01). To wyjątek wyłącznie dla danych prezentacyjnych; wartości rozliczeniowe (koszty, P/L, gotówka) zawsze jako `Money`.
- **Świeżość danych:** każda odpowiedź z danymi rynkowymi lub wyceną zawiera obiekt `meta` (`DataMeta`): `source`, `asOf`, `delayMinutes`, `stale`, opcjonalnie `staleReason` (FR-01.15).
- **Pola opcjonalne** bez wartości są pomijane; `null` tylko, gdy brak wartości ma znaczenie (np. `xirr: null` = nie da się wyznaczyć).
- **Język:** komunikaty (`title`, `detail`) po polsku (`Accept-Language: pl`), kody (`code`) stabilne po angielsku.

## 4. Błędy — Problem Details ([RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html))

`Content-Type: application/problem+json`:

```json
{
  "type": "https://invest.oligi.pl/problems/validation-failed",
  "title": "Nieprawidłowe dane",
  "status": 422,
  "code": "VALIDATION_FAILED",
  "detail": "Pole quantity musi być dodatnie.",
  "instance": "req_01J8Z3Q6X4…",
  "errors": [{ "path": "quantity", "code": "too_small", "message": "Wartość musi być > 0" }]
}
```

| Status | `code` | Kiedy |
|---|---|---|
| 400 | `BAD_REQUEST` | niepoprawna składnia żądania |
| 401 | `UNAUTHENTICATED` | brak/wygasła sesja lub PAT |
| 403 | `FORBIDDEN`, `MFA_REQUIRED`, `MFA_ENROLLMENT_REQUIRED`, `TERMS_ACCEPTANCE_REQUIRED`, `STEP_UP_REQUIRED`, `PAT_SCOPE_MISSING` | brak uprawnień, brak 2FA, brak akceptacji regulaminu, wymagana świeża weryfikacja, brak zakresu tokenu |
| 404 | `NOT_FOUND` | brak zasobu, cudzy zasób, moduł wyłączony |
| 409 | `CONFLICT`, `IDEMPOTENCY_CONFLICT`, `INSTRUMENT_AMBIGUOUS`, `DUPLICATE_IMPORT` | konflikt stanu; ten sam klucz idempotencji z innym ciałem; niejednoznaczny ticker (z listą kandydatów w `candidates`) |
| 412 | `RECONCILIATION_REQUIRED` | np. rebalancing przy nieuzgodnionych danych (obliczenia-finansowe.md § 12.5) |
| 413 | `FILE_TOO_LARGE` | plik > 10 MB |
| 415 | `UNSUPPORTED_MEDIA_TYPE`, `IMPORT_FORMAT_UNKNOWN` | nieobsługiwany typ pliku lub nierozpoznany format |
| 422 | `VALIDATION_FAILED`, `PARAMETERS_OUT_OF_BOUNDS` | walidacja Zod; parametry analizy poza limitami (Z-19) |
| 429 | `RATE_LIMITED`, `QUOTA_EXCEEDED` | limit żądań; dzienny limit roli (np. ciężkich analiz) — z `Retry-After` |
| 500 | `INTERNAL` | błąd serwera (bez szczegółów; identyfikator w `instance`) |
| 503 | `SERVICE_UNAVAILABLE` | przeciążenie, prace serwisowe (z `Retry-After`) |

Dane rynkowe nieaktualne **nie są błędem** — zwracamy `200` z `meta.stale = true` (NFR-09.02).

### 4.1 Fundament obsługi błędów i korelacji (BL-006)

`withRequestContext` z `packages/platform` otacza handler standardowych `Request`/`Response`. Akceptuje `X-Request-Id` tylko jako poprawny UUID, w przeciwnym razie generuje UUID; zwraca ten sam identyfikator w nagłówku, kontekście `AsyncLocalStorage`, logu i `Problem.instance`, także dla nieobsłużonego wyjątku. Dane uwierzytelnione wprowadza osobny `withIdentity` (bez odczytu tożsamości z nagłówków klienta). `requestLogger()` wiąże logi operacji z bieżącym request_id i uwierzytelnionym user_id, nadpisując przekazane identyfikatory. Log zakończenia/błędu także zawiera uwierzytelnionego użytkownika; próba zmiany aktora w tym samym żądaniu jest odrzucana. Kontekst jest izolowany między równoległymi żądaniami. Adapter Hono i montowanie endpointów pozostają do BL-009.

Status i polski tytuł błędu wynikają z kodu kontraktu; URI typu korzysta z originu PUBLIC_BASE_URL. Nieznane wyjątki i kod INTERNAL nie ujawniają szczegółów, stosu ani przyczyny. Odpowiedzi mają `application/problem+json`, `Cache-Control: no-store`; 429/503 mają dodatni `Retry-After` (domyślnie 1 s, adapter może podać czas rzeczywistego limitu). `parseBoundary(shape, input)` tworzy obiekt Zod `.strict()`; nieznane pola są błędem 422. Zagnieżdżone obiekty w shape również deklarujemy jako strict. Komunikaty walidacji są stałe po polsku, bez wartości wejścia; ścieżka pokazuje tylko znany klucz główny, aby nie odbijać w odpowiedzi kluczy rekordów pochodzących od użytkownika. Nie publikujemy domenowych rozszerzeń Problem przed ich implementacją.

### 4.2 Szkielet HTTP i sondy (BL-009)

`apps/api` montuje adapter Hono do `withRequestContext`; wyjątki i nieznane trasy korzystają z platformowego RFC 9457. `GET /api/v1/health/live` zawsze zwraca `200 {"status":"ok"}` bez wywoływania zależności. `GET /api/v1/health/ready` równolegle wykonuje `SELECT 1` rolą `oliginvest_app` (bez odczytu danych użytkowników) oraz `AUTH` i `PING` osobno dla obu instancji Valkey. Każda sonda ma limit 1500 ms i zamyka połączenie, także po błędzie lub przekroczeniu czasu. Odpowiedź `HealthStatus` zawiera `checks.postgres`, `checks.valkeyQueue`, `checks.valkeyCache`, wyłącznie `ok`/`fail`; dowolna awaria daje 503 i `Retry-After: 1`. Sondy mają `Cache-Control: no-store`. Nie ujawniamy błędów sterowników w odpowiedzi ani logu.

Uruchomienie po buildzie: `pnpm --filter @oliginvest/api start`. Proces czyta konfigurację BL-005 (w produkcji sekrety przez `*_FILE`) i jawne niesekretne zmienne: `API_HOST`, `API_PORT`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_SSL` (`true`/`false`, domyślnie `false`), `VALKEY_QUEUE_HOST`, `VALKEY_QUEUE_PORT`, `VALKEY_QUEUE_USER`, `VALKEY_CACHE_HOST`, `VALKEY_CACHE_PORT`, `VALKEY_CACHE_USER`. W Compose dev użytkownik obu instancji Valkey to `default`, a hasła API odpowiadają lokalnym hasłom tych instancji; produkcja używa użytkowników ACL API. Brak lub błędna konfiguracja zatrzymuje start ze stałym komunikatem bez wartości zmiennych. `NODE_ENV` domyślnie `development`; w produkcji ustaw `production`. Proces nie wymaga dostępności zależności przy starcie, więc liveness działa również podczas ich awarii.

Publiczny `/api/v1/openapi.json` generuje OpenAPI 3.1 z zarejestrowanych tras Zod, z relatywnym serwerem `/api/v1` (bez adresów wewnętrznych). Dokument obejmuje na razie trzy wdrożone operacje; porównanie całego kontraktu, lista operacji oczekujących oraz lint Redocly należą do BL-010. Limity żądań pozostają poza BL-009; sonda live nie jest ograniczana.

## 5. Paginacja, sortowanie, filtrowanie

- **Kursor:** `?limit=50&cursor=<nieprzezroczysty>`; odpowiedź `{"data": [...], "page": {"nextCursor": "…", "hasMore": true}}`; `limit` domyślnie 50, maks. 200. Paginacji offsetowej nie stosujemy.
- **Sortowanie:** `?sort=-tradeDate` (minus = malejąco); dozwolone pola wymienia każdy endpoint.
- **Zakresy dat:** `from` i `to` włącznie (`YYYY-MM-DD`); brak `to` = dziś.
- **Filtry wielowartościowe:** powtarzany parametr (`?accountId=…&accountId=…`).

## 6. Idempotencja

Nagłówek `Idempotency-Key` z kluczem klienta — UUID (zalecany) lub ciąg 16–64 znaków `[A-Za-z0-9_-]`, bo Skróty iOS nie mają generatora UUID (wzorowany na [draft-ietf-httpapi-idempotency-key-header](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/)) jest **wymagany** dla: `POST /portfolio/transactions`, `POST /portfolio/imports/{id}/commit`, `POST /analytics/runs`, `POST /quick/transactions`, `POST /me/tokens`, `POST /me/exports`; opcjonalny dla pozostałych `POST`. Klucz przechowujemy 24 h per użytkownik (`platform.idempotency_keys`): ten sam klucz i to samo ciało → ta sama odpowiedź z nagłówkiem `Idempotent-Replayed: true`; ten sam klucz i inne ciało → `409 IDEMPOTENCY_CONFLICT`; żądanie w trakcie → `409 CONFLICT` z `Retry-After: 1`.

## 7. Limity żądań

| Grupa | Limit (domyślnie, konfigurowalny) | Klucz |
|---|---|---|
| Logowanie, reset hasła, weryfikacja 2FA | 5 / min i 20 / h | IP + e-mail (Better Auth) |
| Odczyty (`GET`) | 300 / min | użytkownik |
| Zapisy | 60 / min | użytkownik |
| Import plików | 20 / dzień | użytkownik |
| `/quick/*` (PAT) | 30 / min, 2 000 / dzień | token |
| Ciężkie analizy (`analytics:run:heavy`) | wg `platform.role_limits` (np. pro: 20 / dzień) | użytkownik |
| `/stream` | 5 równoczesnych połączeń | użytkownik |

Nagłówki: `RateLimit-Policy` i `RateLimit` wg [draft-ietf-httpapi-ratelimit-headers-11](https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/) (projekt, nie RFC — nazwy mogą się zmienić) oraz `Retry-After` przy `429`.

## 8. Cache i żądania warunkowe

- Dane użytkownika (portfel, operacje, analizy, alerty, `/me/*`, tokeny, eksporty): `Cache-Control: no-store` — dane finansowe nie trafiają do pamięci podręcznej przeglądarki ani pośredników (ASVS V14.3.2); świeżość zapewniają pamięć zapytań TanStack Query i zdarzenia SSE.
- Dane rynkowe (instrumenty, wykresy EOD, kursy walut): `Cache-Control: private, max-age=300` + `ETag` → `If-None-Match` → `304`.
- Service worker nigdy nie cache'uje odpowiedzi `/api/*`; migawka offline (FR-09.02) to osobny zapis w IndexedDB na wyraźne żądanie użytkownika ([`../04-frontend/architektura-ui.md`](../04-frontend/architektura-ui.md) § 8).

## 9. Operacje asynchroniczne

Operacje długie (import, analiza, eksport RODO, ręczny import notowań) zwracają `202 Accepted` z nagłówkiem `Location` wskazującym zasób statusu i ciałem zasobu (`status: queued`). Postęp i zakończenie przychodzą zdarzeniem SSE; klient bez SSE odpytuje zasób statusu nie częściej niż co 5 s.

## 10. Przesyłanie plików

`multipart/form-data`, pole `file`, maks. 10 MB, typy: XLSX, XLS, CSV (weryfikacja po sygnaturze pliku, nie po rozszerzeniu); dodatkowe pola formularza (`accountId`, `format`) walidowane jak JSON.

## 11. Odpowiedzi tekstowe dla automatyzacji

Endpointy `/api/v1/quick/*` przyjmują `?format=text|json` (domyślnie `json`). `text` zwraca `text/plain; charset=utf-8`, jedną lub kilka krótkich linii w formacie pl-PL dokładnie jak `Intl.NumberFormat('pl-PL')` (`+1234,56 zł`, `12 345,67 zł`, `-0,84%` — grupowanie tysięcy od 5 cyfr, spacja niełamiąca U+00A0, procent bez spacji, minus jako łącznik; zweryfikowane w Node 25.1 / ICU 77.1), zawsze z czasem i statusem danych; błędy również tekstowo (`Błąd: …`) z właściwym kodem HTTP.

## 12. Korelacja i obserwowalność

Każda odpowiedź ma `X-Request-Id` (przyjmujemy nagłówek klienta, jeśli poprawny UUID; inaczej generujemy); ten sam identyfikator trafia do logów, zadań w kolejkach i pola `instance` błędu.

## 13. Nagłówki bezpieczeństwa odpowiedzi API

`X-Content-Type-Options: nosniff`, `Cache-Control` wg § 8, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-origin`; brak nagłówków CORS (tylko ten sam origin); `Clear-Site-Data` przy wylogowaniu. Pozostałe nagłówki (HSTS, CSP) ustawia `caddy`/`web` — [`../06-bezpieczenstwo/kontrole-bezpieczenstwa.md`](../06-bezpieczenstwo/kontrole-bezpieczenstwa.md) § 2.
