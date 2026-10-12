# ADR-016: Cienki adapter Yahoo zamiast yahoo-finance2

**Cel:** zapisać zastąpienie biblioteki `yahoo-finance2` własnym adapterem endpointów chart i search na transporcie `createProviderFetch` (BL-159, R-33).

- **Status:** proponowana (akceptacja właściciela przez scalenie PR BL-159)
- **Data:** 2026-10-12
- **Decydent:** właściciel projektu
- **Powiązane wymagania:** FR-01.02, FR-02.03, NFR-02.04, NFR-03.05, NFR-05.02, NFR-07.04, NFR-09.02

## Kontekst

`yahoo-finance2` 4.0.2 (jedyne użycie: adapter `yahoo` w `packages/data-providers`) wnosi do runtime `apps/jobs` serwer MCP (`@modelcontextprotocol/sdk` z express, cors, cross-spawn), `@deno/shim-deno`, `fetch-mock-cache` i `tough-cookie-file-store` — łącznie 109 z 172 pakietów produkcyjnych `jobs` (R-33). Adapter i tak omijał wynik SDK: ceny brał z oryginalnego ciała HTTP (bezstratny JSON → Decimal), bo SDK zwraca liczby zmiennoprzecinkowe. Biblioteka przed każdym zapytaniem pobierała ciasteczko i crumb (`finance.yahoo.com`, `getcrumb`), których endpointy chart (v8) i search (v1) nie wymagają.

## Rozważane opcje

| Opcja | Zalety | Wady | Koszt / licencja |
|---|---|---|---|
| A. `yahoo-finance2` 4.0.x bez zmian | Utrzymywana obsługa cookie/crumb i modułów | 109 pakietów runtime (MCP SDK, express, shim Deno); wynik float i tak pomijany; 2 dodatkowe zapytania cookie/crumb | 0 zł / MIT |
| B. `yahoo-finance2` 3.14.3 (ostatnia bez MCP SDK, 2026-05-29) | ok. 19 pakietów w poddrzewie | Cofnięcie linii bez poprawek 4.x; nadal shim Deno, `fetch-mock-cache`, magazyn ciasteczek | 0 zł / MIT |
| C. Własny adapter chart v8 + search v1 na `createProviderFetch` | 0 nowych pakietów; ten sam transport co NBP/GPW (UA, allowlista, bez przekierowań, limit rozmiaru, Decimal); brak cookie/crumb | Nadążanie za zmianami schematu Yahoo po naszej stronie; 1 zapytanie na instrument zamiast partii ≤ 50 | 0 zł / ok. 300 linii |

## Decyzja

Wybieramy **C**: adapter `YahooProvider` woła tylko `query2.finance.yahoo.com` — `v8/finance/chart` dla EOD (`period1/period2`, `interval=1d`) i ostatniej ceny opóźnionej (`range=1d`, pola `meta`: `regularMarketPrice`, `regularMarketTime`, `previousClose`/`chartPreviousClose`, `regularMarketVolume`) oraz `v1/finance/search` dla wyszukiwania. Endpoint `v7/finance/quote` (partie, ale wymaga crumb) nie jest używany. Kontrakt `DataProvider` bez zmian: `source: "yahoo"`, `delayMinutes` 15 (notowania) i 0 (EOD), atrybucja „Dane: Yahoo Finance”, awaria = ostatnia wartość z `stale: true`.

## Konsekwencje

- Pozytywne: `apps/jobs` 172 → 68 pakietów produkcyjnych; allowlista transportu bez `fc.yahoo.com`, `finance.yahoo.com` i `query1`; jedno zapytanie zamiast trzech przy zimnym starcie; walidacja Zod wybranych pól `.strict()` i testy kontraktowe na zapisanych syntetycznych odpowiedziach bez sieci.
- Negatywne / dług: notowania kosztują 1 zapytanie na instrument. Budżet Yahoo 12 → 30/min; przy cięciu kwoty lub po 20 s zadanie zwraca pobrane notowania, a kolejne uruchomienie kontynuuje rotacyjnie (pozostałe instrumenty są „nieaktualne” do następnego cyklu). Przy stałym przekroczeniu ok. 30 obserwowanych instrumentów jednej sesji — ponowna ocena (zapasowy dostawca USA albo zgoda właściciela na partie v7 z crumb).
- Jeśli Yahoo zacznie wymagać crumb lub ciasteczek dla chart/search, adapter kończy się błędem i dane degradują do „tylko EOD”; **nie** dodajemy obejścia bez nowej decyzji (ADR-005 § 2–3).
- Zadania: BL-159; aktualizacja STACK, SRC, CACHE, RISK (R-33 zamknięte).

## Weryfikacja

Liczby pakietów z `pnpm-lock.yaml` przed i po (domknięcie przechodnie `dependencies` + `optionalDependencies` importera `apps/jobs`, bez devDependencies) — [raport BL-159](../08-plan/bl-159-session-report.md). Lista wersji i zależności `yahoo-finance2` z [rejestru npm](https://registry.npmjs.org/yahoo-finance2), odczyt 2026-10-12. Kształt odpowiedzi chart/search przyjęto z dotychczasowej próbki testowej i dokumentacji społeczności; odpowiedzi na żywo z tego środowiska **NIEZWERYFIKOWANE** (sieć sesji blokuje Yahoo) — pierwsze uruchomienie na VM potwierdza je przed scaleniem. Przegląd po pierwszej zmianie schematu Yahoo lub przy stałym cięciu kwoty notowań.
