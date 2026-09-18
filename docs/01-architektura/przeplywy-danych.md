# Przepływy danych — kluczowe scenariusze

**Cel:** pokazać krok po kroku, jak dane przepływają przez kontenery i moduły w najważniejszych scenariuszach (logowanie, import, wycena, batch EOD, wyniki, alerty, analizy, Skróty, administracja, RODO), wraz z obsługą błędów — jako wzorzec dla implementacji i testów e2e.

Oznaczenia uczestników: `web` (Next.js), `api` (Hono), `jobs` (Node + BullMQ), `analytics` (Python), `PG` (PostgreSQL z RLS), `VQ` (valkey-queue), `VC` (valkey-cache). Kontrakty endpointów: `docs/02-api/openapi.yaml`; zdarzeń SSE: `docs/02-api/realtime.md` (Krok 4).

## 1. Logowanie z obowiązkowym TOTP (FR-07.02, FR-07.04)

Warunek wstępny: konto utworzone z zaproszenia (FR-07.01).

```mermaid
sequenceDiagram
  autonumber
  actor U as Użytkownik
  participant W as web
  participant A as api Better Auth
  participant DB as PG rola auth
  U->>W: e-mail i hasło
  W->>A: POST /api/auth/sign-in/email
  A->>A: limit prób per IP i konto
  A->>DB: odczyt konta i hash Argon2id
  A->>A: weryfikacja hasła
  alt konto ma włączone TOTP
    A-->>W: twoFactorRedirect, ciasteczko wyzwania, bez sesji
    U->>W: kod TOTP lub kod zapasowy
    W->>A: POST /api/auth/two-factor/verify-totp
    A->>DB: utworzenie sesji
    A-->>W: Set-Cookie sesji HttpOnly Secure SameSite=Lax
  else pierwsze logowanie bez TOTP
    A->>DB: sesja z flagą mfaEnrollmentRequired
    A-->>W: sesja ograniczona
    W->>U: kreator 2FA z kodem QR i 10 kodami zapasowymi
    U->>W: kod potwierdzający z aplikacji
    W->>A: POST /api/auth/two-factor/enable i verify-totp
    A->>DB: włączenie 2FA, rotacja sesji
  end
  A->>DB: audit auth.sign_in
  Note over W,A: bramka MFA w api odrzuca dostęp do danych dla sesji bez zweryfikowanego TOTP (403 MFA_REQUIRED)
```

Błędy: złe hasło → 401 bez ujawnienia, czy konto istnieje; przekroczony limit → 429 z `Retry-After`; seria nieudanych prób → blokada czasowa konta i zdarzenie bezpieczeństwa (NFR-03.10).

## 2. Import transakcji z XTB (FR-03.01, NFR-08.03)

```mermaid
sequenceDiagram
  autonumber
  actor U as Użytkownik
  participant W as web
  participant A as api portfolio
  participant Q as VQ
  participant J as jobs import
  participant DB as PG RLS
  participant S as VC pubsub
  U->>W: wybór pliku XLSX lub CSV z xStation
  W->>A: POST /api/v1/portfolio/imports multipart
  A->>A: walidacja typu i rozmiaru, SHA-256 pliku
  A->>DB: import_batches status=uploaded, import_files bajty pliku
  A->>Q: po commit zadanie import.parse z batchId
  A-->>W: 202 z batchId
  Q->>J: import.parse
  J->>DB: odczyt pliku w kontekście RLS właściciela
  J->>J: parser XTB SheetJS, normalizacja wierszy, walidacja Zod
  J->>DB: mapowanie ISIN i tickerów na instrumenty
  J->>DB: import_rows ze statusem new, duplicate, unsupported, error
  J->>J: uzgodnienie sald gotówki i ilości z wyciągiem
  J->>S: PUBLISH portfolio.import.parsed
  S-->>A: wiadomość pub/sub
  A-->>W: SSE portfolio.import.parsed
  W->>U: podgląd: nowe, duplikaty, nieobsługiwane CFD, błędy, różnice sald
  U->>W: zatwierdzenie
  W->>A: POST /api/v1/portfolio/imports/batchId/commit
  A->>DB: transakcja: wstawienie operacji z unikalnym kluczem zewnętrznym
  A->>Q: po commit recompute dla rachunków od najwcześniejszej daty
  Q->>J: recompute
  J->>DB: partie FIFO, pozycje, gotówka, wyceny dzienne przez packages/core
  J->>S: PUBLISH portfolio.valuation.updated
  S-->>A: wiadomość pub/sub
  A-->>W: SSE portfolio.valuation.updated, odświeżenie widoku
```

