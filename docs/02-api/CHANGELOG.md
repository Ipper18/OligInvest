# Zmiany kontraktu API

**Cel:** rejestrować zatwierdzone zmiany kontraktu API przed ich implementacją.

## 2026-10-06 — OHLCV (BL-138)

Decyzją właściciela `OhlcvSeries.o/h/l/c/v` używa `DecimalSeries` (ciągi `DecimalString` albo `null`) zamiast `NumberSeries`. Oś czasu i serie wskaźników nie zmieniają typu. Wszystkie obliczenia pozostają dziesiętne; konwersja do liczb wyłącznie przy rysowaniu canvas, bez obliczeń na tych liczbach. To korekta kontraktu przed pierwszą implementacją `getInstrumentChart` (operacja nadal w `openapi-pending.json`), bez istniejących klientów produkcyjnych wymagających migracji. Wygenerowany klient zostanie odświeżony w implementacji M1-2.
