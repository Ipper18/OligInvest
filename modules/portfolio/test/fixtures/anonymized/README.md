# Syntetyczne fixtures portfela

**Cel:** utrzymać bezpieczne próbki parserów i referencyjne wyniki portfela.

Wszystkie pliki powstały od zera z fikcyjnych danych; nie są wyciągami właściciela.
Przeniesiono je bez zmiany bajtów z `docs/03-dane/fixtures/anonymized/` w BL-149.

- `xtb/`: stary i nowy szablon tego samego rachunku PLN, 17 wierszy źródłowych,
  14 operacji po parowaniu, CFD jako korekta gotówki, opłata SEC i dywidenda
  wymagająca podania brakującej ilości 15 sztuk.
- `mbank/`: syntetyczne eksporty transakcji i finansów w Windows-1250; parser mBank
  należy do osobnego zadania.
- `oczekiwane-wyniki.json`: saldo XTB 14 518,27 PLN, P/L AAPL −1083,91 PLN
  (po SEC), PKO +181,20 PLN oraz ilości i koszty pozostałych pozycji.

Szczegóły i pochodzenie: [opis próbek](../../../../../docs/03-dane/fixtures/anonymized/README.md).
Testy parsera korzystają z obu generacji. Test PostgreSQL importuje nową,
uzgadnia wynik przez `packages/core` i weryfikuje, że stara jest w całości
duplikatem. Test anonimizatora sprawdza usuwanie metadanych i identyfikatorów,
zmianę dat/kwot oraz zachowanie par i odrzucanie nieobsługiwanych wierszy.

Nie edytuj binariów ani CSV zwykłym edytorem; `.gitattributes` zachowuje bajty.
Plik pochodzący z prawdziwego eksportu wymaga lokalnej
[anonimizacji i przeglądu](../../../scripts/README.md) przed dodaniem tutaj.
