# Szkielet analityki

**Cel:** opisać konsumenta testowej kolejki BL-014, konfigurację i lokalną weryfikację bez logiki analitycznej.

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

`pnpm dev` uruchamia proces Python na hoście z przygotowaną konfiguracją. Samodzielnie: `python -m oliginvest_analytics`; sonda: to samo polecenie z `--health`. Wymagane jawne `NODE_ENV`, `VALKEY_QUEUE_HOST/PORT/USER`, `ANALYTICS_INSTANCE_ID`, `DB_ANALYTICS_RO_PASSWORD` i `VALKEY_QUEUE_ANALYTICS_PASSWORD` (w produkcji wyłącznie odpowiedniki `*_FILE`). M0 nie łączy się z bazą. Tryby development/test konsumują tylko `analytics-smoke`, nazwę `ping` i zamknięty payload `{ version: 1, requestId: UUID }`; wynik potwierdza odbiór. Production nie uruchamia konsumenta testowego. SIGINT/SIGTERM zamyka połączenia; sonda sprawdza Valkey oraz heartbeat instancji młodszy niż 10 s.

`pnpm queues:test` uruchamia prawdziwy Valkey z `compose.dev.yaml`, wysyła zadanie z Node i sprawdza wynik z Pythona. Fixture pytest blokuje TCP, UDP i rozwiązywanie nazw poza skonfigurowanym endpointem Valkey (z wyjątkiem lokalnej pary gniazd wymaganej przez asyncio w Windows). Nie dodano klienta HTTP ani nowych zależności Pythona. To ochrona procesu testowego; izolacja systemowa analytics należy do M3 zgodnie z ADR-003 i [instrukcją dev](../../docs/07-wdrozenie/srodowisko-deweloperskie.md).

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
