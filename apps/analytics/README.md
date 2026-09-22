# Szkielet analityki

**Cel:** opisać pusty pakiet Python BL-002 i jego lokalną weryfikację; konsument kolejki powstaje w BL-014.

Wymagane Python 3.13 i uv 0.12.16. Pierwsza instalacja przypiętych wheels i lokalnego pakietu (z katalogu repozytorium):

```sh
uv sync --project apps/analytics --frozen --no-install-project --no-build --no-python-downloads
uv sync --project apps/analytics --frozen --no-build-isolation --no-python-downloads
pnpm --filter @oliginvest/analytics lint
pnpm --filter @oliginvest/analytics typecheck
pnpm --filter @oliginvest/analytics test
pnpm --filter @oliginvest/analytics build
```

Pierwszy krok instaluje także przypięty backend setuptools; drugi buduje wyłącznie lokalny pakiet z tym backendem. Karencja wynosi 3 dni, bez wyjątków. Build sdist i wheel działa offline, bez izolowanego rozwiązywania zależności. Pakiet nie uruchamia kolejki, nie łączy się z bazą ani z siecią.

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
