# BL-314 + BL-316 — raport sesji

**Cel:** zapisać decyzje właściciela, zakres i wyniki weryfikacji paczki ekranów analiz (BL-314) i komunikatów roli/limitów (BL-316).

**2026-11-07**, gałąź `feat/bl-314-analysis-results`, baza `origin/main` `289f9fa`. Implementację
zaczął Codex (commit `023744b` + niezacommitowane ekrany); dokończył Claude Code w tym samym worktree.

## Decyzje właściciela (2026-11-07)

- **Metadane serii:** `AnalyticsRun.seriesMetadata` — lista `{ seriesKey, meta: DataMeta }`, addytywna i zgodna
  wstecz. Zbiera ją `jobs` przy finalizacji z lokalnych tabel rynku (nigdy z wyniku workera); starsze wyniki
  bez metadanych pokazują jawne „brak informacji o źródle i opóźnieniu danych”, bez domyślnego źródła
  i bez flagi świeżości. Ograniczenie odtwarzalności po korektach danych: R-55.
- **429:** `QUOTA_EXCEEDED` czyta sekundy z nagłówka `Retry-After` (względem nagłówka `Date` serwera)
  i pokazuje godzinę odnowienia w Europe/Warsaw; brak lub zły nagłówek = komunikat bez godziny. Bez zmiany API.
- **Ostrzeżenie kryzysowe:** `CRISIS_TESTS_SEPARATE` (UI obsługuje też historyczne `CRISIS_TESTS_UNAVAILABLE`);
  mapa ekranów zaktualizowana.
- **Zależność:** wyjątek wyłącznie dla `uplot` **1.6.32** (dokładnie przypięty), ładowanego tylko dynamicznie
  na ekranie wyniku; `budgets.json` zabrania `uplot` w trasach początkowych `/analizy` i `/analizy/*`.
- **Nawigacja:** pozycja „Analizy” (uprawnienie `analytics:run:light`) w obu drzewach nawigacji.

## Zakres

- `/analizy` (lista, limity dzienne, historia z kursorem), `/analizy/nowa/[typ]` (Monte Carlo, testy skrajne,
  kalkulator celu; podgląd założeń przed uruchomieniem), `/analizy/[runId]` (postęp z anulowaniem, wynik).
- Wynik: wachlarz P5–P95 (wykres uPlot + tabela jako alternatywa, P5 jako pierwsza kolumna), wartości
  nominalne/realne, P(celu) w modelu, rozkład maksymalnych obsunięć, tabela wrażliwości z wierszami
  `block_length`, „Jak czytać ten wynik”, ostrzeżenia, `<AssumptionsBlock/>`, `<DataFreshness/>` per seria,
  dane do odtworzenia (ziarno, wersja algorytmu, parametry, zakresy danych, biblioteki), `<Disclaimer analysis/>`.
- BL-316: rola `user` widzi typy ciężkie z wyjaśnieniem i bez przycisku uruchomienia; serwerowa akcja
  odrzuca rolę `user` przed wywołaniem API; moduł wyłączony flagą = 404 i brak pozycji w nawigacji.

## Zgodność (CLAUDE.md, `docs/11-zgodnosc-prawna.md` § 4.4)

- Brak zwrotów z § 4.1 (`check:ui-text` i test słownika zakazanych zwrotów przechodzą); brak trybu
  rozkazującego wobec instrumentów; brak wartości punktowych — wyniki to percentyle i przedziały.
- Kwoty księgowe (cel, wpłaty) jako ciągi `{ amount, currency }`; przeglądarka niczego nie liczy, tylko formatuje.
  Percentyle symulacji są liczbami JSON zgodnie z istniejącym kontraktem workera BL-313 — bez zmian w tym PR.

## Otwarte punkty

- Mapa ekranów oznacza `/analizy/[runId]` jako **W** (`<Explainer/>` przy metrykach). Słownik nie ma haseł
  „percentyl”, „Monte Carlo”, „maksymalne obsunięcie”; wyjaśnienia są w panelu „Jak czytać ten wynik”.
  Hasła słownika i `<Explainer/>` — osobne zadanie w module education.
- Wiersze wrażliwości pokazują przedział P5–P50 (kontrakt BL-313 nie ma P95 dla wariantów); główny wachlarz ma P5–P95.
- Lokalny `mypy --strict` na Windows zgłasza `os.killpg` (plik spoza zmian); z `--platform linux` jak w CI — czysto.

## Weryfikacja

Wyniki z tego worktree (Windows 11, Node 24, PostgreSQL 18 i Valkey z `compose.dev.yaml`) — w opisie PR.
Bez podnoszenia progów, bez retry i bez wydłużania timeoutów.

## Estymata

BL-314 2 d, BL-316 1 d — bez zmian; nakład niezmierzony. Bez nowego ADR (wyjątek zależności zapisany
w `stack-technologiczny.md`). Nowe ryzyko: R-55.
