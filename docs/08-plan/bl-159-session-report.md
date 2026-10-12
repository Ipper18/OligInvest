# BL-159 — stan bieżący

**Cel:** przekazać wynik oceny zależności Yahoo (R-33), wykonaną migrację na własny adapter i warunki zamknięcia PR.

**2026-10-12**, `feat/bl-159-yahoo-adapter`, roboczy PR. Status BL-159 `w toku` do zielonego CI i scalenia; estymacja 1 d bez zmian, nakład niezmierzony. Decyzja: [ADR-016](../09-decyzje/ADR-016-cienki-adapter-yahoo.md).

## Zrobione

- `YahooProvider` na `createProviderFetch`: chart v8 (EOD i ostatnia cena z `meta`), search v1; bez cookie/crumb i bez v7 quote. Metadane bez zmian: `source: "yahoo"`, `delayMinutes` 15/0, atrybucja, awaria → ostatnia wartość `stale`.
- Allowlista transportu: tylko `query2.finance.yahoo.com` dla Yahoo (usunięte `query1`, `fc.yahoo.com`, `finance.yahoo.com`).
- `yahoo-finance2` usunięte z `packages/data-providers` i lockfile (`pnpm install --lockfile-only`; wyłącznie usunięcia, `--frozen-lockfile --lockfile-only` PASS).
- Testy kontraktowe na czterech zapisanych syntetycznych odpowiedziach (`test/fixtures/yahoo/`), z globalnym `fetch` zablokowanym: Decimal bez utraty, URL/parametry, UA, brak przekierowań, 404 → `no_data`, dryf schematu i waluta → błąd, limit rozmiaru, odrzucenie spreparowanych symboli i hostów cookie, cięcie kwoty z rotacją, degradacja w rejestrze. Testy mutacyjne: wyłączenie rotacji i `JSON.parse` zamiast Decimal są wykrywane.
- Lokalnie (Node 24.21): data-providers 20/20, lint/typecheck/test `data-providers`, `mod-market`, `jobs` 21/21 zadań, `check:deps`, `check:repository` PASS.

## Porównanie

| Wariant | Pakiety produkcyjne `apps/jobs` | Utrzymanie |
|---|---|---|
| `yahoo-finance2` 4.0.2 (było) | **172** (poddrzewo Yahoo 109: MCP SDK, express, cors, cross-spawn, shim Deno, fetch-mock-cache, tough-cookie-file-store) | aktualizacje SDK; float pomijany, i tak własne parsowanie ciała |
| 3.14.3 bez MCP SDK | ok. 84 (poddrzewo ok. 19, w tym 16 spoza obecnego grafu; szacunek z grafu 4.0.2) | cofnięcie linii; nadal shim Deno i magazyn ciasteczek |
| własny adapter (jest) | **68** | ok. 300 linii, dwa endpointy, walidacja wybranych pól i testy kontraktowe |

Liczone z lockfile: domknięcie `dependencies` + `optionalDependencies` importera `apps/jobs` z pakietami workspace, bez devDependencies (unikalne `nazwa@wersja`).

**Warunki Yahoo:** te same endpointy publiczne co wcześniej SDK (chart, search), mniej zapytań (bez strony ciasteczka i `getcrumb`), identyfikujący UA, bez przekierowań, bez rotacji tożsamości; 429/403 → breaker i „nieaktualne”. Charakter prywatny i atrybucja bez zmian.

## Odchylenia i ryzyka

- Notowania: 1 zapytanie na instrument zamiast partii ≤ 50. Budżet Yahoo 12 → 30/min; po cięciu kwoty lub 20 s zwracane są pobrane notowania, następny cykl rotuje. Przy ponad ok. 30 instrumentach jednej sesji część jest „nieaktualna” do kolejnego cyklu — warunek ponownej oceny w ADR-016.
- R-33 zamknięte (P 1 × W 3). Nowych ryzyk brak; sygnały: zmiana schematu lub wymóg crumb dla chart.

## Pominięte i dlaczego

- Odpowiedzi Yahoo na żywo **NIEZWERYFIKOWANE**: polityka sieci sesji blokuje Yahoo. Przed scaleniem właściciel uruchamia `market.quotes`, `market.us-eod` i wyszukiwanie na VM.
- Pełny frozen install z `cdn.sheetjs.com` niemożliwy w sesji (CDN zablokowany); testy na kopii roboczej z `xlsx` z rejestru npm, poza repo. Pełna instalacja i audyt — w CI.
- `apps/web` i UI bez zmian (praca Codex).

## CI

Sprawdzane raz na końcu sesji; wynik w opisie PR.
