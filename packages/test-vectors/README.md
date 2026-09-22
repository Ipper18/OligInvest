# Wektory referencyjne

**Cel:** udostępniać przykłady A–H testom Vitest i pytest bez kopiowania danych.

Jedynym źródłem jest `docs/03-dane/wektory-testowe.json`. `loadTestVectors()`
czyta je względem lokalizacji loadera (zarówno `src`, jak i `dist`), niezależnie
od katalogu roboczego. Pakiet wymaga checkoutu repozytorium z katalogiem `docs`.
Każdy odczyt zwraca nowy obiekt zawierający `_meta` i osiem przykładów.

```js
import { loadTestVectors, readDecimalText, readStatistic } from '@oliginvest/test-vectors';
const vectors = loadTestVectors();
const amount = readDecimalText(vectors.G_dividend.gross_usd); // "25.00"
const sharpe = readStatistic(vectors.D_risk.sharpe_rf0);
```

Teksty zachowują wszystkie cyfry i zera końcowe; można przekazać je bezpośrednio
do `decimal.js` / `Decimal`. `readStatistic` odrzuca tekst, a `readDecimalText`
odrzuca liczby. Nie używaj `Number`, `parseFloat` ani `float` do konwersji kwot:
prymitywny tekst nie blokuje jawnej konwersji poza tym API. Loader odrzuca także
liczby w sekcjach tekstowych A, F, G, H oraz w B poza polem `days`.
Sekcje C–E zachowują liczby statystyczne zgodnie z `_meta.method`.

`TOLERANCES` odwzorowuje § 0.5 `obliczenia-finansowe.md`: kwoty dokładnie po
zaokrągleniu do grosza, stopy względnie 1e-9, XIRR absolutnie 1e-6 (ułamek),
metryki ryzyka 1e-6, wskaźniki 1e-8. Loader nie zaokrągla i nie liczy wzorów;
porównanie odczytanych danych między językami jest dokładne, bez tolerancji.
