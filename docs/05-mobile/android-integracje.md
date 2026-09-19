# Integracje Android — instalacja PWA, skróty aplikacji, linki, HTTP Shortcuts

**Cel:** opisać, jak OligInvest działa na Androidzie jako zainstalowana PWA (skróty z ikony, otwieranie linków w aplikacji, powiadomienia) oraz jak skonfigurować darmową aplikację HTTP Shortcuts do szybkich akcji, widżetów i kafelków Szybkich ustawień (FR-09.01, FR-09.03, FR-09.04, FR-09.06, FR-09.08).

Powiązane: [`strategia-mobilna.md`](strategia-mobilna.md), [`ios-integracje.md`](ios-integracje.md) (token PAT, bezpieczeństwo, komunikaty błędów), [`../02-api/openapi.yaml`](../02-api/openapi.yaml) (tag `quick`), [`../04-frontend/architektura-ui.md`](../04-frontend/architektura-ui.md) § 8, [HTTP Shortcuts — dokumentacja](https://http-shortcuts.rmy.ch/), [HTTP Shortcuts — repozytorium](https://github.com/Waboodoo/HTTP-Shortcuts).

## 1. Instalacja PWA

1. Otwórz adres OligInvest w Chrome i zaloguj się (TOTP).
2. Monit „Zainstaluj aplikację” albo menu ⋮ → „Zainstaluj aplikację” (w aplikacji także przycisk „Zainstaluj” obsługiwany zdarzeniem `beforeinstallprompt`).
3. Chrome tworzy **WebAPK** — ikona w szufladzie aplikacji, osobne okno, powiadomienia, skróty z ikony i otwieranie linków OligInvest w aplikacji.

Pamięć i sesja zainstalowanej aplikacji są wspólne z profilem Chrome (inaczej niż na iOS), więc logowanie w Chrome wystarcza.

## 2. Skróty aplikacji (przytrzymanie ikony, FR-09.06)

Definiowane w `app/manifest.ts`; każdy prowadzi do trasy PWA (logowanie, jeśli sesja wygasła):

```ts
// apps/web/app/manifest.ts — fragment ilustracyjny
shortcuts: [
  { name: 'Dodaj transakcję', short_name: 'Transakcja', url: '/portfel/operacje/nowa',
    icons: [{ src: '/icons/shortcut-add.png', sizes: '96x96', type: 'image/png' }] },
  { name: 'Wynik dnia', short_name: 'Wynik dnia', url: '/?sekcja=wynik-dnia',
    icons: [{ src: '/icons/shortcut-today.png', sizes: '96x96', type: 'image/png' }] },
  { name: 'Alerty', short_name: 'Alerty', url: '/alerty',
    icons: [{ src: '/icons/shortcut-alerts.png', sizes: '96x96', type: 'image/png' }] },
  { name: 'Szukaj instrumentu', short_name: 'Szukaj', url: '/rynek/szukaj',
    icons: [{ src: '/icons/shortcut-search.png', sizes: '96x96', type: 'image/png' }] },
],
```

Launcher pokazuje ograniczoną liczbę pozycji (zwykle pierwsze cztery — ❓ zależnie od launchera), dlatego kolejność odpowiada częstotliwości użycia. Skróty można przeciągnąć na ekran główny jako osobne ikony. Zmiana listy skrótów dociera do urządzenia po aktualizacji WebAPK przez Chrome (z opóźnieniem).

## 3. Linki głębokie (FR-09.07)

- WebAPK rejestruje adresy z zakresu aplikacji — link `https://invest.oligi.pl/rynek/<instrumentId>` z poczty, komunikatora lub HTTP Shortcuts otwiera zainstalowaną aplikację (przy pierwszym razie system może zapytać o wybór aplikacji).
- Bez instalacji link otwiera się w Chrome.
- Linki z powiadomień push zawsze otwierają aplikację na właściwym ekranie (`notificationclick`).

## 4. Powiadomienia

- Web Push przez Chrome; zgoda po geście w **Ustawienia → Powiadomienia**; test powiadomienia z tego samego ekranu.
- Serwer ustawia nagłówek `Urgency` protokołu Web Push (RFC 8030): `high` dla alertów cenowych i bezpieczeństwa, `normal` dla pozostałych; `TTL` 1 h dla alertów cenowych (spóźniony alert o kursie traci sens), 24 h dla pozostałych.
- Tryb oszczędzania energii (Doze) może opóźniać powiadomienia o niskim priorytecie — alerty krytyczne mają dodatkowo e-mail (FR-05.06).

## 5. HTTP Shortcuts — szybkie akcje, widżety, kafelki

[HTTP Shortcuts](https://github.com/Waboodoo/HTTP-Shortcuts): darmowa, open source (MIT), dostępna w Google Play i F-Droid, aktywnie rozwijana (ostatnia zmiana w repozytorium 2026-09-17, sprawdzone 2026-09-19). Według README skróty można wywoływać z widżetów ekranu głównego, kafelków Szybkich ustawień i szybkiego dostępu do sterowania urządzeniami; odpowiedź może być wyświetlona jako toast, okno dialogowe, okno pełnoekranowe, powiadomienie albo pominięta.

### 5.1 Zmienne globalne

| Zmienna | Typ w HTTP Shortcuts | Wartość |
|---|---|---|
| `oliBase` | Static Variable | `https://invest.oligi.pl` |
| `oliToken` | Static Variable z opcją **„Treat value as secret”** | token PAT (§ 2 w [`ios-integracje.md`](ios-integracje.md)) |
| `oliKey` | UUID | generowany przy każdym wywołaniu (klucz idempotencji) |
| `oliSide` | Multiple Choice Selection | „Kupno” → `BUY`, „Sprzedaż” → `SELL` |
| `oliTicker` | Text Input | pytanie „Ticker (np. PKO)” |
| `oliQty`, `oliPrice` | Number Input | pytania „Ilość”, „Cena za sztukę” |

### 5.2 Skróty

| Skrót | Metoda i adres | Nagłówki | Treść | Wyświetlenie odpowiedzi |
|---|---|---|---|---|
| Portfel | `GET {oliBase}/api/v1/quick/portfolio?format=text` | `Authorization: Bearer {oliToken}` | — | okno dialogowe |
| Wynik dnia | `GET {oliBase}/api/v1/quick/today?format=text` | jw. | — | toast lub okno dialogowe |
| Moje alerty | `GET {oliBase}/api/v1/quick/alerts?format=text&limit=5` | jw. | — | okno dialogowe |
| Kurs | `GET {oliBase}/api/v1/quick/quote?ticker={oliTicker}&format=text` | jw. | — | toast |
| Dodaj transakcję | `POST {oliBase}/api/v1/quick/transactions?format=text` | jw. + `Idempotency-Key: {oliKey}` | JSON (poniżej) | okno dialogowe |

```json
{ "ticker": "{oliTicker}", "side": "{oliSide}", "quantity": "{oliQty}", "price": "{oliPrice}", "accountName": "XTB — zwykły" }
```

Wartości liczbowe wysyłane jako tekst (API przyjmuje kropkę lub przecinek). Gdy odpowiedź zgłasza niejednoznaczny ticker albo możliwy duplikat, dokończ operację w aplikacji (skrót „Dodaj transakcję” z ikony PWA) — wariant HTTP Shortcuts celowo pozostaje prosty.

### 5.3 Widżety i kafelki

- **Kafelek Szybkich ustawień:** przeciągnij pasek powiadomień → edycja kafelków → kafelek HTTP Shortcuts → przypisz skrót „Wynik dnia”. Dotknięcie pokazuje wynik bez odblokowywania aplikacji (odpowiedź jako toast).
- **Widżet ekranu głównego:** widżet skrótu (uruchomienie jednym dotknięciem) albo widżet wartości zmiennej — skrót „Wynik dnia” zapisuje odpowiedź do zmiennej `oliDzis` (skrypt uruchamiany po odpowiedzi; składnia wg dokumentacji HTTP Shortcuts — do potwierdzenia przy konfiguracji w M4), a widżet wyświetla jej wartość z czasem danych (FR-09.08).
- Częstotliwość odświeżania widżetu zależy od wywołań skrótu (ręcznie albo harmonogramem w aplikacji); limit API 30 żądań/min i 2 000/dobę na token.

### 5.4 Bezpieczeństwo

- Token w zmiennej z opcją „Treat value as secret” (niewidoczny w edycji i w historii zdarzeń aplikacji).
- Eksport konfiguracji HTTP Shortcuts (ZIP) zawiera zmienne — chroń go hasłem i nie udostępniaj; do dzielenia się konfiguracją usuń wcześniej wartość `oliToken`.
- Osobny token na urządzenie, minimalne zakresy, odwołanie przy utracie telefonu — jak na iOS ([`ios-integracje.md`](ios-integracje.md) § 6).

## 6. Tasker (opcjonalnie)

Tasker to płatna aplikacja (poza budżetem 0 zł) — akcja „HTTP Request” wywołuje te same endpointy `/quick/*`, a sceny lub zewnętrzne widżety mogą prezentować wynik. Konfiguracja jak w § 5.2; brak gotowych profili w projekcie.

## 7. Udostępnianie pliku importu (propozycja poza MVP)

Chrome na Androidzie obsługuje w zainstalowanych PWA cel udostępniania (Web Share Target, pole `share_target` w manifeście). Pozwoliłoby to udostępnić plik eksportu z XTB („Udostępnij → OligInvest”) prosto do `/portfel/import`. iOS tego nie obsługuje. Decyzja o wdrożeniu — zadanie BL-708 w [`../08-plan/backlog.md`](../08-plan/backlog.md) (po M6); ❓ działanie z plikami XLSX do weryfikacji na urządzeniu.

## 8. Rozwiązywanie problemów

Komunikaty błędów są takie same jak dla Skrótów iOS — tabela w [`ios-integracje.md`](ios-integracje.md) § 7. Dodatkowo:

| Objaw | Przyczyna | Co zrobić |
|---|---|---|
| Link otwiera Chrome zamiast aplikacji | aplikacja niezainstalowana lub nieprzypisana do linków | zainstaluj PWA; w informacjach o aplikacji włącz „Otwieraj obsługiwane linki” |
| Brak nowych skrótów na ikonie | WebAPK jeszcze nie zaktualizowana | odczekaj aktualizację Chrome lub zainstaluj aplikację ponownie |
| Spóźnione powiadomienia | oszczędzanie energii | wyłącz optymalizację baterii dla Chrome; alerty krytyczne przychodzą też e-mailem |
