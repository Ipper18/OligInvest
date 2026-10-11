# M1-4a — stan bieżący

**Cel:** przekazać stan BL-121/122/113/116 i rozbieżności wymagające decyzji przed implementacją.

**2026-10-11**, gałąź `feat/m1-4a-ui-shell` z aktualnego `main` (`7ccffc8`).
Zakres: powłoka, uwierzytelnianie, preferencje i strony prawne. BL-147/148/152/154/155/157/158
pozostają w M1-4b. Nakład i odchylenie niezmierzone; żadne zadanie nie jest zamknięte.

## Zrobione

- Sprawdzono czyste repozytorium, pobrano `origin/main`, utworzono wskazaną gałąź.
- Odczytano raport M1-3, zakres backlogu, DoD, wymagania i dokumenty frontendowe.
- BL-102/103 są gotowe; BL-107 ma gotowy zakres API, czeka na produkcyjną pocztę.
  Zależności lokalnie wykonane uznajemy zgodnie z AGENTS.md § 6.1.
- Porównano klienta SSE z interfejsem platformy, API tożsamości i listą pending.
  Implementacja zatrzymana zgodnie z AGENTS.md § 2.5 i § 6.1.

## Decyzje do zatwierdzenia — propozycja

1. **SSE:** RT § 6 wymaga `EventSource`, ale także odtworzenia po `close()` z zachowanym
   `Last-Event-ID` oraz odczytu 401/403/429 i `Retry-After`. Natywny konstruktor nie
   przyjmuje nagłówków, nowy obiekt zaczyna z pustym ID, a błąd nie udostępnia odpowiedzi
   HTTP ([HTML Standard, sprawdzono 2026-10-11](https://html.spec.whatwg.org/multipage/server-sent-events.html#the-eventsource-interface)).
   Automatyczne wznowienie tego samego obiektu działa, ręczne odtworzenie go nie zastępuje.
   Propozycja: nowy ADR uzupełniający ADR-007, klient SSE na natywnym `fetch` i
   `ReadableStream`, bez biblioteki. Zachować endpoint, ramki, cookie, bramki i nagłówek
   wznowienia; jawnie obsłużyć parser, ponawianie, czuwanie, tło i polling.
   Zaktualizować RT i UI; testować fragmentację ramek, wznowienia, statusy i budżet 30 KiB.
2. **Akceptacja regulaminu:** BL-122 wymaga działającego ekranu, ale `getLegalStatus`
   i `acceptLegalDocuments` są w `apps/api/openapi-pending.json`; implementacja należy
   do BL-104 planowanego dopiero w M1-5. Bramka istnieje w `AuthService.requireData`.
   Propozycja: przenieść do M1-4a wyłącznie te dwa endpointy i ich testy z BL-104,
   dodać tę zależność BL-122. Pozostała część BL-104, w tym zarządzanie zgodą na
   diagnostykę, pozostaje M1-5; BL-104 nie otrzyma statusu gotowe.
3. **Motyw domyślny:** DS § 7 i wymagania nakazują `dark`, natomiast
   `schema.sql` (tabela `identity.user_preferences`) ma `DEFAULT 'system'`, a fallback
   `GET /me` również zwraca `system`. Propozycja: zmienić domyślną wartość schematu na
   `dark`, dodać migrację samego DEFAULT i poprawić fallback API. Zachować wszystkie
   zapisane preferencje, także `system`; nie da się odróżnić wyboru od starej wartości
   domyślnej. Brak zmiany enum, RLS i kontraktu odpowiedzi.

## Weryfikacja i pozostała praca

Zmiana obejmuje wyłącznie dokumentację startową i zapis ryzyka R-35; bez kodu produktu.
`node scripts/check-docs.mjs`, `node scripts/check-repository.mjs` i `git diff --check`
PASS. CI sprawdzane raz na końcu sesji. Budżety, axe, bramki i testy ekranów
nie są jeszcze wykonane.
Po decyzji: dokumenty → testy → implementacja; commit/push po każdym etapie.
Bramy M1 A/B pozostają otwarte, także realny import, telefon i wdrożenie.
