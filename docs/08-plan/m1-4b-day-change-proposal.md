# M1-4b — propozycja rozbicia wyniku dnia

**Cel:** uzupełnić definicję FR-02.09 przed implementacją wkładów pozycji.

Status: zatwierdzone przez właściciela 2026-10-13, wraz z `residualChange`.

## Luka

`obliczenia-finansowe.md` § 5.1 definiuje tylko wynik całego portfela.
OpenAPI `DayChange.positions` nie definiuje mianownika `contributionRatio` ani
przypisania operacji dnia do instrumentów. § 10 opisuje inną miarę: atrybucję
na wagach z poprzedniego zamknięcia (FR-03.08). Nie obejmuje ona automatycznie
wyniku nowych i zamkniętych dziś pozycji ani kosztów i gotówki.
`read-service.ts` obecnie zwraca `null` dla każdego wkładu.

## Proponowana zmiana § 5.1 i opisów pól OpenAPI

- Dla instrumentu sumujemy rachunki objęte filtrem. Wiersze obejmują instrumenty
  posiadane na D−1, obecnie lub występujące w operacjach dnia (także zamknięte).
- Kwotowy wkład: wartość bieżąca minus wartość D−1 plus przepływy gotówki dnia
  przypisane temu instrumentowi (ze znakiem księgowym), minus wartość zewnętrznych
  transferów papierów. Obejmuje kupno/sprzedaż, dywidendy oraz przypisane koszty.
  Wszystkie składniki w PLN; przepływy według kursu ekonomicznego operacji,
  wyceny według kursów odpowiednio D−1 i dnia bieżącego.
- `contributionRatio` = wkład / (wartość portfela D−1 + przepływy zewnętrzne dnia),
  czyli wkład w stopę portfela, a nie procent całego zysku; baza ≤ 0 → `null`.
- Reszta wyniku (m.in. zmiana wyceny gotówki walutowej i koszty bez instrumentu)
  jest osobnym polem `residualChange: Money | null` i wierszem „Gotówka i pozostałe”.
  Suma wkładów i reszty równa się wynikowi dnia przed zaokrągleniem prezentacji.
- Brak ceny, kursu albo wyceny transferu → `null` zależnych wkładów i reszty,
  bez zastępowania zerem. Split nie jest zyskiem; rozliczamy zmianę ilości.
- `priceChangeRatio` i `fxChange` pozostają opcjonalne, bez heurystyki na froncie.

Po akceptacji: dokument źródłowy i OpenAPI → wektory (kupno, sprzedaż do zera,
dywidenda, prowizja, FX gotówki, transfer, split, luki) → funkcja w `packages/core`
→ odczyt REST z RLS → tabela na Start. Bez zmiany istniejącej definicji sumy dnia.
