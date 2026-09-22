# M0-1 — stan bieżący

**Cel:** przekazać stan i następny krok. Nadpisywany po sesji; [historia](m0-1-session-history.md) najwyżej 5 linii na sesję.

**2026-09-22**, gałąź `feat/m0-1-skeleton`, [roboczy PR #2](https://github.com/Ipper18/OligInvest/pull/2), bez scalania. Node 24.21.0, pnpm 12.4.2, Python 3.13.13, uv 0.12.16. Zadania wykonane lokalnie: status `w toku` do wspólnego DoD/CI.

| Zakres | Stan |
|---|---|
| BL-001/002, BL-005/006 | wykonane lokalnie |
| BL-003 | `6d733ca`: granice modułów, 28 testów; [CI PASS](https://github.com/Ipper18/OligInvest/actions/runs/35688610340) |
| BL-004 | `6003611` + `042540c`: generator, 21 testów; [CI PASS](https://github.com/Ipper18/OligInvest/actions/runs/35689454452) |
| BL-007/008 | 64 tabele, migracje, RLS i pule; [CI PASS](https://github.com/Ipper18/OligInvest/actions/runs/35687884119) |
| BL-015 | wykonane lokalnie: loader TS (`bfa39c5`, push) i Python, test zgodności A–H; bieżący commit zawiera Python i stan sesji |
| BL-009–014, BL-016, BL-033 | todo; BL-014 nie realizowano, Lighthouse dopiero BL-016 |
| BL-017/019 | szkice pozostałego CI i ustawień; aktywne db i modules |
| BL-018 | lokalne E2E i obrazy M0-2: todo |
| BL-032 | zamknięty technicznie [spike](bl-032-typescript-7-spike.md) |
| BL-034/035 | Compose i dokumentacja PASS; brak seedów/integracji/pełnego CI |

BL-015: jedyne źródło `docs/03-dane/wektory-testowe.json`, bez kopii. Loadery zachowują tekst kwot i zera końcowe, statystyki jako liczby zgodnie z `_meta.method`; `readDecimalText` / `read_decimal_text` i `readStatistic` / `read_statistic` pilnują typów. Jawne konwersje tekstu poza tym API pozostają zabronione. Tolerancje § 0.5 wyeksportowane bez obliczeń finansowych. Test pytest porównuje oba loadery z innego katalogu roboczego: wszystkie klucze, długości tablic, wartości i dokładny tekst kwot. Negatywne testy wykrywają liczbę zamiast kwoty oraz brak klucza. Turbo uwzględnia źródłowy JSON i zależność testu Python od loadera TS.

Dowody tej sesji: **7 testów Vitest + 6 pytest PASS**; pełne **lint/typecheck/test/build 88/88 PASS bez cache**. Bez nowych plików raportów i zależności. Poprzednie dowody: 69 testów skryptów PASS; generator w izolacji 5/5 PASS; build bez education 21/21 PASS. Kryterium M0 nr 1 spełnione lokalnie; pełna macierz CI pozostaje w BL-017.

Pominięte zgodnie z zakresem: BL-014 (właściciel dopuścił szkielet BL-002 jako wystarczający), wzory finansowe (M1/M3), pozostałe zadania M0. Estymacja BL-015 0,5 d bez zmian, odchylenie nakładu niezmierzone. Brak nowych ryzyk i decyzji do ADR.

Decyzje bez zmian: Turbo 2.10.13 (ADR-015), TypeScript 7 strict + skipLibCheck, karencja bez wyjątków, sieć dev internal:false/loopback, wyjątek OSV esbuild do 2026-12-20 (R-24), ruleset 0 zatwierdzeń i przegląd właściciela.

Dalej: pozostałe zadania paczki, pełne CI w BL-017. M0 nadal otwarty: 1 lokalnie PASS, 2 CI PASS, 3 otwarte, 4–7 dalsze prace/działania właściciela, 8 częściowo. Lokalny uv: `.git/tools/uv-0.12.16/uv.exe` (dopisz katalog do PATH).
