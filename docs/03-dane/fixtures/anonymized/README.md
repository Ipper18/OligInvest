# Pliki przykładowe importu (syntetyczne)

**Cel:** dostarczyć parserom importu (XTB, mBank) pliki wejściowe o realistycznym układzie oraz oczekiwane wyniki, zanim dostępne będą prawdziwe, zanonimizowane wyciągi.

- Wszystkie dane są **fikcyjne** (osoby, numery rachunków, kwoty, identyfikatory). Układ plików odtwarza formaty opisane w [`../../formaty-importu.md`](../../formaty-importu.md).
- Wygenerowano 2026-09-19 skryptem pomocniczym (poza repozytorium); oczekiwane wyniki policzono w arytmetyce dziesiętnej zgodnie z [`../../obliczenia-finansowe.md`](../../obliczenia-finansowe.md) (FIFO per rachunek, widok ekonomiczny).
- Docelowe miejsce w kodzie: `modules/portfolio/test/fixtures/anonymized/` (przeniesienie w M1). Reguła CI z [ADR-013](../../../09-decyzje/ADR-013-repozytorium-publiczne.md): pliki `.xlsx`/`.csv` są dozwolone wyłącznie w katalogach `**/fixtures/anonymized/**`.

## Zawartość

| Plik | Format |
|---|---|
| `xtb/xtb-syntetyczny-nowy-szablon-PLN.xlsx` | XTB, szablon nowy: arkusz `Cash Operations`, nagłówek w wierszu 5, kolumny `Type, Ticker, Instrument, Time, Amount, ID, Comment, Product` |
| `xtb/xtb-syntetyczny-stary-szablon-PLN.xlsx` | XTB, szablon stary: `CASH OPERATION HISTORY` (nagłówek w wierszu 12, pusta kolumna A), `CLOSED POSITION HISTORY` (z pozycją CFD), `OPEN POSITION 31122025` |
| `mbank/mbank-syntetyczny-historia-transakcji.csv` | mBank eMakler, Windows-1250, `;`, metadane nad nagłówkiem |
| `mbank/mbank-syntetyczny-historia-finansowa.csv` | mBank eMakler, `Data;Opis;Kwota`, kwoty z przecinkiem dziesiętnym i spacją tysięcy |
| `oczekiwane-wyniki.json` | wynik oczekiwany po imporcie (poniżej skrót) |

## Oczekiwane wyniki — skrót

**XTB (oba szablony — identycznie):** gotówka końcowa **14 518,27 PLN**; pozycje: AAPL.US 3 szt. (koszt 2 261,25 PLN), PKO.PL 15 szt. (koszt 1 000,60 PLN; partie 5 szt. z 2025-01-13 i 10 szt. z 2025-11-05), VWCE.DE 0,75 szt. (384,41 PLN); P/L zrealizowany: AAPL.US −1 083,63 PLN (przykład A), PKO.PL +181,20 PLN; dywidenda AAPL.US brutto 14,28 / podatek 2,14 / netto 12,14 PLN; odsetki 12,34 PLN i podatek 2,34 PLN; opłata SEC 0,28 PLN; wiersz CFD `US500` (+45,10 PLN) → `unsupported`, zaksięgowany jako `ADJUSTMENT(cfd_pl)`; ponowny import → wyłącznie duplikaty.

**mBank:** KGHM — pozostają 3 szt. (koszt 423,00 PLN), P/L sprzedaży z 2025-09-03: +123,00 PLN (prowizje w koszcie i przychodzie); dywidenda KGHM brutto 45,00 / podatek 8,55 / netto 36,45 PLN; wpłata 5 000,00 PLN; blokady i rozliczenia T+2 pominięte; wiersz MICROSOFT bez wartości → ostrzeżenie `missing_settlement_value`.
