# M4-PWA — stan 2026-11-03

**Cel:** BL-401/402/411, draft [PR #45](https://github.com/Ipper18/OligInvest/pull/45), `feat/m4-pwa-push`. Statusy `w toku` do CI i wspólnego DoD; M4 pozostaje otwarte.

## Wykonane

Scalono `origin/main` d6688b3 (#47 i #48). Konflikt jobs rozwiązany: `createPushSender`, moduły, monitoring, BullMQ i Drizzle ładowane w `startJobs`. Caddy zawiera x/net 0.62.0 i przypięte x/crypto z poprawką GO-2026-5932.

Firefox 155.0 / Playwright 1.63: na produkcyjnym obrazie web za Caddy 2.11.7 z `encode gzip`, z syntetyczną sesją, pierwsza nawigacja HTTP 200 i HTML 52 637 znaków. Po przejęciu przez SW reload wyświetla ustawienia, natywne `fetch().text()` odczytuje HTML i chunk z cache (13 265 znaków); konsola bez błędów. Jednocześnie Playwright `response.text/body` rzuca `NS_ERROR_INVALID_CONTENT_ENCODING`. Diagnoza: ponowne dekodowanie odpowiedzi SW przez protokół Playwright; strategia fetch/cache workera bez zmian. HTML SSR sprawdzany przez `page.request` ze wspólnymi cookies; JS: adresy rzeczywistych żądań strony, treść pobrana bezpośrednio z serwera, unikalne chunki, gzip -9 i niezmienione progi.

Przyczyna logiczna fałszywego banera: warunek `waiting && navigator.serviceWorker.controller` sprawdzał bieżący kontroler dopiero po instalacji i nie porównywał wersji; przejściowy stan instalacji mógł zostać uznany za aktualizację. Baner jest teraz poza `main`, w nagłówku. Kontroler zapamiętywany przed instalacją, rzeczywiste wersje obu workerów odczytywane przez MessageChannel (`GET_VERSION`, Zod strict UUID), nie przez URL. Porównanie leniwe, wspólny moduł walidatorów przeglądarkowych. Pierwsza instalacja/sama obecność kontrolera nie oznacza aktualizacji. Kontrolny WebKit pokazał przejściowy `waiting: installed` przy pierwszej instalacji; `update()` identycznego skryptu nie utworzyło nowego workera mimo różnych nonce CSP. Dokładnej kolejności wyścigu z CI nie odtworzono; regresje wymuszają spóźnione pojawienie się kontrolera i tę samą/inną wersję pod tym samym URL.

## Weryfikacja

- Wskazane Firefox m2-ui (2), firefox-shell preferences (1), WebKit allocation/axe (1): PASS.
- PWA: 13 PASS / 2 SKIP w trzech silnikach; natywne odczyty HTML/chunku, cache, wersja, offline i kliknięcie powiadomienia (dwa SKIP dotyczą notificationclick poza Chromium). Po współdzieleniu walidacji dodatkowo tylko nowa wersja: 3/3 PASS.
- Onboarding po końcowej korekcie: 188,58/190 KiB, driver 7,12/8. Test wykrył przejściowe przekroczenia 191,22 i 194,75 KiB; poprawiono bundlowanie bez zmiany progów. Powtarzano wyłącznie testy dotknięte kolejnymi zmianami, bez retry.
- Jobs: 14/14 PASS, w tym smoke. Build, typy web, Biome zmienionych plików i teksty UI PASS (dwa zastane ostrzeżenia non-null w E2E). Bez zmian timeoutów testów i bez blokowania SW.
- Jeden push uruchamia nowe CI `e2e` i `images`; po ich zakończeniu wyniki per projekt i linki zostaną zapisane w PR (bez kolejnego commitu dokumentacyjnego). Starsze dowody PostgreSQL/RLS, kontraktów i Lighthouse zachowane w opisie PR.

## Otwarte i granice

Ręczny odbiór w zwykłym Firefoksie **niezaliczony**: Computer Use przerwał pracę z powodu braku obsługi polityki URL w tym oknie. Diagnostyka silnika Playwright na obrazie produkcyjnym nie zastępuje tego odbioru. BL-412, BL-565 i redesign poza paczką. Estymata 6 dni, nakład/odchylenie niezmierzone. Bez nowego ADR, zależności lub ryzyka projektowego; R-51 (odbiór push) pozostaje otwarte. API/SQL/wzory i reguły wylogowania bez zmian.
