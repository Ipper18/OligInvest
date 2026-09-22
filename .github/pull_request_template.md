## Cel i zadania

**Cel:** <!-- Problem i wynik zmiany, zwięźle po polsku. -->

- Zadania: <!-- BL-xxx; wymagania FR/NFR i dowody ich spełnienia. -->
- Zakres wykonany: <!-- Konkretne zachowanie. -->
- Zakres pominięty: <!-- Co i dlaczego; pozostałe zależności. -->

## Weryfikacja

<!-- Polecenia, wyniki i linki do CI. Nie zaznaczaj „CI zielone”, gdy nie zostało uruchomione.
     W M0-1 Lighthouse raportuje; CodeQL konfiguruje właściciel po scaleniu. -->

## Definition of Done — CONTRIBUTING.md § 3

<!-- Przy „nie dotyczy” podaj uzasadnienie; otwarte punkty pozostaw bez zaznaczenia. -->

- [ ] 1. Zakres i kryteria wymagań z backlogu spełnione; dowody wskazane.
- [ ] 2. Dokumentacja, statusy, odchylenia w backlogu i ryzyka zaktualizowane.
- [ ] 3. Testy jednostkowe, integracyjne z PostgreSQL/RLS, kontraktowe i e2e z axe wykonane odpowiednio do zmiany; core ≥ 90% linii i 100% wzorów.
- [ ] 4. Wymagane CI zielone: lint, typecheck, unit, contracts, db, build także bez modułów, budgets, e2e, lighthouse (bramka od M1), deps-audit; CodeQL przez konfigurację domyślną GitHub.
- [ ] 5. Zod strict, parametryzowane SQL, izolacja użytkowników, redakcja logów, allowlista połączeń i testy ASVS; brak sekretów, adresów IP oraz rzeczywistych danych.
- [ ] 6. Pieniądze/czas zgodne z ADR-014: decimal.js/Decimal/NUMERIC, jawna waluta, kwoty JSON jako ciągi.
- [ ] 7. Budżety tras dotrzymane; ciężkie biblioteki ładowane leniwie.
- [ ] 8. Dostępność: klawiatura, etykiety, kontrast, alternatywa tabelaryczna, reduced-motion, informacja niezależna od koloru.
- [ ] 9. Checklista zgodności i wymagany przegląd metodologiczny dołączone.
- [ ] 10. i18n: klucze komunikatów, brak literałów w komponentach, formatowanie Intl pl-PL.
- [ ] 11. Nowe zależności uzasadnione, wpisane do stosu/ADR, przypięte w lockfile; licencje i skrypty instalacyjne sprawdzone.

## Raport sesji

- Zrobione:
- Pominięte i dlaczego:
- Odchylenia estymacji (nakład osobno od oczekiwania kalendarzowego):
- Decyzje do ADR:
- Nowe ryzyka:
- Kryteria wyjścia etapu i dowody / brakujące dowody:

## Przegląd właściciela

- [ ] Właściciel przejrzał zakres, nowe zależności, zmiany testów i bezpieczeństwa.

<!-- Agent nie scala PR. Brakujące dowody wykluczają oznaczenie zadania jako gotowe. -->
