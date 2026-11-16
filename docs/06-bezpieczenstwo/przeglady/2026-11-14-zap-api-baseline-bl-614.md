# BL-614 — anonimowy ZAP baseline prawdziwego API

**Cel:** udokumentować pasywny skan anonimowych odpowiedzi produkcyjnego procesu API z lokalną bazą i zakres pozostawiony do BL-614b.

## Zakres i decyzje właściciela

- Decyzja 2026-11-14: bez sesji, rejestracji i wyzwania TOTP; sprawdzamy brak `Set-Cookie`. Atrybuty wydanych ciasteczek Better Auth oraz trasy po zalogowaniu należą do BL-614b.
- Rozszerzenie istniejącego `apps/web/scripts/zap-baseline.mjs`, bez kopii skanera i nowych zależności. Tryb `--api` uruchamia rzeczywisty `apps/api/dist/server.js` w trybie produkcyjnym, za Caddy z `infra/caddy/Caddyfile.test`.
- Izolowany `compose.dev.yaml`, migracje i syntetyczny seed przez te same pomocniki co `scripts/ci-e2e.mjs`. Sekrety losowane na przebieg, pliki `*_FILE` usuwane po skanie; brak połączeń z serwerem właściciela.
- Sondy zgodne z OpenAPI to `/api/v1/health/live` i `/api/v1/health/ready` (200). Wskazane w zadaniu `/api/health/live` i `/api/health/ready` również obejmujemy, z oczekiwanym 404; nie dodajemy aliasów do API.
- Jawne żądania GET/POST przez ZAP obejmują publiczne odpowiedzi i odmowy dostępu do tras auth. Pająk sam nie odkrywa JSON API. Kontrola pokrycia musi potwierdzić metody, ścieżki, oczekiwane statusy, gotowość PostgreSQL i obu Valkey, anonimowe `get-session = null` oraz brak cookies i autoryzacji.
- Ten sam digest ZAP i dodatek beta co BL-602, bez aktualizacji dodatków, aktywnego skanu, wyjątków i zmiany progów. Publikacja obrazu 2026-11-03T12:34:20Z, czyli ponad 72 h przed tym przeglądem ([SEC § 9.1](../kontrole-bezpieczenstwa.md#91-pasywny-skan-dast--zap-baseline-bl-602-nfr-0306-nfr-0307)).
- Rozszerzenie istniejącego zadania `dast`; ruleset i timeout pozostają bez zmian.

## Weryfikacja

Lokalnie (2026-11-14, Windows + Docker Desktop): 21 zaplanowanych par metoda/ścieżka, 26 rzeczywistych wymian HTTP i 34 URL-e w drzewie ZAP. PostgreSQL i oba Valkey gotowe, `get-session = null`, brak wysłanych `Cookie`/`Authorization` i brak `Set-Cookie` we wszystkich odpowiedziach. Skan: 15 s, wraz z izolowanym stosem: 24 s. Brak ustaleń `FAIL`; trzy reguły `WARN` o ryzyku informacyjnym — tabela poniżej.

Próba negatywna: tymczasowo usunięto `X-Content-Type-Options` wyłącznie z generowanej lokalnej konfiguracji Caddy. ZAP wykrył **10021 `FAIL`**, m.in. na `/api/auth/get-session` i obu sondach `/api/v1/health/*`; cały skrypt zakończył się kodem 1. Zmianę testową wycofano, przywrócony przebieg nie ma `FAIL`. Produkcyjny kod API i pliki Caddy nie wymagały poprawek.

| Reguła | Ryzyko / przykłady | Ocena i dowód | Decyzja |
|---|---|---|---|
| 10015 Re-examine Cache-control Directives | Informational (Low); `/api/auth/get-session`, `/api/v1/health/live`, `/api/v1/health/ready`, `/api/v1/openapi.json` | Odpowiedzi mają `Cache-Control: no-store`; dowód pokrycia egzekwuje tę dyrektywę dla wszystkich 21 żądań. Reguła oczekuje dodatkowo `no-cache, must-revalidate`, nadmiarowych wobec zakazu przechowywania z [RFC 9111 § 5.2.2.5](https://www.rfc-editor.org/rfc/rfc9111#section-5.2.2.5). Analogiczne ustalenie dla web: BL-602 P2. | zaakceptowane 2026-11-14; pozostaje `WARN`, bez wyjątku |
| 10049 Non-Storable Content | Informational (Medium); `/api/health/live`, `/api/health/ready`, `/api/v1` i inne odpowiedzi API | Zamierzony brak cache zgodny z SEC § 2.2; reguła informuje o odpowiedziach nieprzechowywalnych. Nie należy usuwać `no-store` z odpowiedzi auth ani błędów, by uciszyć ten alert. Analogiczne ustalenie web: BL-602 P3. | zaakceptowane 2026-11-14; pozostaje `WARN`, bez wyjątku |
| 10111 Authentication Request Identified | Informational (High — pewność, nie poziom ryzyka); `POST /api/auth/sign-in/email` | Rozpoznane żądanie logowania z syntetycznym nieistniejącym kontem. Odpowiedź 401 `UNAUTHENTICATED`, bez ciasteczka; nie powstała zalogowana sesja. Opis reguły w raporcie nie wskazuje podatności. Analogiczne ustalenie web: BL-602 P3. | zaakceptowane 2026-11-14; pozostaje `WARN`, bez wyjątku |

**Decyzja właściciela (2026-11-14):** „Przyjmij; pozostaw WARN bez wyjątków”. Ustalenia 10015, 10049 i 10111 przyjęte jako uzasadnione i nadal raportowane `WARN`, bez `IGNORE`/`INFO`, zmian nagłówków i progów. Dotychczasowa decyzja P9 dla `dast` (blokowanie `FAIL`) pozostaje bez zmian.

Dotychczasowy web: `public` 30 URL-i, `authenticated` 154 URL-e, 0 `FAIL`, 35 s łącznie. Zestaw reguł `WARN` jak w [protokole BL-602 po BL-613](2026-11-08-zap-baseline-bl-602.md#7-ponowny-skan-po-bl-613-2026-11-11), bez nowych wyjątków.

Hook wymusza klasyczny tryb `zap-baseline.py`, którego kod wyjścia pomija ryzyko `Informational` (pełny raport JSON je zachowuje). Skrypt stosuje więc poziomy z istniejącego pliku reguł także do pełnego raportu: np. informacyjna 10019 nadal blokuje jako `FAIL`, pozostałe trzy reguły API są raportowane jako `WARN` (status skanu 2, kod całego skryptu 0 zgodnie z P9). Test regresyjny sprawdza ten przypadek; nie dodano wyciszeń ani wyjątków. Mechanizm hooków: [dokumentacja ZAP](https://www.zaproxy.org/docs/docker/scan-hooks/), sprawdzona 2026-11-14; zachowanie kodu wyjścia zweryfikowane w `zap_common.py` wewnątrz przypiętego obrazu.

Kontrole lokalne: build API/db i web, `pnpm turbo run lint typecheck test --filter=...[origin/main] --output-logs=new-only`, testy skanera (braki pokrycia, nieoczekiwane statusy, cookies, brak zdrowia zależności, wykrywanie nowych tras auth i poziomy reguł), `check-ci`, `check-docs`, `check-repository` i `git diff --check`. Zmiana jest w [draft PR #79](https://github.com/Ipper18/OligInvest/pull/79); DoD i przegląd właściciela pozostają otwarte.

## Ograniczenia

Skan pasywny nie dowodzi odporności na IDOR, SQL injection ani błędy logiki. Brak `Set-Cookie` nie potwierdza atrybutów ciasteczek sesyjnych — to BL-614b. Lokalny TLS nie zastępuje kontroli docelowego wdrożenia (BL-156). Etap M6 pozostaje otwarty.
