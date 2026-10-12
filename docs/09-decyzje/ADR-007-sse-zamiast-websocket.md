# ADR-007: Server-Sent Events zamiast WebSocket

**Cel:** zapisać wybór mechanizmu aktualizacji na żywo (SSE zamiast WebSocket) i zasady jego działania.

- **Status:** zaakceptowana
- **Data:** 2026-09-18
- **Decydent:** właściciel projektu
- **Powiązane wymagania:** FR-02.03, FR-05.06, FR-04.02 (postęp zadań), NFR-01.06, Z-01

## Kontekst

Specyfikacja przewiduje „realtime: WebSocket vs SSE vs Supabase Realtime”. Dane rynkowe są opóźnione lub dzienne (Z-01), a przeglądarka potrzebuje wyłącznie **powiadomień serwer → klient**: nowe wyceny, zakończenie importu, postęp analiz, wyzwolone alerty, zmiany flag. Zapisy użytkownika idą zwykłymi żądaniami REST.

## Rozważane opcje

| Opcja | Zalety | Wady |
|---|---|---|
| **SSE (`EventSource`)** | Standard platformy, 0 KB JS; zwykłe HTTP przez Caddy/nginx; automatyczne wznawianie z `Last-Event-ID`; uwierzytelnianie ciasteczkiem (ten sam origin) | Tylko serwer → klient; limit połączeń per domena w HTTP/1.1 (nieistotny przy HTTP/2) |
| WebSocket | Dwukierunkowy | Niepotrzebna dwukierunkowość; osobna obsługa w proxy, uwierzytelnianiu, wznawianiu |
| Supabase Realtime | Gotowe | Poza wybranym stosem (ADR-004) |
| Polling | Najprostszy | Marnuje transfer i baterię; opóźnienia |

## Decyzja

**SSE**: jeden strumień na kartę przeglądarki — `GET /api/v1/stream` — z kanałem per użytkownik (fan-out przez pub/sub w `valkey-cache`). Zasady: heartbeat co 25 s; identyfikatory zdarzeń monotoniczne per użytkownik z krótkim buforem do wznowienia (`Last-Event-ID`); nagłówki `Cache-Control: no-cache` i wyłączone buforowanie w proxy; limit 5 równoczesnych strumieni na użytkownika; zdarzenia zawierają tylko dane właściciela kanału (Z-22). Klienci PAT (Skróty) nie używają SSE. Gdy strumień nie działa (np. restrykcyjna sieć) — klient przechodzi na odpytywanie co 60 s. Katalog zdarzeń: [`../01-architektura/moduly.md`](../01-architektura/moduly.md) § 5.3; kontrakty: `docs/02-api/realtime.md` (Krok 4).

## Konsekwencje

**Uzupełnienie 2026-10-11 (decyzja właściciela, M1-4a):** protokół SSE pozostaje
bez zmian. Klient używa natywnego `fetch`/`ReadableStream`, bez biblioteki, ponieważ
`EventSource` nie pozwala ustawić `Last-Event-ID` po ręcznym odtworzeniu obiektu ani
odczytać statusu HTTP i `Retry-After`. Klient zapewnia jedno połączenie na kartę,
wznowienie z ostatnim ID, backoff wykładniczy z jitterem i limitem 60 s, zakończenie
bez ponawiania przy 401/403 (przekierowanie do logowania), anulowanie przy wylogowaniu
i wstrzymanie po 5 min ukrycia karty. Budżet powłoki nadal wynosi 30 KiB.

- Pozytywne: brak biblioteki klienckiej; prosta konfiguracja proxy; mniejsze zużycie zasobów serwera przy kilku użytkownikach.
- Negatywne: przyszła funkcja wymagająca kanału klient → serwer w czasie rzeczywistym wymagałaby nowego ADR (dziś żadna nie wymaga).
- Zadania: hub SSE w `platform` (M1), mapowanie zdarzeń modułów (M1–M4), test opóźnienia < 2 s (NFR-01.06).

## Weryfikacja

Test integracyjny mierzy czas od `PUBLISH` do odebrania zdarzenia w przeglądarce (< 2 s p95); test wznowienia po zerwaniu połączenia bez utraty zdarzeń z bufora.
