# Worker analityki

**Cel:** opisać konsumenta kolejek `analytics-smoke` (BL-014) i `analytics` (kontrakty BL-311), konfigurację i lokalną weryfikację; logika analiz przychodzi od BL-313.

Wymagane Python 3.13 i uv 0.12.16. Pierwsza instalacja przypiętych wheels i lokalnego pakietu (z katalogu repozytorium):

```sh
uv sync --project apps/analytics --frozen --no-install-project --no-build --no-python-downloads
uv sync --project apps/analytics --frozen --no-build-isolation --no-python-downloads
pnpm --filter @oliginvest/analytics lint
pnpm --filter @oliginvest/analytics typecheck
pnpm --filter @oliginvest/analytics test
pnpm --filter @oliginvest/analytics build
```

Pierwszy krok instaluje także przypięty backend setuptools; drugi buduje wyłącznie lokalny pakiet z tym backendem. Karencja wynosi 3 dni, bez wyjątków. Build sdist i wheel działa offline, bez izolowanego rozwiązywania zależności.

`pnpm dev` uruchamia proces Python na hoście z przygotowaną konfiguracją. Samodzielnie: `python -m oliginvest_analytics`; sonda: to samo polecenie z `--health`. Wymagane jawne `NODE_ENV`, `VALKEY_QUEUE_HOST/PORT/USER`, `ANALYTICS_INSTANCE_ID`, `DB_ANALYTICS_RO_PASSWORD` i `VALKEY_QUEUE_ANALYTICS_PASSWORD` (w produkcji wyłącznie odpowiedniki `*_FILE`). Tryby development/test konsumują dodatkowo `analytics-smoke`, nazwę `ping` i zamknięty payload `{ version: 1, requestId: UUID }`; wynik potwierdza odbiór. Production nie uruchamia konsumenta testowego; wymaga też `DB_HOST/PORT/NAME/SSL` (dane rynkowe dla Monte Carlo jako `oliginvest_analytics_ro`). SIGINT/SIGTERM zamyka połączenia; sonda sprawdza Valkey oraz heartbeat instancji młodszy niż 10 s.

`pnpm queues:test` uruchamia prawdziwy Valkey z `compose.dev.yaml`, wysyła zadanie z Node i sprawdza wynik z Pythona. Fixture pytest blokuje TCP, UDP i rozwiązywanie nazw poza skonfigurowanym endpointem Valkey (z wyjątkiem lokalnej pary gniazd wymaganej przez asyncio w Windows). Nie dodano klienta HTTP. To ochrona procesu testowego; izolację systemową sprawdza `scripts/ci-images.mjs` na obrazach produkcyjnych: sonda [`infra/tests/analytics-isolation-probe.py`](../../infra/tests/analytics-isolation-probe.py) próbuje HTTP i TCP na zewnątrz oraz odczytów i zapisów poza danymi rynkowymi jako `oliginvest_analytics_ro`.

## Kontrakty zadań (BL-311)

Kontrakt: [moduly.md § 5.2.1](../../docs/01-architektura/moduly.md). `contracts.py` ładuje `schemas/analytics-jobs.schema.json` — eksport Zod z `packages/contracts` (`pnpm gen:analytics-schema`; plik generowany, nie edytować) — i dla każdego zadania kolejki `analytics`, przed jakimkolwiek przetwarzaniem, sprawdza kształt JSON (NaN, znaki sterujące, zagnieżdżenie), rozmiar, JSON Schema (`jsonschema`, draft 2020-12) i odpowiedniki `.refine`. Kwoty czyta `read_money` jako `Decimal`. `execution.py` uruchamia `python -I -m oliginvest_analytics.runner` bez sekretów w środowisku i zabija go po limicie czasu typu zadania; `runner.HANDLERS` ma Monte Carlo (BL-313, `montecarlo.py`); pozostałe typy kończą się `failed`/`INTERNAL` do swoich zadań. Rodzic czyta dane rynkowe (`market_data.py`), przekazuje je dziecku w żądaniu, raportuje postęp (`job.updateProgress`) i co 0,5 s sprawdza flagę anulowania. Wynik trafia do `analytics-results` z `jobId` = `runId`. Bez `eval`, `exec` i `pickle` (żądanie i wynik procesu potomnego to JSON).

## Wektory referencyjne (BL-015)

`oliginvest_analytics.vectors.load_test_vectors()` czyta ten sam plik A–H co
loader Vitest: `docs/03-dane/wektory-testowe.json`, względem pliku modułu,
nie katalogu roboczego. Wymaga checkoutu i instalacji editable powyżej;
wheel nie zawiera kopii danych. `read_decimal_text(value)` zachowuje tekst
kwoty, który można przekazać bezpośrednio do `Decimal`. `read_statistic(value)`
przyjmuje tylko liczby i odrzuca tekst kwoty. Tolerancje i ograniczenia API:
[README pakietu](../../packages/test-vectors/README.md).

`uv run --frozen --project apps/analytics pytest -q` uruchamia również porównanie
obu loaderów (wymaga Node 24): wszystkie klucze, długości tablic i wartości,
kwoty identyczne jako tekst. Żadne wzory finansowe nie są implementowane.
