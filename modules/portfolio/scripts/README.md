# Anonimizacja XTB (BL-149)

**Cel:** przygotować lokalną kopię eksportu XTB do przeglądu przed publikacją.

Skrypt lokalny odczytuje obsługiwany eksport XTB (XLSX/XLS/CSV) i buduje nowy
XLSX zawierający wyłącznie operacje gotówkowe. Nie kopiuje metadanych skoroszytu,
nazw osób, rachunków, identyfikatorów, opisów ani dodatkowych arkuszy. Instrumenty
dostają fikcyjne symbole, rachunek fikcyjny numer. Ceny powstają z losowej bazy
i niezależnego od wejścia przebiegu dla każdego instrumentu; ilości, opłaty,
dywidendy i kursy przeliczenia są syntetyczne. Kwoty transakcji wynikają z
syntetycznej ilości × ceny × kursu, z osobnymi wierszami opłat. Nie ma wspólnego
mnożnika kwot ani skalowania rzeczywistych cen. Sprzedaże nie przekraczają
syntetycznych zakupów, a wpłaty i transfery przychodzące pokrywają przyszłe
wydatki do następnego zasilenia z losowym zapasem, bez ujemnego salda gotówki.

Zachowana jest struktura: typy i kolejność wierszy w pliku, powiązania opłat,
pary operacji oraz rozpoznane formaty komentarzy. Daty, odstępy i godziny są
generowane od nowa, w kolejności chronologicznej, od poniedziałku do piątku
(bez odwzorowania świąt giełdowych). Powiązane wiersze nadal mają wspólny czas;
komentarze opłat odwołują się do nowych dat. Brakujące ilości dywidendy pozostają
brakujące. Eksport z ujemną pozycją bez wcześniejszego zakupu lub wydatkami bez
wystarczających wcześniejszych wpływów i bez wpłaty/transferu przychodzącego
jest odrzucany jako `ANONYMIZATION_INCOMPLETE_HISTORY`: zachowanie liczby i typów
wierszy nie pozwala uzupełnić brakującego salda początkowego.
Nierozpoznana operacja lub uszkodzony wiersz blokuje zapis. Obowiązują limity
rozmiaru i zakaz formuł parsera importu. Skrypt nie korzysta z sieci ani bazy.

Po instalacji zależności z lockfile i zbudowaniu modułu, z katalogu głównego:

```powershell
pnpm turbo run build --filter=@oliginvest/mod-portfolio --output-logs=new-only
node modules/portfolio/scripts/anonymize-xtb.mjs --input <plik-poza-repo> --output <nowy-plik-poza-repo.xlsx> --currency PLN
```

Waluta musi odpowiadać eksportowi (PLN/USD/EUR). Oba pliki muszą znajdować się
poza repozytorium; katalog wyniku musi istnieć. Skrypt nie nadpisuje plików,
nie zmienia oryginału, nie zapisuje mapowania ani nie wypisuje danych wejściowych.
Obsługuje obie generacje XTB; wynik ma jednolity nowy układ `Cash Operations`.
Nie jest anonimizatorem mBank — syntetyczne próbki mBank służą przyszłemu parserowi.

Zgodnie z [ADR-013](../../../docs/09-decyzje/ADR-013-repozytorium-publiczne.md)
§ Decyzja pkt 3 właściciel przegląda wynik **przed commitem**. Sprawdź wszystkie
komórki i właściwości pliku; kolejność i relacje operacji nadal odzwierciedlają
źródło. Dla danych szczególnie rozpoznawalnych użyj zamiast nich próbki w pełni
syntetycznej. Kwoty zmieniają się również w wyniku obliczeń: oczekiwane wyniki
fixture trzeba policzyć ponownie przez `packages/core`. Zatwierdzony plik można
ręcznie przenieść wyłącznie do `modules/portfolio/test/fixtures/anonymized/`.
Nie dodawaj oryginału do repozytorium, zgłoszenia ani opisu PR.
