# Anonimizacja XTB (BL-149)

**Cel:** przygotować lokalną kopię eksportu XTB do przeglądu przed publikacją.

Skrypt lokalny odczytuje obsługiwany eksport XTB (XLSX/XLS/CSV) i buduje nowy
XLSX zawierający wyłącznie operacje gotówkowe. Nie kopiuje metadanych skoroszytu,
nazw osób, rachunków, identyfikatorów, opisów ani dodatkowych arkuszy. Instrumenty
dostają fikcyjne symbole, rachunek fikcyjny numer, kwoty i ilości losowe mnożniki,
a wszystkie daty wspólne losowe przesunięcie. Zachowuje znaki, kolejność,
powiązania opłat i pary operacji; brakujące dane dywidendy pozostają brakujące.
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
