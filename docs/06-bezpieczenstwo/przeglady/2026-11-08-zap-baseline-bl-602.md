# Protokół — pasywny skan DAST (ZAP baseline), BL-602

**Cel:** zapisać przebieg, wyniki i decyzje pierwszego pasywnego skanu ZAP baseline lokalnej instancji OligInvest (NFR-03.06, NFR-03.07), tak aby każdą regułę dało się odtworzyć, ocenić i — tylko decyzją właściciela — wyłączyć.

Ponowny skan po poprawkach BL-613 (2026-11-11): § 7.

Metoda, przypięcia i polityka reguł: [`../kontrole-bezpieczenstwa.md`](../kontrole-bezpieczenstwa.md) § 9.1. Raport sesji: [`../../08-plan/bl-602-session-report.md`](../../08-plan/bl-602-session-report.md).

## 1. Przebieg

| Pole | Wartość |
|---|---|
| Data | 2026-11-08 |
| Wykonał | Claude Code (gałąź `feat/bl-602-zap-baseline`, baza `origin/main` `797fd4a`) |
| Narzędzie | ZAP 2.17.0 (`zaproxy/zap-stable`, digest z § 9.1), `zap-baseline.py` przez Automation Framework, `-silent`, pscanrulesBeta beta-50 (SHA-256 z § 9.1) |
| Cel | `https://localhost:<port losowy>/` — Caddy 2.11.7 z `infra/caddy/Caddyfile.test` → `next start` (build produkcyjny `apps/web`) + syntetyczne API UI |
| Przebiegi | `public` od `/logowanie` (bez sesji) — 30 URL-i; `authenticated` od `/portfel` (syntetyczne ciasteczko `fixture-perf`) — 153 URL-e |
| Reguły | 61–63 reguły pasywne `PASS` na przebieg; 26 z poziomem `FAIL`, reszta `WARN`; `IGNORE` — brak |
| Wynik po poprawkach | `FAIL` 0; `WARN` 5 reguł (`public`) i 7 reguł (`authenticated`) — § 3 |
| Czas lokalnie | 34–38 s łącznie (przebieg 15–17 s), Windows + Docker Desktop, obrazy w cache |
| CI (PR #62, commit `b710ec0`, 2026-11-08) | zadanie `dast` zielone: 2 min 15 s całość, krok skanu 91 s (`public` 46 s z pobraniem obrazów, `authenticated` 33 s); te same 30 / 153 URL-e i ten sam zestaw `WARN`, `FAIL` 0 |

Skanowane trasy (pająk, przebieg `authenticated`): `/`, `/portfel` z podstronami (`rachunki`, `operacje`, `import`, `partie`, `wyniki`, `alokacja`), `/rynek` (instrument, waluty, watchlisty), `/analizy` (lista i formularze `nowa/*`), `/nauka` (słownik), `/ustawienia`, dokumenty prawne, manifest i ikony PWA. Przebieg `public`: `/logowanie`, `/reset-hasla`, `/rejestracja`, `/regulamin`, `/prywatnosc`, `/zrodla-danych`, `/dokumenty/*`, manifest, `/_next/static/*`.

## 2. Ustalenia przed poprawkami

Pierwszy przebieg (po dołączeniu reguł beta) zgłosił dodatkowo **90004 „Cross-Origin-Embedder-Policy Header Missing or Invalid”** (Low, pewność Medium) na wszystkich dokumentach HTML obu przebiegów. Zestaw z § 2.2 miał COOP i CORP, ale bez COEP, więc izolacja między źródłami była niepełna.

**Poprawka:** `Cross-Origin-Embedder-Policy: require-corp` w bloku `header` obu plików Caddy, wiersz w § 2.2, test zgodności bloków w `infra/tests/test-host-config.py` (oraz `-Server` w `Caddyfile.test`, którego brakowało względem produkcji). Wszystkie zasoby są z tego samego źródła albo `data:`/`blob:` (CSP § 2.3), więc `require-corp` niczego nie blokuje; zachowanie w trzech przeglądarkach sprawdza istniejący przebieg E2E obrazów produkcyjnych (`release.yml`, ten sam `Caddyfile.test`). Ponowny skan: 90004 `PASS`, reguła ma teraz poziom `FAIL`.

## 3. Wyniki po poprawkach i ocena

| Reguła | Ryzyko ZAP | Przebieg | Przykładowe ścieżki | Ocena | Dowód | Stan |
|---|---|---|---|---|---|---|
| 10202 Absence of Anti-CSRF Tokens | Medium (Low) | oba | `/logowanie`, `/reset-hasla`, `/analizy/nowa/cel`, `/rynek/{id}` | fałszywy alarm (proponowany) | Ochrona CSRF nie opiera się na tokenach, tylko na `Origin`/`Sec-Fetch-Site` i `SameSite=Lax` (§ 3.6). Formularze logowania i resetu wysyłają JSON przez `/auth/action` — nowy test `apps/web/test/auth-action-origin.test.mjs`: obcy, pusty lub `null` Origin oraz `Sec-Fetch-Site` inne niż `same-origin` → 403, zwykły formularz → 415. Formularze `/analizy/nowa/*` to Server Actions: sonda ręczna 2026-11-08 z obcym Origin → Next przerywa akcję (`Invalid Server Actions request`, 500), z własnym → 303. API: `assertOrigin` i test `apps/api/integration/facade.mjs` (obcy Origin → `FORBIDDEN`). `/rynek/{id}`: formularz `GET` filtra i `method="dialog"` — bez zmiany stanu | `WARN` — pytanie P1 |
| 10015 Re-examine Cache-control Directives | Informational (Low) | oba | `/dokumenty/*`, `/logowanie`, `/manifest.webmanifest`, `/portfel` | fałszywy alarm (proponowany) | Każda odpowiedź `proxy.ts` ma `Cache-Control: private, no-store`; dokumenty prawne dodatkowo `Content-Disposition: attachment`. `no-store` wystarcza ([RFC 9111 § 5.2.2.5](https://www.rfc-editor.org/rfc/rfc9111#section-5.2.2.5)); reguła oczekuje dodatkowo nadmiarowych `no-cache, must-revalidate` | `WARN` — P2 |
| 10049 Non-Storable / Storable and Cacheable Content | Informational (Medium) | oba | HTML (`no-store`) i `/_next/static/*` (`immutable`) | zachowanie zamierzone | dokładnie polityka z § 2.2: dane użytkownika `no-store`, zasoby z hashem w nazwie cache'owane rok | `WARN` — P3 |
| 10111 Authentication Request Identified | Informational (Low) | `public` | `/logowanie` | informacja | reguła tylko rozpoznaje formularz logowania | `WARN` — P3 |
| 10109 Modern Web Application | Informational (Medium) | `authenticated` | `/logowanie` | informacja | sugestia użycia pająka AJAX; trasy MVP są osiągalne pająkiem tradycyjnym (153 URL-e) | `WARN` — P3 |
| 10019 Content-Type Header Missing | Informational (Medium) | `public` | `/` (307) | rzeczywiste, znikome | Przekierowanie bramki w `apps/web/src/proxy.ts` (`NextResponse.redirect`) ma 23-bajtową treść (sam adres) bez `Content-Type`. Skutek ograniczają `X-Content-Type-Options: nosniff` z Caddy i brak treści aktywnej. Poprawka wymaga zmiany `proxy.ts` — wstrzymana do scalenia BL-211 (równoległa praca w `apps/web`) | **rozwiązane 2026-11-11 (BL-613)** — przekierowania `proxy.ts` mają `Content-Type: text/plain; charset=utf-8`; reguła `FAIL` — § 7 |
| 10044 Big Redirect Detected | Low (Medium) | `authenticated` | `/logowanie` (307 → `/`) | fałszywy alarm (proponowany) | Zalogowany użytkownik na `/logowanie`: `redirect()` w komponencie strony zwraca 307 z ~40 KB powłoki błędu Next (`__next_error__`, `NEXT_REDIRECT`). Sprawdzono brak e-maila, nazwy, identyfikatorów użytkownika i sesji, ciasteczka i uprawnień. Przeniesienie przekierowania do `proxy.ts` usunęłoby alert — obszar BL-211 | **rozwiązane 2026-11-11 (BL-613)** — przekierowanie w `proxy.ts`, 307 z treścią równą `Location` — § 7 |
| 10096 Timestamp Disclosure - Unix | Low (Low) | `authenticated` | `/rynek/{id}` | fałszywy alarm (proponowany) | znaczniki czasu świec (`"t":[1791763200,…]`) w danych wykresu — zamierzone dane rynkowe | `WARN` — P6 |
| 10031 User Controllable HTML Element Attribute (Potential XSS) | Informational (Low) | `authenticated` | `/`, `/portfel`, `/portfel/import` | fałszywy alarm (proponowany) | Parametry `accountId`, `view`, `groupBy` (zwalidowane wartości) trafiają do atrybutów linków i pól. Sonda ręczna z `"><script>alert(1)</script>` i `"onmouseover=1`: brak odbicia w atrybutach HTML, wartość wyłącznie jako zakodowany ciąg JSON w danych RSC; React koduje atrybuty, CSP z nonce (§ 2.3, § 3.3) | `WARN` — P6 |

Reguły z poziomem `FAIL` (26 w dniu skanu; 27 od BL-613 z 10019, lista w `apps/web/zap-baseline.conf`) — wszystkie `PASS`, m.in. CSP (10038, 10055), HSTS (10035), nosniff (10021), clickjacking (10020), Permissions-Policy (10063), izolacja (90004), ciasteczka (10010, 10011, 10054, 90033), nagłówki `Server`/`X-Powered-By` (10036, 10037), sekrety w URL (10024), skrypty z innych domen (10017, 10115), błędy aplikacji (10023, 90022).

## 4. Integracja z CI — decyzja z dowodami

- **Decyzja:** osobne zadanie `dast` w workflow Web security (nowy kontekst w `.github/rulesets/main.json`; właściciel musi go dodać do rulesetu w ustawieniach GitHub — [`../../07-wdrozenie/ustawienia-repozytorium.md`](../../07-wdrozenie/ustawienia-repozytorium.md)).
- **Dlaczego nie krok w `web`:** `web` trwał 9 min 25 s z limitem 15 min (przebieg `main` 42501503883, 2026-11-08). Dodanie ok. 3–5 min (instalacja ZAP 2,4 GB rozpakowany, start JVM, dwa przebiegi) zbliżyłoby go do limitu, a limitów nie podnosimy. ZAP na tym samym runnerze konkurowałby też o CPU z Lighthouse (zapas LCP `/portfel` ok. 190 ms, R-53).
- **Dlaczego nie w `e2e` ani `images`:** oba wymagają prawdziwego API i bazy, więc skan tras zalogowanych wymagałby rejestracji z TOTP w skrypcie ZAP i limitów logowania 5/min; to osobny etap (R-56, P7).
- **Czas w CI (PR #62, `b710ec0`):** zadanie `dast` 2 min 15 s przy limicie 15 min — instalacja 12 s, build `apps/web` 16 s (cache Turborepo), skan 91 s, artefakt 2 s. Równoległe `web` 9 min 21 s, bez zmian względem `main` (9 min 25 s). Wszystkie kontrole PR zielone.

## 5. Propozycje wyjątków i decyzje właściciela

Propozycje z 2026-11-08; żadna nie została wpisana do pliku reguł. Decyzje właściciela z 2026-11-10 (komentarz w PR #62) — tabela 5.1.

| ID | Pytanie | Propozycja |
|---|---|---|
| P1 | 10202: czy uznać za fałszywy alarm i dodać `IGNORE` z powodem „CSRF przez Origin/Sec-Fetch-Site + SameSite=Lax (SEC § 3.6), testy w auth-action-origin i facade”? | `IGNORE` z powodem; alternatywa: pozostawić `WARN` |
| P2 | 10015: `IGNORE` (no-store wystarcza) czy dopisać `no-cache, must-revalidate` w `proxy.ts` po scaleniu BL-211? | `IGNORE` z powodem |
| P3 | 10049, 10111, 10109 (informacyjne, zachowanie zamierzone): `INFO` zamiast `WARN`? | `INFO` |
| P4 | 10019: poprawić w `proxy.ts` (`Content-Type: text/plain; charset=utf-8` na przekierowaniach bramki) po scaleniu BL-211? | poprawka w osobnym PR, potem `FAIL` |
| P5 | 10044: przenieść przekierowanie zalogowanego z `/logowanie` do `proxy.ts` (po BL-211) czy `IGNORE` (brak danych w treści)? | `IGNORE` z powodem |
| P6 | 10096 i 10031: `IGNORE` z powodami z § 3? | `IGNORE` z powodem |
| P7 | Czy dodać drugi przebieg na prawdziwym `api` (ciasteczka Better Auth, nagłówki API, trasy publiczne `/api/auth/*`) w zadaniu obrazów produkcyjnych — bez sesji albo z sesją z rejestracji TOTP? | osobne zadanie po decyzji (R-56) |
| P8 | Czy krawędź testowa ma używać przebudowanego obrazu z `infra/docker/caddy.Dockerfile` zamiast przypiętego obrazu bazowego (dokładnie produkcyjne binarium, dodatkowy czas budowy Go)? | obecny obraz bazowy (tylko pętla zwrotna) |
| P9 | Czy po decyzjach P1–P6 przełączyć `dast` na blokowanie także na `WARN`? | tak, po decyzjach |

### 5.1 Decyzje właściciela (2026-11-10)

| ID | Decyzja | Skutek |
|---|---|---|
| P1, P2, P3, P6 | bez wyjątków skanera | 10202, 10015, 10049, 10111, 10109, 10096 i 10031 zostają `WARN` — bez `IGNORE` i bez `INFO`; plik reguł bez zmian |
| P4, P5 | poprawki w `apps/web/src/proxy.ts` po scaleniu BL-211 (PR #63), osobnym PR | `Content-Type` przekierowań bramki (10019) i przekierowanie zalogowanego z `/logowanie` (10044); po poprawce 10019 → `FAIL` — BL-613 |
| P7 | skan prawdziwego `api` (Better Auth) jako osobne zadanie później | BL-614, R-56 |
| P8 | krawędź testowa na obrazie bazowym `caddy:2.11.7@sha256:f2a1…` | bez budowania `infra/docker/caddy.Dockerfile` w `dast` |
| P9 | `dast` blokuje tylko przy `FAIL` | `WARN` pozostają raportowane w podsumowaniu zadania, nieblokujące |
| — | `dast` wymaganym checkiem rulesetu `main` | kontekst jest w `.github/rulesets/main.json`; właściciel włącza go w ustawieniach GitHub po scaleniu PR #62 |

## 6. Ograniczenia

- ZAP baseline jest heurystyczny i pasywny: nie wykrywa błędów autoryzacji, IDOR, wstrzyknięć ani błędów logiki — te pokrywają testy RLS, integracyjne i E2E.
- Syntetyczne API zastępuje prawdziwe `api`: nagłówki i ciasteczka Better Auth (`__Host-`, `HttpOnly`, `Secure`, `SameSite`) sprawdzają testy API (O-01 w § 8), nie ten skan (R-56).
- Pająk tradycyjny nie wykonuje JavaScriptu; żądania `fetch` po hydratacji (SSE, `/api/v1/*` z przeglądarki) nie są w zakresie.
- Produkcja (TLS, HSTS na prawdziwej domenie, porty z zewnątrz) — BL-156.

## 7. Ponowny skan po BL-613 (2026-11-11)

| Pole | Wartość |
|---|---|
| Wykonał | Claude Code (gałąź `fix/bl-613-zap-proxy`, baza `origin/main` `233b129`), lokalnie `pnpm --filter @oliginvest/web exec node scripts/zap-baseline.mjs`, 37 s |
| Zmiana | `apps/web/src/proxy.ts`: (1) każde przekierowanie z proxy ma `Content-Type: text/plain; charset=utf-8` — Next zapisuje względny `Location` jako treść przekierowania z proxy (`res.end(destination)` w `router-server`), więc treść jest tekstem, a nie brakuje jej typu; (2) zalogowany użytkownik na `/logowanie` dostaje 307 z proxy do `returnTo` zwalidowanego tym samym `safeReturnTo` (albo do bramki MFA/regulaminu z `returnTo`), a strona `/logowanie` już nie czyta sesji. Proxy używa istniejącego sprawdzenia ciasteczka sesji i jednego `GET /api/v1/me` tylko przy obecnym ciasteczku — bez dodatkowych wywołań; anonimowe wejście na `/logowanie` nie woła już API wcale. Niedostępne API na `/logowanie` → formularz (trasy prywatne nadal 503). Pierwsze ładowanie `/` i `/portfel` bez zmian (R-53) |
| Reguły | 10019 `WARN` → `FAIL` w `apps/web/zap-baseline.conf` (decyzja P4) |
| Wynik | 10019 i 10044 — `PASS` w obu przebiegach; 10109 zniknęła (dotyczyła treści `/logowanie` w przebiegu `authenticated`, który teraz dostaje przekierowanie). Pozostałe `WARN` bez zmian: 10202, 10015, 10049, 10111 (`public`), 10096, 10031 (`authenticated`) |
| Dowody | `apps/web/test/proxy-redirects.test.mjs` (typ treści i nagłówki bezpieczeństwa przekierowań, 307 z proxy dla zalogowanego na `/logowanie`, bramki z `returnTo`, niezmieniona walidacja `returnTo`, formularz bez sesji lub przy 401/500); E2E `shell-auth.spec.ts` „proxy redirects are minimal plain-text 307s…” (treść odpowiedzi = `Location`, `Content-Type`, CSP) |

**Ustalenie niezależne od BL-613 — `FAIL` 10010 Cookie No HttpOnly Flag (`authenticated`, `/`, `/portfel`).** Źródłem jest ciasteczko preferencji `oi-locale` (BL-211, PR #63), które `proxy.ts` ustawia bez `HttpOnly`, a `apps/web/src/appearance/settings.tsx` zapisuje przez `document.cookie`. Błąd występuje już na `main`: zadanie `dast` czerwone od scalenia BL-211 (`242bd22`) i na `233b129` (przebieg Web security 43013104332, 2026-11-11). Ciasteczko nie zawiera danych wrażliwych (`pl-PL`/`en-US`), ale reguła ma poziom `FAIL` i wyjątków skanera nie dodajemy (§ 5.1). Poprawka (`HttpOnly` i ustawianie wyłącznie przez serwer zamiast `document.cookie`) zmienia przepływ preferencji BL-211, więc wymaga decyzji właściciela co do zakresu — poza BL-613.
