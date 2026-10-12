# BL-159 — stan bieżący

**Cel:** przekazać wynik oceny zależności Yahoo (R-33), wykonaną migrację na własny adapter i warunki zamknięcia PR.

**2026-10-12**, `feat/bl-159-yahoo-adapter`, roboczy PR. Status BL-159 `w toku` do zielonego CI i scalenia; estymacja 1 d bez zmian, nakład niezmierzony. Decyzja: [ADR-016](../09-decyzje/ADR-016-cienki-adapter-yahoo.md).

## Zrobione

- `YahooProvider` na `createProviderFetch`: chart v8 (EOD i ostatnia cena z `meta`), search v1; bez cookie/crumb i bez v7 quote. Metadane bez zmian: `source: "yahoo"`, `delayMinutes` 15/0, atrybucja, awaria → ostatnia wartość `stale`.
- Allowlista transportu: tylko `query2.finance.yahoo.com` dla Yahoo (usunięte `query1`, `fc.yahoo.com`, `finance.yahoo.com`).
- `yahoo-finance2` usunięte z `packages/data-providers` i lockfile (`pnpm install --lockfile-only`; wyłącznie usunięcia, `--frozen-lockfile --lockfile-only` PASS).
- Testy kontraktowe na czterech zapisanych syntetycznych odpowiedziach (`test/fixtures/yahoo/`), z globalnym `fetch` zablokowanym: Decimal bez utraty, URL/parametry, UA, brak przekierowań, 404 → `no_data`, dryf schematu i waluta → błąd, limit rozmiaru, odrzucenie spreparowanych symboli i hostów cookie, cięcie kwoty z częściowym wynikiem, degradacja w rejestrze. Test mutacyjny: `JSON.parse` zamiast Decimal jest wykrywany.
- Lokalnie (Node 24.21): data-providers 20/20, mod-market 12/12 (kadencja: limit 10 na uruchomienie, jedno zapytanie na instrument w cyklu, stałe), lint/typecheck/test `data-providers`, `mod-market`, `jobs` 21/21 zadań, `check:deps`, `check:repository` PASS. Granica 7 min w PostgreSQL bez testu integracyjnego (brak PostgreSQL 18 w sesji); próg to stała pokryta testem jednostkowym.

## Porównanie

| Wariant | Pakiety produkcyjne `apps/jobs` | Utrzymanie |
|---|---|---|
| `yahoo-finance2` 4.0.2 (było) | **172** (poddrzewo Yahoo 109: MCP SDK, express, cors, cross-spawn, shim Deno, fetch-mock-cache, tough-cookie-file-store) | aktualizacje SDK; float pomijany, i tak własne parsowanie ciała |
| 3.14.3 bez MCP SDK | ok. 84 (poddrzewo ok. 19, w tym 16 spoza obecnego grafu; szacunek z grafu 4.0.2) | cofnięcie linii; nadal shim Deno i magazyn ciasteczek |
| własny adapter (jest) | **68** | ok. 300 linii, dwa endpointy, walidacja wybranych pól i testy kontraktowe |

Liczone z lockfile: domknięcie `dependencies` + `optionalDependencies` importera `apps/jobs` z pakietami workspace, bez devDependencies (unikalne `nazwa@wersja`).

**Warunki Yahoo:** te same endpointy publiczne co wcześniej SDK (chart, search), mniej zapytań (bez strony ciasteczka i `getcrumb`), identyfikujący UA, bez przekierowań, bez rotacji tożsamości; 429/403 → breaker i „nieaktualne”. Charakter prywatny i atrybucja bez zmian.

## Odchylenia i ryzyka

- Notowania: 1 zapytanie chart na instrument zamiast partii ≤ 50. Decyzja właściciela 2026-10-12: budżet Yahoo **12/min** bez zmian. Zadanie co 1 min, ≤ 10 zapytań na uruchomienie (2/min na wyszukiwanie), każdy instrument raz na 5 min (znacznik `qa:` w Valkey); maks. 50 instrumentów w otwartych sesjach; próg „nieaktualne” 5 → 7 min (cykl + pominięte uruchomienie + margines). Szczegóły: ADR-016 § Kadencja.
- R-33 zamknięte (P 1 × W 3). Nowych ryzyk brak; sygnały: zmiana schematu lub wymóg crumb dla chart.

## Pominięte i dlaczego

- Odpowiedzi Yahoo na żywo **NIEZWERYFIKOWANE**: polityka sieci sesji blokuje Yahoo. Przed scaleniem właściciel uruchamia `market.quotes`, `market.us-eod` i wyszukiwanie na VM.
- Pełny frozen install z `cdn.sheetjs.com` niemożliwy w sesji (CDN zablokowany); testy na kopii roboczej z `xlsx` z rejestru npm, poza repo. Pełna instalacja i audyt — w CI.
- `apps/web` i UI bez zmian (praca Codex).

## CI

Pierwszy przebieg: wszystko zielone poza `lint` (`chart-eod.json` niesformatowany przez Biome) — poprawione. Kolejny przebieg sprawdzany raz na końcu; wynik w PR.
