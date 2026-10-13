# M1-4b — brakujące wartości w odpowiedziach portfela

**Cel:** rozstrzygnąć reprezentację luk danych przed implementacją odczytów
REST i ekranów BL-147, bez podstawiania zera i bez pomijania posiadanych instrumentów.

Status: propozycja do zatwierdzenia, 2026-10-13. Nie zmienia źródłowego OpenAPI.
Zgoda na opcjonalne `Position.accountId` została wdrożona niezależnie.

## Dowody rozbieżności

1. `packages/core/src/valuation.ts`: `PositionValuation.marketValue` jest `null`,
   gdy brakuje ceny lub kursu; wycena portfela ujawnia `gaps` i `isComplete=false`.
   Test `packages/core/test/portfolio.test.mjs`, przypadek
   `missing price or FX rate is a gap, never a silent zero`, egzekwuje ten stan.
   `modules/portfolio/src/recompute.ts` zapisuje takie wartości jako `null`.
   W OpenAPI `Position.marketValue` i `marketValueBase` są wymaganym `Money`,
   a `weight` wymaganym `number`; nie można zwrócić pozycji bez jej wyceny.
2. `PortfolioSummary.isComplete` dopuszcza brak ceny lub FX. Jednocześnie
   `PortfolioSummary.dayChange` i kwoty w `DayChange` nie dopuszczają `null`.
   Wynik dnia wymaga pełnych V(t), V(D−1) i przepływów dnia. Różnica sum częściowych
   mogłaby udawać stratę lub zysk. Także `accounts[].totalValueBase` nie ma
   reprezentacji brakującego kursu do waluty bazowej.
3. Decyzja z 2026-10-08 w `obliczenia-finansowe.md` § 3.5 nakazuje `null`
   dla nieznanego kosztu i zależnych P/L oraz sumy z jawnymi wyłączeniami.
   `RealizedPl.rows[].cost/realizedPl` nie dopuszczają `null`, a odpowiedź
   nie zawiera wyłączeń. Rdzeń `RealizedSale` rozróżnia nieznany koszt,
   `taxStatus=missing_data` i `taxStatus=not_applicable` (IKE/IKZE).

## Proponowany kontrakt

| Miejsce | Zmiana |
|---|---|
| `Position.marketValue`, `marketValueBase` | `Money \| null`; brak ceny/FX zachowuje instrument i ilość w odpowiedzi |
| `Position.weight` | `number \| null`; brak pełnego mianownika lub wyceny pozycji → `null` |
| `PositionsResponse` | wymagane `isComplete: boolean`; niepełne sumy jawnie oznaczone |
| `PortfolioSummary.dayChange` | `Money \| null`; `dayChangeRatio=null`, gdy brak pełnych danych wyniku dnia |
| `PortfolioSummary.accounts[].totalValueBase` | `Money \| null` przy braku konwersji; wartość znana w walucie rachunku pozostaje |
| `DayChange.change`, `previousValue`, `currentValue`, `flowsToday` | `Money \| null`; brak składnika → `change=null` i `changeRatio=null` |
| `DayChange.positions[].change`, `contributionRatio` | odpowiednio `Money \| null`, `number \| null`; nie wyliczać wkładu z niepełnej wartości |
| `RealizedPl.rows[]` | `cost`, `realizedPl`, `proceeds`: `Money \| null`; pole `status`: `complete`, `missing_cost`, `missing_fx`, `missing_tax_data`, `not_applicable` |
| `RealizedPl` | wymagane `isComplete: boolean` i `exclusions` jako lista `{transactionId, accountId, instrumentId, reason}`; `reason` = jeden ze statusów poza `complete` |

Sumy P/L/kosztu/przychodu w `RealizedPl.totals` obejmują ten sam zbiór kompletnych
operacji; wyłączone operacje pozostają w `exclusions`. Grupa z wyłączonymi
operacjami ma zależne kwoty `null`; status i wyłączenia wyjaśniają przyczynę.
W widoku podatkowym IKE/IKZE oznacza „nie dotyczy”, nie wynik zerowy.

`PortfolioSummary` i `PositionsResponse.totals` zachowują częściowe sumy oraz
istniejące wyłączenia kosztów; UI nazywa je częściowymi. `DataMeta.stale=true`
i `staleReason=no_data` oznaczają lukę wyceny; brak kosztu nie zmienia świeżości
samego notowania. Dane dostępne wcześniej pozostają widoczne.

Po zatwierdzeniu: osobny commit dokumentacyjny, aktualizacja typów i Zod,
testy braku ceny/FX/kosztu, niepełnego D−1 oraz IKE/IKZE, następnie odczyty REST
i ekrany. Nie wymaga to nowego ADR ani zmiany wzorów finansowych.