Idempotencja: klucz `(account_id, source, external_id)` lub skrót wiersza, gdy broker nie podaje identyfikatora; ponowny import tego samego pliku → wszystkie wiersze `duplicate`. Retencja surowego pliku: 90 dni (do ponownego parsowania po poprawkach parsera), potem usunięcie (NFR-11.02).

## 3. Wycena „na żywo” przez SSE (FR-02.03, FR-02.09)

```mermaid
sequenceDiagram
  autonumber
  participant W as web przeglądarka
  participant A as api
  participant C as VC
  participant J as jobs ingest
  participant P as Yahoo adapter
  W->>A: GET /api/v1/stream z ciasteczkiem sesji
  A->>A: rejestracja subskrypcji użytkownika i jego instrumentów
  A-->>W: event ready, heartbeat co 25 s
  loop co 5 min w trakcie sesji GPW lub USA
    J->>J: kwota i circuit breaker dostawcy
    J->>P: notowania partii do 50 symboli
    P-->>J: kursy z czasem notowania
    J->>C: SET q:instrumentId z TTL 5 min
    J->>C: PUBLISH market.quotes.updated
    C-->>A: wiadomość pub/sub
    A->>A: wycena pozycji podłączonych użytkowników przez packages/core
    A-->>W: event portfolio.valuation.updated z total, dayChange, asOf, source
  end
```

Błędy: dostawca niedostępny → breaker `OPEN`, `api` wysyła wycenę na ostatnich kursach z `stale=true`; zerwane połączenie SSE → przeglądarka wznawia z `Last-Event-ID`; brak sesji → strumień zamykany z kodem `401`.

## 4. Nocny batch EOD GPW i przeliczenie wycen (ADR-005)

```mermaid
sequenceDiagram
  autonumber
  participant J as jobs harmonogram
  participant G as archiwum GPW
  participant DB as PG
  participant Q as VQ
  participant N as NBP
  J->>DB: czy dziś był dzień sesyjny XWAR, tabela trading_calendar
  J->>G: GET archiwum-notowan type=10 date=DD-MM-YYYY, identyfikujący User-Agent OligInvest
  alt plik XLS dostępny
    G-->>J: XLS BIFF z całym rynkiem
    J->>J: SheetJS, test kontraktu kolumn, walidacja wierszy
    J->>DB: upsert market_bars source=gpw oraz korekty 5 ostatnich sesji
    J->>J: kontrola jakości: luki, skoki bez splitu, zera
    J->>DB: data_quality_issues
    J->>Q: market.bars.eod_ingested
  else brak pliku lub błąd
    J->>Q: ponowienie o 19:30 i 21:30
    J->>DB: status dostawcy gpw=degraded
  end
  J->>N: tabela A NBP z dnia, o ile nie pobrana o 12:20
  J->>DB: fx_rates
  Q->>J: recompute-eod dla rachunków z pozycjami na XWAR
  J->>DB: valuations_daily i positions_daily przez packages/core
```

Po 2 kolejnych dniach bez danych GPW admin dostaje alert, a UI pokazuje ostrzeżenie o nieaktualnych danych EOD.

## 5. Wyniki historyczne TWR i XIRR (FR-03.06, FR-03.07)

