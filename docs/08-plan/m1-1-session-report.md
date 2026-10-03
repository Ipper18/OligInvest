# M1-1 — stan bieżący

**Cel:** przekazać stan API i CLI uwierzytelniania oraz decyzję potrzebną do wznowienia implementacji; zamknięte kroki w [historii](m1-1-session-history.md).

**2026-10-03**, gałąź `feat/m1-1-auth` z `origin/main` (`52b3120`). Zakres: BL-101, BL-102, BL-103, BL-105, BL-106, BL-107, BL-108, BL-109, BL-111, BL-117. Ekrany pozostają w M1-4.

## Stan

Przeprowadzono wstępny przegląd kontraktów AUTH, SQL/RLS, OpenAPI auth/me, RBAC, CLI i zatwierdzonych spików BL-030/031. Fundamenty BL-006/007/009 oraz techniczne wyniki BL-030/031 są wykonane lokalnie; ich `w toku` nie blokuje zależności zgodnie z AGENTS §6.1. Kalibracja Argon2id na VM pozostaje zadaniem właściciela. Nie rozpoczęto kodowania ani nie usunięto operacji z `openapi-pending.json`.

## Rozbieżności i propozycja do zatwierdzenia

1. **Pierwsze konto:** [CLI §2–3](../12-dla-uzytkownika/instrukcja-administratora.md) i BL-102 wymagają pierwszego zaproszenia administratora. [SQL](../03-dane/schema.sql) wymaga `identity.invitations.invited_by NOT NULL REFERENCES auth.users(id)`. W pustej bazie nie ma zapraszającego; test RLS zaproszeń wcześniej tworzy administratora, więc nie sprawdza pierwszego startu.
   **Propozycja:** zgodnie z poleceniem właściciela dodać `pnpm admin:create-owner --email <adres> --name <nazwa> --reason <powód>`. Działa wyłącznie przy braku kont, z blokadą współbieżnych uruchomień. Hasło z ukrytego wejścia terminala, nigdy z argumentu; polityka haseł i Argon2id jak dla rejestracji. Jawne potwierdzenie kontroli adresu i akceptacji bieżących dokumentów, zapis zgód oraz audyt aktora `system`; brak pełnej sesji, TOTP nadal obowiązkowe przed dostępem do danych. `invite` służy kolejnym kontom. Uzgodnić AUTH, wymaganie FR-07.01 (wyjątek wyłącznie lokalnego bootstrapu), BL-102 i instrukcję CLI; nie tworzyć fikcyjnego użytkownika ani nie rozluźniać FK/RLS.
2. **Weryfikacja e-maila:** [AUTH §1.1](../06-bezpieczenstwo/uwierzytelnianie-autoryzacja.md) nadaje `emailVerified = true` na podstawie zaproszenia. Odpowiedź `200` operacji `authSignUpEmail` w [OpenAPI](../02-api/openapi.yaml) mówi o wysłaniu e-maila weryfikacyjnego.
   **Propozycja:** zachować AUTH; usunąć z opisu odpowiedzi obietnicę dodatkowego e-maila weryfikacyjnego. Test ma potwierdzać weryfikację przez ważne, jednorazowe zaproszenie przypisane do adresu.

Zmian dokumentów źródłowych jeszcze nie zastosowano. Implementację wstrzymano zgodnie z AGENTS §2.5 i §6.1; brak zgody nie oznacza wyboru któregokolwiek wariantu. Nowy ADR nie jest obecnie proponowany; jeśli właściciel wybierze inny model pierwszego konta, wymaga on ponownej oceny.

## Dalsza praca i ograniczenia

Po decyzji: kontrakty → testy → integracja Better Auth z PostgreSQL → zaproszenia/TOTP/sesje/step-up/reset → RBAC/audyt/CLI/flagi. Testy obejmą pustą bazę i wyścig bootstrapu, odmowy tras, izolację RLS oraz brak możliwości ominięcia MFA. Pełny DoD i zielone kontrole wymagane przed zamknięciem zadań.

Zadania pozostają `todo`; estymacje bez zmian, nakład niezmierzony. Ryzyko ujawnione w przeglądzie: nieprzetestowany bootstrap blokuje pierwszego właściciela. M1 pozostaje otwarty; brak nowych dowodów spełnienia bram A/B. Ten krok zmienia wyłącznie dokumentację planowania.
