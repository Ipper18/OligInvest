# BL-614b — ZAP baseline prawdziwego API z sesją po TOTP

**Cel:** udokumentować pasywny skan produkcyjnego procesu API z zalogowaną sesją po TOTP oraz asercje atrybutów faktycznie wydanych ciasteczek Better Auth.

## Zakres i decyzje

- Decyzja właściciela 2026-11-14 (R-56): osobny PR po BL-614; anonimowy przebieg BL-614 bez zmian. Nowy przebieg `api-authenticated` działa w tym samym wywołaniu `zap-baseline.mjs --api`, na tym samym izolowanym stosie Compose, krawędzi `Caddyfile.test` i procesie `apps/api/dist/server.js` (`NODE_ENV=production`).
- Konto syntetyczne powstaje w przebiegu: `seedScanInvitation` (w `apps/api/integration/browser-seed.mjs`, ta sama blokada „tylko izolowana baza testowa” co seed E2E) dodaje jedno zaproszenie roli `user` z losowym adresem `zap-…@scan.example.test`, tokenem i hasłem. Sekret TOTP generuje serwer przy zapisie do 2FA; hook odczytuje go z `otpauth://` jak aplikacja uwierzytelniająca. Nic z tego nie trafia do repozytorium ani wiersza poleceń.
- Cały przepływ idzie przez ZAP (`zap.core.send_request` w hooku), żeby pasywne reguły `FAIL` dla ciasteczek (10010, 10011, 10054, 90033) widziały każdą odpowiedź `Set-Cookie`. Ręczny „słoik” ciasteczek dotyczy tylko jawnych żądań hooka; konfiguracja ZAP (stan HTTP, nagłówek uwierzytelnienia, reguły, progi, timeout `-T 5`) bez zmian.
- Wartości wrażliwe (hasło, token zaproszenia, sekret TOTP, kody zapasowe, wartości ciasteczek) hook zapisuje wyłącznie w osobnym, tymczasowym katalogu `.git/zap-api-auth-*` montowanym jako `/zap/secret`; skrypt usuwa go po skanie, także po błędzie. Przed usunięciem skrypt przeszukuje wszystkie pliki katalogu wyników (raporty, `zap.log`, dowody) pod kątem tych wartości (surowych i zakodowanych w URL) i przerywa przebieg, podając tylko rodzaj wartości i plik.
- Bez nowych zależności, bez zmian obrazu ZAP (`2.17.0@sha256:9624…`), dodatku beta, pliku reguł i budżetu `dast`; brak wyjątków, `IGNORE`, retry i podnoszenia limitów.

## Przepływ i asercje

| Krok | Żądanie | Oczekiwane |
|---|---|---|
| 1 | `POST /api/auth/sign-up/email` (zaproszenie, regulamin) | 200, `mfaVerifiedAt = null`, wydane `session_token` |
| 2–3 | `GET /api/v1/me`, `GET /api/v1/portfolio/summary` z sesją przed MFA | 200 oraz 403 `MFA_ENROLLMENT_REQUIRED` (bramka MFA) |
| 4–5 | `POST /two-factor/enable`, `POST /two-factor/verify-totp` (kod z poprzedniego kroku 30 s) | URI `otpauth://totp/`; 200, sesja zweryfikowana, nowe `session_token` (rotacja) |
| 6–7 | `POST /sign-out`, potem `GET /get-session` ze starym ciasteczkiem | 200 i usunięte `session_token`, `session_data`, `dont_remember`; stara sesja = `null` po stronie serwera |
| 8–9 | `POST /sign-in/email`, `POST /two-factor/verify-totp` (bieżący krok) | wyzwanie `twoFactorRedirect` i tylko `two_factor` (bez sesji); następnie `session_token` i usunięte `two_factor` |
| 10–25 | `get-session`, `list-sessions`, 14 chronionych `GET /api/v1/*` (identity, powiadomienia, rynek, portfel) | 200, `Cache-Control: no-store`, wysłane tylko `session_token` |
| 26 | `POST /api/v1/admin/invitations` jako `user` po TOTP | 403 `FORBIDDEN` (autoryzacja niezależna od MFA) |

Dla każdego kroku skrypt sprawdza metodę, ścieżkę, status, kod problemu, `no-store`, nazwy wysłanych ciasteczek oraz dokładny zbiór wydanych i usuniętych. Każdy `Set-Cookie` w całej historii ZAP (także ruch pająka) musi mieć nazwę `__Host-oliginvest.*`, dokładnie jedno `Secure` i `HttpOnly`, `SameSite=Lax`, `Path=/`, brak `Domain`; wydane ciasteczko nie może być już wygasłe, a usunięte (pusta wartość) musi wygasać teraz lub wcześniej. Wygaśnięcie oceniane jak w przeglądarce i w `apps/web/src/auth/relay.ts` po #81: `Max-Age` ma pierwszeństwo przed `Expires` ([RFC 6265 § 5.3](https://www.rfc-editor.org/rfc/rfc6265#section-5.3), sprawdzone 2026-11-20).

