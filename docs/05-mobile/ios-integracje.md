# Integracje iOS — Skróty, Siri, Stuknięcie w tył, Centrum sterowania

**Cel:** podać kompletną instrukcję zbudowania i uruchamiania czterech gotowych Skrótów OligInvest na iPhonie („Pokaż mój portfel”, „Ile dziś zarobiłem”, „Dodaj transakcję”, „Moje alerty”) — z tokenem PAT, obsługą błędów i zasadami bezpieczeństwa — bez konta Apple Developer (FR-09.04, FR-09.05, FR-09.08).

Powiązane: [`strategia-mobilna.md`](strategia-mobilna.md) § 7–8, [`../02-api/openapi.yaml`](../02-api/openapi.yaml) (tag `quick`), [`../02-api/konwencje-api.md`](../02-api/konwencje-api.md) § 6 i § 11, [ADR-008](../09-decyzje/ADR-008-pwa-i-integracje-mobilne.md), [Apple: nowości w Skrótach w iOS 18](https://support.apple.com/en-us/121131), [Apple: uruchamianie skrótów z Centrum sterowania](https://support.apple.com/guide/shortcuts/run-shortcuts-from-control-center-apd06a9201d4/ios).

Nazwy menu i akcji według polskiej wersji iOS (w nawiasie nazwy angielskie); między wersjami systemu mogą się nieznacznie różnić.

## 1. Jak to działa

- PWA nie może udostępnić akcji systemowi (brak App Intents i własnego schematu URL), więc Skróty wywołują bezpośrednio API: akcja „Pobierz zawartość URL” (*Get Contents of URL*) z nagłówkiem `Authorization: Bearer <PAT>`.
- Endpointy `/api/v1/quick/*` z `?format=text` zwracają kilka krótkich linii po polsku (kwoty i procenty jak `Intl` pl-PL), zawsze z czasem i statusem danych — gotowe do wyświetlenia albo przeczytania przez Siri.
- Wymagania: iOS ≥ 17 (aplikacja Skróty jest wbudowana); iOS 18 dla elementów sterujących w Centrum sterowania i na ekranie blokady; Przycisk czynności — iPhone 15 Pro i nowsze.
- Zainstalowana PWA **nie jest wymagana** do działania Skrótów.

## 2. Token PAT

1. W OligInvest: **Ustawienia → Tokeny → Nowy token**; potwierdź kodem TOTP (step-up).
2. Nazwa: np. „iPhone — Skróty”. Zakresy:
   - token **tylko do odczytu**: `portfolio:read`, `alerts:read`, `market:read` — dla „Pokaż mój portfel”, „Ile dziś zarobiłem”, „Moje alerty”;
   - osobny token z `transactions:write` — tylko jeśli używasz „Dodaj transakcję”.
3. Ważność: domyślnie 90 dni (maks. 365).
4. Skopiuj token — jest pokazywany **jednorazowo**. Wklejasz go w pytaniu przy imporcie skrótu (§ 3) i nigdzie indziej.

## 3. Instalacja gotowych skrótów

W etapie M4 właściciel publikuje w **Ustawienia → Integracje** linki iCloud do czterech skrótów. Każdy ma **pytania przy imporcie** (*Import Questions*):

| Pytanie | Przykład | Skróty |
|---|---|---|
| Token PAT | `oli_pat_…` | wszystkie |
| Adres serwera | `https://invest.oligi.pl` (domyślnie) | wszystkie |
| Nazwa rachunku | `XTB — zwykły` | Dodaj transakcję |

Przed dodaniem skrótu iOS pokazuje jego akcje — sprawdź, że wszystkie żądania idą wyłącznie na adres OligInvest. Odpowiedzi na pytania przy imporcie nie są częścią udostępnianego skrótu, więc link iCloud nie zawiera tokenu. **Nigdy nie udostępniaj skrótu, w którym token wpisano na stałe w akcji „Tekst”.**

## 4. Budowa skrótów ręcznie

Alternatywa dla linków iCloud — pełna kontrola nad tym, co robi skrót.

### 4.1 „Pokaż mój portfel” i „Ile dziś zarobiłem”

1. **Tekst** (*Text*): wklej token → zmień nazwę zmiennej na `Token`.
2. **Pobierz zawartość URL** (*Get Contents of URL*):
   - URL: `https://invest.oligi.pl/api/v1/quick/portfolio?format=text` (dla drugiego skrótu `…/quick/today?format=text`);
   - Metoda: `GET`; Nagłówki: `Authorization` = `Bearer ` + zmienna `Token`.
3. **Pokaż wynik** (*Show Result*) z zawartością URL. Uruchomiony przez Siri — wynik zostanie przeczytany na głos.

Przykładowa odpowiedź:

```text
Dziś: +280,45 zł (+0,54%)
▲ CDR +2,10%  ▼ PKO -0,85%
Dane: 15:42, opóźnione 15 min
```

### 4.2 „Dodaj transakcję”

1. **Wybierz z menu** (*Choose from Menu*) „Rodzaj transakcji”: „Kupno” → **Tekst** `BUY`; „Sprzedaż” → **Tekst** `SELL`; wynik menu zapisz jako zmienną `Strona`.
2. **Poproś o dane wejściowe** (*Ask for Input*), typ Tekst: „Ticker (np. PKO)” → `Ticker`.
3. **Poproś o dane wejściowe**, typ Liczba: „Ilość” → `Ilość`.
4. **Poproś o dane wejściowe**, typ Liczba: „Cena za sztukę” → `Cena` (API przyjmuje liczbę albo tekst z przecinkiem).
5. Klucz idempotencji (Skróty nie mają generatora UUID):
   - **Bieżąca data** → **Formatuj datę** (*Format Date*), format własny `yyyyMMddHHmmssSSS`;
   - **Liczba losowa** (*Random Number*) od 100000 do 999999;
   - **Tekst**: `sc-` + data + `-` + liczba → zmienna `Klucz` (np. `sc-20260918154207123-482913`).
6. **Słownik** (*Dictionary*): `ticker` = `Ticker`, `side` = `Strona`, `quantity` = `Ilość` (Liczba), `price` = `Cena` (Liczba), `accountName` = odpowiedź z pytania przy imporcie.
7. **Pobierz zawartość URL**: URL `https://invest.oligi.pl/api/v1/quick/transactions?format=text`, Metoda `POST`, Nagłówki: `Authorization` = `Bearer ` + `Token`, `Idempotency-Key` = `Klucz`; Treść żądania: JSON = Słownik.
8. **Jeśli** (*If*) wynik zawiera „Niejednoznaczny”: **Poproś o dane wejściowe** „Rynek (np. XWAR, XNYS)” → dodaj do słownika `mic` → nowy `Klucz` (krok 5) → ponów krok 7.
9. **Jeśli** wynik zawiera „możliwy duplikat”: **Wybierz z menu** „Zapisz mimo to” / „Anuluj”; przy zapisie dodaj `confirmDuplicate` = `true` (Wartość logiczna), wygeneruj **nowy** `Klucz` i ponów krok 7 — ten sam klucz z innym ciałem zwraca `409 IDEMPOTENCY_CONFLICT`.
10. **Pokaż wynik**, np. „Zapisano: kupno 10 × PKO po 58,34 zł (XTB — zwykły)”.

### 4.3 „Moje alerty”

Jak § 4.1 z adresem `…/quick/alerts?format=text&limit=5`. Wymaga zakresu `alerts:read` i włączonego modułu alertów.

## 5. Uruchamianie

| Sposób | Konfiguracja |
|---|---|
| Siri | powiedz nazwę skrótu: „Hej Siri, ile dziś zarobiłem” |
| Stuknięcie w tył (*Back Tap*) | Ustawienia → Dostępność → Dotyk → Stuknięcie w tył → Stuknij dwukrotnie (lub trzykrotnie) → wybierz skrót |
| Centrum sterowania (iOS 18+) | otwórz Centrum sterowania → „+” → Dodaj element sterujący → Skróty → wybierz skrót |
| Ekran blokady (iOS 18+) | przytrzymaj ekran blokady → Dostosuj → Ekran blokady → zastąp element sterujący na dole → Skróty → wybierz skrót |
| Przycisk czynności (iPhone 15 Pro i nowsze) | Ustawienia → Przycisk czynności → Skrót → wybierz skrót |
| Widżet na ekranie początkowym | przytrzymaj ekran → Edytuj → Dodaj widżet → Skróty → wybierz skróty (widżet uruchamia skrót, nie wyświetla danych stale) |
| Automatyzacja | Skróty → Automatyzacja → „+” → Pora dnia 17:15, dni robocze → „Uruchom natychmiast” → skrót „Ile dziś zarobiłem” zakończony akcją „Pokaż powiadomienie” (*Show Notification*) |

## 6. Bezpieczeństwo

- **Token jest zapisany w skrócie.** Każdy, kto ma odblokowany telefon, może uruchomić skrót — dlatego minimalne zakresy, osobny token do zapisu i możliwość dodania kroku „Poproś o potwierdzenie” przed wysłaniem transakcji.
- **Synchronizacja iCloud:** przy włączonej synchronizacji Skrótów skrót z tokenem trafia do iCloud. Zalecenie: włączona Zaawansowana ochrona danych (*Advanced Data Protection*) albo krótka ważność tokenu.
- **Utrata telefonu:** Ustawienia → Tokeny → Odwołaj (skutek natychmiastowy). „Wyloguj wszędzie” unieważnia sesje przeglądarki, ale **nie** tokeny PAT — odwołuje się je osobno.
- **Ślad w audycie:** każde użycie tokenu zapisuje się z typem aktora `pat`; nietypowa aktywność (np. seria błędów 401) trafia do logów bezpieczeństwa (NFR-03.10).
- **Limity:** 30 żądań/min i 2 000/dobę na token (`konwencje-api.md` § 7).
- Skróty łączą się wyłącznie przez HTTPS; nie wyłączaj weryfikacji certyfikatów ani nie używaj adresów IP zamiast domeny.

## 7. Rozwiązywanie problemów

| Odpowiedź | Znaczenie | Co zrobić |
|---|---|---|
| `Błąd: wymagane logowanie` (401) | token nieprawidłowy, wygasły lub odwołany | utwórz nowy token i zaktualizuj skrót |
| `Błąd: brak uprawnienia …` (403 `PAT_SCOPE_MISSING`) | token bez wymaganego zakresu | utwórz token z właściwym zakresem |
| `Błąd: nie znaleziono` (404) | moduł wyłączony lub zły adres | sprawdź adres serwera; zapytaj administratora o flagę modułu |
| `Niejednoznaczny ticker …` (409) | ticker istnieje na kilku rynkach | podaj rynek (krok 8 w § 4.2) |
| `Możliwy duplikat …` (409) | ta sama transakcja w ciągu 10 min | potwierdź albo anuluj (krok 9) |
| `Błąd: wskaż rachunek …` (422) | kilka rachunków, brak nazwy | uzupełnij odpowiedź „Nazwa rachunku” w skrócie |
| `Błąd: za dużo żądań …` (429) | przekroczony limit | odczekaj czas podany w komunikacie |
| brak odpowiedzi / błąd sieci | brak połączenia lub serwer niedostępny | ponów później; stan serwera sprawdza administrator |

## 8. Widżety z danymi (opcjonalnie, FR-09.08, P3)

- Systemowe widżety iOS nie wyświetlają danych z PWA ani ze Skrótów na stałe — widżet Skróty tylko uruchamia skrót.
- **Scriptable** (darmowa aplikacja z widżetami w JavaScript) może pobierać `GET /quick/today?format=json` z tokenem trzymanym w pęku kluczy aplikacji i rysować widżet z wartością i czasem danych. Ryzyko: ostatnia aktualizacja aplikacji 2024-09 — funkcja wyłącznie opcjonalna, bez gwarancji działania na kolejnych wersjach iOS. Przykładowy skrypt powstaje w M5 i trafia do `docs/12-dla-uzytkownika/`.
