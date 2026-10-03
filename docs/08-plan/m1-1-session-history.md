# M1-1 — historia sesji

**Cel:** zachować krótkie podsumowania zamkniętych kroków paczki; bieżący stan i następny krok opisuje [raport](m1-1-session-report.md).

## 2026-10-03 — przegląd wejściowy

- Utworzono `feat/m1-1-auth` z aktualnego `origin/main` (`52b3120`), przy czystym katalogu roboczym.
- Potwierdzono zatwierdzenie spików BL-030/031 oraz lokalne wykonanie zależności M0.
- Wykryto niemożność pierwszego zaproszenia w pustej bazie i niespójny opis weryfikacji e-maila.
- W raporcie zapisano propozycję CLI `create-owner` i korekty opisu OpenAPI; dokumenty źródłowe i kod bez zmian do decyzji właściciela.
- Żadnego zadania implementacyjnego ani kryterium wyjścia M1 nie uznano za zakończone.
- Właściciel zatwierdził obie propozycje; zaktualizowano AUTH, FR-07.01, kontrakt CLI, BL-102 i opis odpowiedzi OpenAPI. Bez zmiany SQL/RLS i ADR.

## 2026-10-03 — adapter SQL i polityka haseł (część BL-101/103/105)

- Better Auth 1.7.5 używa Drizzle w transakcji puli `oliginvest_auth`; zależności auth przeniesione do produkcyjnych, nowy adapter MIT przypięty, instalacja frozen.
- 11 testów polityki haseł/Argon2id/TOTP PASS; publiczna lista 10000 popularnych haseł z SecLists (MIT), HIBP bez sieci w testach.
- PostgreSQL 18: rejestracja przez adapter, PHC, ciasteczka, szyfrowanie TOTP i kodów oraz rotacja klucza PASS; RLS/pule PASS, pełne porównanie schematu ZERO DIFFERENCES.
- Trasy niezamontowane do czasu ukończenia bramek; pending bez zmian. Nie zamknięto zadań paczki.