Kody TOTP: zapis do 2FA używa kroku poprzedniego, logowanie bieżącego, więc ochrona przed ponownym użyciem kroku nie jest omijana. Hook nie liczy kodu w ostatnich 5 s kroku 30 s — to deterministyczne szeregowanie, nie ponawianie.

## Weryfikacja

Lokalnie (2026-11-20, Windows + Docker Desktop): `--api` łącznie 47 s (anonimowy 15 s bez zmian: 34 URL-e, te same 3 `WARN`; uwierzytelniony 21 s). Przebieg uwierzytelniony: 26 kroków, 22 pary metoda/ścieżka, 31 wymian HTTP w historii ZAP, 38 URL-i w drzewie, 10 odpowiedzi `Set-Cookie` — wszystkie zgodne z kontraktem; brak wycieku wartości wrażliwych w artefaktach; **0 `FAIL`**. Regresja web (`zap-baseline.mjs` bez flagi): `public` 30 URL-i, `authenticated` 154 URL-e, 0 `FAIL`, dotychczasowe reguły `WARN`, 34 s.

| Ciasteczko | Rodzaj | Atrybuty | Liczba |
|---|---|---|---|
| `__Host-oliginvest.session_token` | wydane | `Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800` | 3 |
| `__Host-oliginvest.session_token` | usunięte | `…; Max-Age=0` | 2 |
| `__Host-oliginvest.session_data` | usunięte | `…; Max-Age=0` | 2 |
| `__Host-oliginvest.dont_remember` | usunięte | `…; Max-Age=0` | 1 |
| `__Host-oliginvest.two_factor` | wydane | `…; Max-Age=600` | 1 |
| `__Host-oliginvest.two_factor` | usunięte | `…; Max-Age=0` | 1 |

Próba negatywna: w zbudowanym `apps/api/dist/auth/config.js` tymczasowo ustawiono `httpOnly: false` (źródła bez zmian, plik przywrócony i porównany bajtowo). ZAP zgłosił **10010 `FAIL`** (5 instancji), a asercja skryptu przerwała przebieg (`session_token violates: httponly`), kod 1.

Obserwacja w trakcie: pierwszy pełny przebieg dostał `429 RATE_LIMITED` na `two-factor/enable`. Limit fasady auth (5 liczonych żądań / 60 s na IP w stałym oknie, [AUTH § 3](../uwierzytelnianie-autoryzacja.md#3-ochrona-przed-zgadywaniem-i-credential-stuffing-asvs-v611-v631)) jest wspólny dla obu przebiegów: anonimowy zużywa 4, uwierzytelniony 5. Kontrola działa poprawnie i pozostaje bez zmian; hook czeka na początek nowego okna minutowego (≤ 62 s) przed pierwszym żądaniem.

| Reguła | Ryzyko / przykłady | Ocena | Decyzja |
|---|---|---|---|
| 10015 Re-examine Cache-control Directives | Informational (Low); `get-session`, `/api/v1/market/*` i inne | jak w BL-614: `no-store` egzekwowane na każdym kroku | zaakceptowane 2026-11-14 dla API; `WARN`, bez wyjątku |
| 10049 Non-Storable Content | Informational (Medium); chronione `GET /api/v1/*` | zamierzony brak cache dla danych użytkownika (SEC § 2.2) | zaakceptowane 2026-11-14 dla API; `WARN`, bez wyjątku |
| 10111 Authentication Request Identified | Informational (High — pewność); `POST /sign-in/email` | rozpoznane logowanie; raport zawiera tylko syntetyczny e-mail i nazwę pola hasła | zaakceptowane 2026-11-14 dla API; `WARN`, bez wyjątku |
| 10112 Session Management Response Identified | Informational (Medium — pewność); `sign-up`, `sign-in`, `verify-totp` | **nowa w tym przebiegu**: ZAP rozpoznaje ciasteczka sesyjne; dowód zawiera tylko nazwę ciasteczka. Atrybuty sprawdza asercja skryptu | **do decyzji właściciela**; pozostaje `WARN`, bez wyjątku |

## Ograniczenia i otwarte

- Skan pasywny: brak dowodu odporności na IDOR, przejęcie sesji czy błędy logiki; RLS i izolacja nadal w testach integracyjnych. Jedno konto `user` — panel admina i role `pro`/`admin` poza zakresem.
- API wydaje usunięcia z `Max-Age=0` (Better Auth). Przeglądarka wylogowuje się przez relay web, który od #81 wysyła `Expires` w przeszłości; bezpośrednie `/api/auth/sign-out` nie jest używane przez UI. Zmiana formy usunięcia w API wymagałaby osobnej decyzji — tu tylko obserwacja.
- Lokalny TLS i krawędź testowa nie zastępują kontroli docelowego wdrożenia (BL-156). Etap M6 pozostaje otwarty.
