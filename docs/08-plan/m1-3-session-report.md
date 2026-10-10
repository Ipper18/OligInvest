# M1-3 — stan bieżący

**Cel:** przekazać stan BL-144/145/146/149 i dowody potrzebne do dalszej pracy.

**2026-10-10**, `feat/m1-3-portfolio`, [PR #10](https://github.com/Ipper18/OligInvest/pull/10).
Implementacja paczki wykonana i wypchnięta. Zadania pozostają `w toku` do zielonego
CI i wspólnego DoD; stanowią spełnione zależności zgodnie z AGENTS.md § 6.1.

## Zrobione

- BL-144 (`915b7e9`): rachunki i operacje, walidacja przez core, kursor, idempotencja,
  blokada właściciela, rollback edycji/usunięcia tworzącego krótką pozycję, RLS.
- BL-145 (`a1003d9`): parser XTB w jobs, oba szablony i CSV, limity plików,
  podgląd, mapowanie, parowanie, uzgodnienie oraz atomowy commit. Ponowny import
  starego szablonu po nowym: 17 duplikatów, brak nowych operacji.
- Poprawki CI: `30cf668` — format Biome db; `1874895` — timeout testu 30 000 ms,
  zachowane 5000 wierszy i budżet 30 s.
- BL-146 (`4e01bca`, `cb839c9`): odbudowa FIFO, pozycji, gotówki i wycen;
  kolejka z deduplikacją i następcą aktywnego zadania, nocna odbudowa o 03:00,
  reakcja na EOD/FX, trwałe SSE po commit i osobna wycena bieżących notowań.
- BL-149 (`b112ea9`): syntetyczne XLSX/CSV przeniesione bez zmiany bajtów do
  `modules/portfolio/test/fixtures/anonymized/`; lokalny anonimizator XTB,
  instrukcja i testy. Wynik poza repo, bez nadpisania, do przeglądu właściciela.

## Dowody lokalne

PostgreSQL 18: migracje/schema ZERO DIFFERENCES, RLS, idempotencja i izolacja,
krótka pozycja po edycji, import/uzgodnienie/commit, replay przeliczenia,
nieznany koszt `null` z zachowaną wyceną oraz brak zapisu live do historii — PASS.
Fixture: gotówka 14 518,27 PLN; AAPL po SEC −1083,91 PLN. Roczna odbudowa
syntetycznej historii < 5 s; to pomiar tej próbki, nie całego limitu importu.

Lint/typecheck/test zmienionych API/jobs/portfolio — PASS; portfolio 18 testów,
API 92, jobs 11. Parser 5000 wierszy < 30 s. Rzeczywisty Valkey: deduplikacja,
następca aktywnego zadania i SSE z izolacją oraz osobnym oknem wyceny — PASS.
Kontrole dokumentacji, granic modułów i repo — PASS. Pełny `queues:test` doszedł
do części Node/Valkey; most Node→Python lokalnie niewykonany z powodu braku `uv`.
Pełne kontrole CI sprawdzane jednokrotnie przy zamknięciu sesji, wynik w PR.

## Pozostałe warunki

BL-147/148 (ekrany) należą do M1-4. Bramy M1 A/B nadal otwarte: brak realnego
lokalnego eksportu właściciela, testu telefonu i dowodów wdrożeniowych. Realne dane
nie były używane; ich anonimizacja wymaga przeglądu przed publikacją (ADR-013).

Decyzje o `null`, brutto dywidendy i wyniku −1083,91 PLN są wdrożone;
nie oczekują ponownej zgody. Nowy ADR: brak. R-34 usunięte przez zgodność
kontraktów i testy integracyjne; pozostałe ryzyka R-07/R-10 wymagają pomiarów
na docelowych danych/środowisku. Nakład nieewidencjonowany; odchylenie niezmierzone.
