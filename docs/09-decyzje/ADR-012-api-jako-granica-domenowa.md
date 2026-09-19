# ADR-012: `api` (Hono) jako jedyna granica domenowa; `web` (Next.js) bez dostępu do bazy; kontrakty Zod → OpenAPI

**Cel:** zapisać, że `api` jest jedyną granicą domenową, a `web` nie ma dostępu do bazy, oraz jakie kontrakty i testy z tego wynikają.

- **Status:** zaakceptowana
- **Data:** 2026-09-18
- **Decydent:** właściciel projektu
- **Powiązane wymagania:** FR-09.04, NFR-02.02, NFR-02.05, NFR-03.04, NFR-03.07, §5 (`02-api/openapi.yaml`)

## Kontekst

Z tych samych danych i reguł korzystają: interfejs webowy (SSR + klient), Skróty iOS i HTTP Shortcuts (PAT), procesy `jobs` oraz — pośrednio — `analytics`. Next.js oferuje własne mechanizmy serwerowe (Route Handlers, Server Actions), które kuszą, by logikę i dostęp do bazy umieścić w warstwie UI. To rozproszyłoby autoryzację i RLS na dwa procesy i utrudniło spójny, wersjonowany kontrakt REST wymagany przez specyfikację (OpenAPI).

## Rozważane opcje

| Opcja | Zalety | Wady |
|---|---|---|
| **Jedno API (Hono), Next.js tylko UI** | Jedno miejsce autoryzacji, RLS i audytu; ten sam kontrakt dla przeglądarki, Skrótów i testów; OpenAPI generowane z kodu | Dodatkowy skok sieciowy przy SSR (wewnętrzny, milisekundy) |
| Next.js jako BFF z dostępem do bazy (Server Actions) | Mniej kodu dla prostych formularzy | Dwie ścieżki dostępu do danych; trudniejszy audyt i RLS; brak stabilnego API dla Skrótów |
| tRPC | Typy end-to-end | Nie-REST; trudny dla Skrótów i narzędzi zewnętrznych; brak OpenAPI |

## Decyzja

- `api` jest **jedynym** procesem z logiką domenową dostępną z zewnątrz: REST `/api/v1/<moduł>/…`, `/api/auth/*` (Better Auth), SSE `/api/v1/stream`, `/api/v1/openapi.json`.
- `web` renderuje UI: komponenty serwerowe pobierają dane z `api` przez sieć wewnętrzną (przekazując ciasteczko sesji), komponenty klienckie — przez TanStack Query na ten sam origin. `web` nie ma sterownika bazy, ról DB ani sekretów domenowych; Server Actions służą wyłącznie jako cienkie przekaźniki do `api` (lub nie są używane).
- **Ten sam origin**: Caddy kieruje `/api/*` do `api`, resztę do `web` — brak CORS; ciasteczka `SameSite=Lax`; ochrona CSRF: weryfikacja nagłówka `Origin` dla metod modyfikujących (Better Auth + middleware `api`).
- **Kontrakty**: schematy Zod w `modules/*/src/contracts.ts` i `packages/contracts` → `@hono/zod-openapi` generuje OpenAPI 3.1; `docs/02-api/openapi.yaml` jest projektem kontraktu, a test CI porównuje go z wygenerowanym dokumentem (rozbieżność = czerwony build).
- **Błędy**: `application/problem+json` (RFC 9457) z polem `code` (np. `MFA_REQUIRED`, `QUOTA_EXCEEDED`); szczegóły w `02-api/konwencje-api.md`.

## Konsekwencje

- Pozytywne: jedno miejsce egzekwowania bezpieczeństwa; Skróty i przeglądarka używają tych samych endpointów; testy kontraktowe.
- Negatywne: SSR wykonuje wywołanie HTTP do `api` (koszt ~1–5 ms w sieci Docker); formularze wymagają endpointów REST zamiast Server Actions z dostępem do bazy.
- Zadania: klient API dla RSC z przekazywaniem ciasteczek i identyfikatora korelacji (M0), test spójności OpenAPI (M0).

## Weryfikacja

Obraz `web` nie zawiera sterowników bazy (`pg`) ani `packages/db` (test zależności); test CI porównujący OpenAPI przechodzi; skan tras `web` nie wykazuje zapytań do bazy.
