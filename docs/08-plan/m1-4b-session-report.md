# M1-4b — stan bieżący

**Cel:** przekazać stan BL-147/148/157/158/154/155 i części aplikacyjnej BL-152
oraz warunki bramy A.

**2026-10-13**, `feat/m1-4b-mvp-screens`, [PR #14](https://github.com/Ipper18/OligInvest/pull/14),
roboczy; baza `a8b17b0` (aktualny main przy rozpoczęciu). BL-147 w toku;
pozostałe zadania paczki todo. Nakład/odchylenie niezmierzone, brama A otwarta.

## Zrobione

- `dbc82d4` — osobny commit `docs:` z zatwierdzoną korektą OpenAPI.
  `Position.accountId` opcjonalne w schemacie; wymagane dla
  `groupBy=account_instrument`, nieobecne dla `groupBy=instrument`.
- `20b6c12` — zregenerowane typy klienta, ścisły schemat `Position` i walidator
  obu grupowań. Agregacja odrzuca pole rachunku, również `null`/`undefined`;
  nie podstawia identyfikatora. Nieznany koszt i P/L zachowują `null`.
  Cztery regresje obejmują warianty, błędne pola/kwoty i źródłowy kontrakt.
- Nie dodano jeszcze endpointu `listPositions`; testy walidatora nie są
  dowodem integracji HTTP/RLS ani wykonania agregacji rachunków.

## Weryfikacja lokalna

- `pnpm turbo run lint typecheck test --filter=...[origin/main] --output-logs=new-only`:
  **27/27 zadań PASS** (z wymaganymi buildami zależności); portfolio 34,
  API 92, jobs 11, web 20 testów PASS. Log lokalny `.git/m1-4b-checks.log`.
- Aktualność klienta API, Redocly, zgodność OpenAPI (50 wdrożonych / 135 pending),
  granice zależności, dokumentacja i `git diff --check` PASS.
- Nie wykonano E2E/Lighthouse nowych ekranów: ekrany jeszcze nie powstały.
  Końcowy jednorazowy odczyt CI po pushu w odpowiedzi sesji; brak deklaracji PASS CI.

## Blokada i następny krok

Zatwierdzona korekta rachunku jest wdrożona. Dalsze mapowanie portfela ujawniło
odrębną lukę: rdzeń i SQL dopuszczają brak wyceny, a wymagane kwoty REST nie.
P/L zrealizowany nie reprezentuje też wszystkich braków kosztu i danych podatkowych.
[Propozycja z dowodami i listą pól](m1-4b-valuation-contract-proposal.md)
czeka na decyzję właściciela zgodnie z AGENTS.md § 6.1; nie zastosowano jej do API.
R-37: ryzyko fałszywych zer/wyników lub ukrycia pozycji przy mapowaniu.

Odczyty summary/day-change/positions/lots/cash/realized nadal są pending;
BL-147 wymaga ich implementacji na istniejącym rdzeniu, z HTTP/RLS i testami luk.
Pozostała implementacja paczki niewykonana. BL-152: tylko health-checki, metryki
oraz raport błędów aplikacji; sondy Kuma pozostają u właściciela. Bez zmiany ADR.

## Brama A — dowody do zamknięcia

Nie ma jeszcze dowodu CI zamykającego M1-4b. Wcześniejsze raporty nie zastępują
walidacji tej paczki.

| Kryterium | Dowód automatyczny do zebrania | Odbiór właściciela |
|---|---|---|
| 1. XTB | fixtures importu/FIFO w CI | realny plik poza repo; salda/ilości, P/L do 0,01 PLN lub wyjaśnienie |
| 2. Import → portfel < 2 min | E2E rzeczywistego API w 3 przeglądarkach | telefon |
| 3. SSE/degradacja | ≤ 5 s, awaria adaptera, świeżość | GPW/NBP na serwerze |
| 4. Wydajność | JS/Lighthouse 4 tras, ≤ 3000 punktów | płynność telefonu |
| 5. Bezpieczeństwo | MFA, step-up, sesje, RLS, audyt CLI | polecenia awaryjne na serwerze |
| 6. Dostępność | axe, klawiatura, tabela wykresu | protokół VoiceOver |
| 7. ADR-001 | nakład dotąd niezmierzony | porównanie core/importu z estymacją |
