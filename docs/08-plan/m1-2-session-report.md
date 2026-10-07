# M1-2 — stan bieżący

**Cel:** przekazać stan backendu danych rynkowych i SSE, dowody oraz blokadę zamknięcia paczki.

**2026-10-07**, `feat/m1-2-market`, [PR #9](https://github.com/Ipper18/OligInvest/pull/9). BL-125 i BL-131–139: `w toku` do zielonego CI i wspólnego DoD. Poprzedni raport opisywał stan sprzed implementacji. Zakres rozstrzygnięto w dokumentacji gałęzi: UI BL-157/158 i klient SSE w M1-4; OHLCV jako ciągi, NumberSeries tylko dla wskaźników.

## Zrobione i dowody

- BL-125: hub SSE, izolacja, replay/gap, heartbeat, subskrypcje, limity, scalanie notowań, cofnięcie sesji i sprzątanie. Rzeczywisty Valkey PASS; klient i awaryjne odpytywanie w BL-121.
- BL-131–134: port/rejestr, cache L1/L2 per użytkownik, trwałe limity, breaker i single-flight; NBP/ECB, GPW XLS, Yahoo, harmonogramy i backfill. Adaptery bez sieci i współbieżne limity Valkey PASS. NBP ponawia do 14:00, ECB po trzeciej awarii; GPW najwyżej jedno żądanie na sesję.
- BL-135–138: katalog, wyszukiwanie w tle, kalendarz/rozliczenia, API karty/statusu/kursów/wykresu, Decimal OHLCV, agregacja i limit 3000 punktów. PostgreSQL: kursor, ETag, auth, p95 katalogu <300 ms, sesje/DST/święta PASS. Dodano test T+1/T+2, przejścia UE, wpisu `[settlement:closed]` i brakującego kalendarza.
- BL-139: OHLC, duplikaty i skok >25%; trwały BLOCK blokuje analizy FR-04, dane pozostają z `data_quality_hold`. Testy jednostkowe i PostgreSQL PASS. Poprawiono wybór nowszego EOD przy starym intraday, także w tej samej sesji.
- Zmienione pakiety: 46/46 PASS; po poprawce API/market 16/16 PASS. Core: 99,53% linii. OpenAPI: 29 operacji, 156 pending; klient aktualny. Schemat: ZERO DIFFERENCES; RLS i pule PASS. Dokumentacja, repozytorium i granice modułów PASS.

## Audyt — diagnoza i blokada

Sharp 0.35.4 → 0.35.5 przez `pnpm update -r sharp`; frozen install PASS, bez overrides. GHSA-wq5f-xc86-pv6w zniknęło ze skanu.

Syft zapisywał URL SheetJS jako wersję, nie pokrywając `xlsx@0.20.3`. Audyt weryfikuje SHA-512 tarballa CDN, odczytuje wersję i Apache-2.0, uzupełnia CycloneDX. Dwa otwarte zakresy starej dystrybucji npm uzupełnia według [CVE-2023-30533](https://cdn.sheetjs.com/advisories/CVE-2023-30533) (poprawka 0.19.3) i [CVE-2024-22363](https://cdn.sheetjs.com/advisories/CVE-2024-22363) (0.20.2), tylko dla zweryfikowanego artefaktu. Surowe wyniki zachowane; nowe zgłoszenia blokują. Dziewięć testów polityki i Ruff PASS; `osv-scanner.toml` bez zmian.

Pełny audyt 666 pakietów ujawnił **isexe 3.1.5 / BlueOak-1.0.0**: Yahoo → @deno/shim-deno → which. `package.json` i `LICENSE.md` potwierdzają licencję spoza AGENTS.md §5.8. Nie dodano wyjątku. Pytanie o dopuszczenie tylko tej wersji przekazano właścicielowi; do decyzji deps-audit pozostaje BLOCK. Problem ujawniony po naprawie SBOM, nie skutek aktualizacji sharp.

## Pozostałe warunki

DoD i bramy M1 A/B otwarte. A.3: backend i testy SSE są, integracja wyceny/UI w M1-3/4; A.4: limit punktów jest, budżety ekranów wymagają UI. XTB, telefon, VoiceOver i wdrożenie w kolejnych paczkach. Bez nowych usług, kosztów i zmiany statusu prawnego; przegląd FR-04 nie dotyczy tej paczki.

Estymacje bez zmian; brak ewidencji odchylenia. Nowa blokada: licencja Yahoo (R-32), bez samodzielnej zmiany polityki/ADR. CI sprawdzane raz na końcu, bez czekania/pętli (§6.1); wynik w PR. Po decyzji: ewentualne dopuszczenie konkretnej wersji w audycie i stosie, ponowny deps-audit, zamknięcie DoD dopiero przy zielonych kontrolach.