```mermaid
sequenceDiagram
  autonumber
  participant W as web
  participant A as api portfolio
  participant C as VC
  participant DB as PG RLS
  W->>A: GET /api/v1/portfolio/performance z from, to, accounts, benchmark
  A->>C: GET perf:userId:hash parametrów
  alt trafienie w cache
    C-->>A: wynik
  else brak
    A->>DB: valuations_daily i przepływy zewnętrzne w okresie
    A->>A: packages/core: TWR łańcuchowy, XIRR, obsunięcia
    A->>DB: seria benchmarku z market_bars
    A->>A: symulacja tych samych przepływów w benchmarku
    A->>C: SET z TTL do najbliższej wyceny EOD
  end
  A-->>W: twr, xirr, maxDrawdown, series, method, asOf, assumptions
```

Klucz cache zawiera `userId` (NFR-03.05); unieważnienie następuje po `portfolio.transactions.changed` i po nocnym przeliczeniu.

## 6. Alert cenowy → Web Push lub e-mail (FR-05.01, FR-05.06)

```mermaid
sequenceDiagram
  autonumber
  participant J1 as jobs ingest
  participant Q as VQ
  participant J2 as jobs alerts
  participant DB as PG
  participant J3 as jobs notify
  participant WP as usługa Web Push
  participant M as Brevo SMTP
  J1->>Q: market.quotes.updated z listą instrumentów
  Q->>J2: ewaluacja reguł dla tych instrumentów
  J2->>DB: aktywne reguły z indeksu po instrumencie
  J2->>J2: warunek przez packages/core, histereza i cooldown
  J2->>DB: alert_events triggered
  J2->>Q: notify z userId i alertEventId
  Q->>J3: notify
  J3->>DB: preferencje, ciche godziny, subskrypcje push
  alt subskrypcja push istnieje i kanał włączony
    J3->>WP: wiadomość szyfrowana VAPID
    WP-->>J3: 201 lub 404/410
    J3->>DB: usunięcie wygasłej subskrypcji przy 404/410
  end
  opt kanał e-mail lub brak push
    J3->>M: e-mail przez SMTP TLS
  end
  J3->>DB: notification_deliveries status per kanał
```

Treść alertu zawiera wartość, próg, czas i źródło danych oraz link głęboki; nie zawiera języka rekomendacji (FR-05.07).

## 7. Symulacja Monte Carlo w workerze Python (FR-04.02, NFR-03.13)

```mermaid
sequenceDiagram
  autonumber
  actor U as Użytkownik pro
  participant W as web
  participant A as api analytics
  participant DB as PG RLS
  participant Q as VQ
  participant P as analytics Python
  participant R as PG rola analytics_ro
  participant J as jobs
  U->>W: parametry: horyzont, wpłaty, metoda, liczba ścieżek
  W->>A: POST /api/v1/analytics/runs type=monte_carlo
  A->>A: uprawnienie analytics:run:heavy, limit roli, limity parametrów
  A->>DB: analytics_runs status=queued, snapshot wag i przepływów
  A->>Q: po commit zadanie analytics z runId, wagami, parametrami, seed
  A-->>W: 202 z runId
  Q->>P: zadanie
  P->>P: walidacja JSON Schema i strażnik metodologii
  P->>R: SELECT historii zwrotów instrumentów, tylko dane rynkowe
  P->>P: bootstrap blokowy, symulacja ścieżek numpy
  P-->>Q: postęp co 10 procent
  Q-->>J: zdarzenie postępu
  J->>A: PUBLISH analytics.run.progress przez VC
  A-->>W: SSE analytics.run.progress
  P->>Q: zadanie analytics-results z percentylami, metadanymi i ostrzeżeniami
  Q->>J: analytics-results
  J->>DB: zapis wyniku w kontekście RLS właściciela, status=done
  J->>A: PUBLISH analytics.run.completed przez VC
  A-->>W: SSE analytics.run.completed
  W->>U: wachlarz percentyli, prawdopodobieństwo celu, blok założeń, disclaimer
```

Błędy: przekroczony limit czasu → `failed` z przyczyną; parametry poza limitami → `422` przed kolejkowaniem; wynik zawsze z ziarnem i wersjami (NFR-08.05).

