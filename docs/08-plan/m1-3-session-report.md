# M1-3 — stan bieżący

**Cel:** przekazać stan BL-144, BL-145, BL-146 i BL-149 oraz decyzje potrzebne do integracji portfela z rdzeniem.

**2026-10-08**, `feat/m1-3-portfolio`, baza `main` = `97b6dd9`. BL-144: `w toku` (przegląd kontraktów); pozostałe zadania: `todo`. Implementacja zatrzymana zgodnie z AGENTS.md § 2.5 i § 6.1: dodatkowe rozbieżności w dokumentach źródłowych. BL-147/148 należą do M1-4.

## Zrobione i dowody

- Utworzono gałąź z aktualnego `origin/main`; katalog roboczy na starcie czysty. BL-108 gotowe; BL-143, BL-135 i BL-125 mają implementacje, więc spełniają zależności według § 6.1.
- Przejrzano raporty M1-2/core, zakres backlogu, bramy M1, wymagania portfela, formaty importu, wzory, kontrakty API/SQL i syntetyczne dane.
- Potwierdzono dodatkową rozbieżność fixtures przez `buildLedger`: zakupy AAPL 10 szt. za 9599,76 PLN i 5 za 3768,75 PLN, sprzedaż 12 za 10023,63 PLN oraz powiązana opłata SEC −0,28 PLN dają przychód 10023,35 PLN i P/L **−1083,91 PLN**. Nie zmieniono wzoru ani oczekiwanych wyników.

## Propozycje do decyzji właściciela

Trzy zmiany schematu wymienione w [raporcie rdzenia](m1-core-session-report.md) są już zlecone. Poniższe uzupełnienia wykraczają poza tamtą listę:

1. **Nieznany koszt.** OBL § 3.5 i rdzeń zwracają `null`, lecz `schema.sql`: `positions_daily.cost_basis NOT NULL`; OpenAPI: `Position.costBasis`, `unrealizedPl`, `Lot.costTotal` i wyniki zużycia partii nie dopuszczają `null`. Propozycja: dopuścić `null` w tych polach zależnych od kosztu, zachować wycenę pozycji i przekazywać ostrzeżenia rdzenia. Sumy kosztu/P/L obejmują tylko pozycje z kosztem, z jawną informacją o wyłączeniu pozostałych; bez podstawiania zera jako kosztu pozycji.
2. **Dywidenda.** OpenAPI `TransactionInput` wymaga dla DIVIDEND instrumentu i netto, lecz rdzeń wymaga także brutto w walucie wypłaty. Raport rdzenia wskazuje `gross = quantity × price`. Propozycja: wymagać dla DIVIDEND także `quantity`, `price`, `priceCurrency`; brutto liczyć przez `core.grossValue`. Brak danych wejściowych oznacza błąd walidacji, bez zgadywania brutto z netto.
3. **Fixture XTB i SEC.** `formaty-importu.md` § 7 oraz `fixtures/anonymized/oczekiwane-wyniki.json` wymagają −1083,63 PLN mimo osobnej opłaty SEC przypisanej sprzedaży. OBL § 4.4 nakazuje pomniejszyć przychód o tę opłatę. Propozycja: poprawić wynik fixture na −1083,91 PLN i przychód na 10023,35 PLN, uaktualnić README i § 7. Wektor A bez opłaty SEC zachowuje −1083,63 PLN. Saldo gotówki fixture bez zmian.

## Pozostałe warunki

Kod, migracje i testy M1-3 niepowstałe; brak podstaw do zamknięcia zadań lub bram M1. Po decyzji: dokumenty → testy → kod, commit/push po etapie; import wyłącznie na syntetycznych fixtures. Wynik anonimizacji prawdziwego pliku wymaga przeglądu właściciela przed commitem.

Odchylenie estymacji: brak ewidencji nakładu; oczekiwanie na decyzję osobno. Nowe ryzyko R-34: niespójne kontrakty integracji. Nowy ADR nie jest proponowany — korekty mają wdrożyć istniejące decyzje. Kontrole dokumentacji/repozytorium oraz jednorazowy wynik CI będą podane w PR; pełne DoD otwarte.
