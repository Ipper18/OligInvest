# Zmiany kontraktu API

**Cel:** rejestrować zatwierdzone zmiany kontraktu API przed ich implementacją.

## 2026-11-14 — prawa z RODO: eksport i usunięcie konta (BL-114)

Pierwsza implementacja `createDataExport`, `getDataExport`, `downloadDataExport`, `getDeletionRequest`,
`requestAccountDeletion` i `cancelAccountDeletion` (usunięte z `openapi-pending.json`). Zmiany addytywne: odpowiedź
`202` operacji `createDataExport` ma nagłówek `Idempotent-Replayed` (jak inne operacje z `x-idempotency: required`);
opisy operacji dokumentują limity (jeden aktywny eksport, 10 na 24 h), jednorazowe pobranie, step-up po anomalii
masowego eksportu (BL-110) i brak bramki regulaminu dla praw z RODO. Parametr `QueueName` zyskuje wartość `identity`
(nowa kolejka eksportów i usuwania kont). `GET /me` wypełnia istniejące pole `deletionScheduledFor`. Bez zmian
łamiących zgodność i bez istniejących klientów produkcyjnych.

## 2026-11-13 — wyniki portfela (BL-303)

Pierwsza implementacja `getPerformance`: stopy `ReturnFigures` jako ciągi dziesiętne (decyzja właściciela), `period_too_short` dla XIRR poniżej 30 dni (decyzja 2026-09-24), 404 dla niewidocznego rachunku. Korekta przed wdrożeniem operacji, bez istniejących klientów produkcyjnych. Okres obejmuje przepływy od `from` włącznie, z poprzednim zamknięciem jako bazą; luki dają `null`. Parametry `instrumentId` i `benchmarkId` zwracają 422: wynik pozycji wymaga osobnej metodologii (decyzja właściciela 2026-11-13), benchmark pozostaje BL-304.

## 2026-10-06 — OHLCV (BL-138)

Decyzją właściciela `OhlcvSeries.o/h/l/c/v` używa `DecimalSeries` (ciągi `DecimalString` albo `null`) zamiast `NumberSeries`. Oś czasu i serie wskaźników nie zmieniają typu. Wszystkie obliczenia pozostają dziesiętne; konwersja do liczb wyłącznie przy rysowaniu canvas, bez obliczeń na tych liczbach. To korekta kontraktu przed pierwszą implementacją `getInstrumentChart` (operacja nadal w `openapi-pending.json`), bez istniejących klientów produkcyjnych wymagających migracji. Wygenerowany klient zostanie odświeżony w implementacji M1-2.