## 8. Skrót iOS „Ile dziś zarobiłem” (FR-09.04, FR-09.05)

```mermaid
sequenceDiagram
  autonumber
  actor U as Użytkownik
  participant SC as Skróty iOS
  participant A as api quick-actions
  participant C as VC
  participant DB as PG RLS
  U->>SC: Stuknięcie w tył, Siri lub widżet Skrótów
  SC->>A: GET /api/v1/quick/today?format=text z Authorization Bearer PAT
  A->>A: weryfikacja PAT: skrót, zakres portfolio:read, ważność, limit
  A->>C: ostatnia wycena użytkownika
  A->>DB: wycena zamknięcia D-1 i przepływy dnia
  A->>A: wynik dnia przez packages/core
  A-->>SC: 200 text/plain Dziś +1 234,56 zł, +0,84 procent, dane 15:42 opóźnione
  SC->>U: pokaż wynik, powiadomienie lub odczyt przez Siri
```

## 9. Skrót „Dodaj transakcję” (FR-09.04, FR-07.07)

```mermaid
sequenceDiagram
  autonumber
  actor U as Użytkownik
  participant SC as Skróty iOS
  participant A as api quick-actions
  participant DB as PG RLS
  participant Q as VQ
  U->>SC: dane z pytań skrótu: ticker, ilość, cena, data, rachunek
  SC->>A: POST /api/v1/quick/transactions z PAT i nagłówkiem Idempotency-Key
  A->>A: zakres transactions:write, walidacja Zod
  A->>DB: mapowanie tickera na instrument
  alt niejednoznaczny ticker
    A-->>SC: 409 z listą kandydatów w formie tekstowej
  else jednoznaczny
    A->>DB: wstawienie operacji i audit, klucz idempotencji zapamiętany 24 h
    A->>Q: po commit recompute
    A-->>SC: 201 Dodano KUPNO 10 x PKO po 119,84 zł, rachunek XTB IKE
  end
```

Powtórzenie żądania z tym samym `Idempotency-Key` zwraca pierwotną odpowiedź bez ponownego zapisu.

## 10. Zmiana flagi funkcji przez admina (FR-08.04, FR-08.10)

```mermaid
sequenceDiagram
  autonumber
  actor AD as Admin
  participant W as web /admin
  participant A as api admin
  participant DB as PG
  participant C as VC
  AD->>W: przełączenie flagi module.analytics.backtest
  W->>A: PATCH /api/v1/admin/flags/key
  A->>A: uprawnienie admin:flags i świeży TOTP nie starszy niż 15 min
  alt brak świeżego TOTP
    A-->>W: 403 STEP_UP_REQUIRED
    W->>AD: prośba o kod TOTP
  else TOTP świeży
    A->>DB: UPDATE feature_flags oraz INSERT audit_log przed i po, jedna transakcja
    A->>C: PUBLISH flags.changed
    C-->>A: unieważnienie cache flag w api i jobs
    A-->>W: 200
  end
```

## 11. Eksport danych użytkownika — RODO (FR-07.09)

```mermaid
sequenceDiagram
  autonumber
  actor U as Użytkownik
  participant W as web
  participant A as api identity
  participant Q as VQ
  participant J as jobs
  participant DB as PG RLS
  U->>W: Pobierz moje dane
  W->>A: POST /api/v1/me/export, wymagany świeży TOTP
  A->>DB: audit identity.export_requested
  A->>Q: zadanie export z userId
  Q->>J: export
  J->>DB: odczyt wszystkich tabel z user_id w kontekście RLS
  J->>J: archiwum ZIP z JSON i CSV, szyfrowane hasłem jednorazowym
  J->>DB: plik eksportu z terminem ważności 24 h
  J->>A: PUBLISH export.ready przez VC
  A-->>W: SSE export.ready
  U->>W: pobranie pliku, link jednorazowy
```

Lista tabel eksportu jest generowana z metadanych schematu (każda tabela z kolumną `user_id`), a test porównuje ją z bazą — nowa tabela nie może „zniknąć” z eksportu (FR-07.09).
