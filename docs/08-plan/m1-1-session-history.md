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

## 2026-10-03 — wznowienie i naprawa kontroli PR

- Zapisano i wypchnięto checkpoint fasady auth (`23905e9`), następnie wygenerowano klienta (`b5ef6a0`); contracts PASS.
- Raport images z run 37111698739: glibc 2.41-12+deb13u4 / CVE-2019-1010022 ma zakres bez `fixed`. Debian również wskazuje `(unfixed)`; obecny tag Node ma niezmieniony digest `8ec5d755…`. Nie ma podstaw do deklarowania poprawionej bazy.
- Rzeczywista odmowa skanera: brak oceny podatności Go w esbuild 0.18.20/0.25.12, dołączonych przez opcjonalne peers Better Auth (drizzle-kit/vitest). Usunięto nieużywane powiązania z produkcyjnego grafu, zachowując narzędzia deweloperskie, politykę OSV i digesty.
- Dodano kontrolę obrazu: brak narzędzi developerskich i import fasady auth. API lint/typecheck/test/build PASS; potwierdzenie obrazu przez CI oczekuje.

## 2026-10-03 — fasada auth: test integracyjny i rotacja

- Test na PostgreSQL sprawdza zaproszenie przypisane do adresu, rolę, zgody i obowiązkową bramkę MFA.
- Poprawiono odwzorowanie rotacji przy pierwszym TOTP: natywny JSON Better Auth wskazuje poprzednią sesję; fasada używa podpisanego Set-Cookie, zachowuje limit absolutny i usuwa duplikat ciasteczka.
- PASS: TOTP poprzedniego okna, odmowa powtórzenia, step-up i unieważnienie starego tokenu, wyścig kodów zapasowych (jeden sukces), blokada 5/15 min, reset hasła i unieważnienie sesji, ponowne użycie resetu, niedozwolone trasy, obcy Origin.
- `pnpm db:test`: RLS/pule PASS, adapter i fasada PASS, schema ZERO DIFFERENCES. Trasy nadal niezamontowane; API/CLI i testy całości paczki pozostają w toku.

## 2026-10-04 — bootstrap właściciela i fundament RBAC/flag

- `pnpm admin:create-owner`: ukryte hasło tylko w TTY, potwierdzenie adresu i dokumentów, polityka haseł/Argon2id, blokada pustej bazy, brak sesji, zgody i audyt systemowy.
- PostgreSQL PASS: równoczesny bootstrap daje dokładnie jedno konto; istniejące konto, słabe hasło, brak potwierdzenia i awaria audytu uniemożliwiają bootstrap; odczyt zgód i append-only audyt sprawdzone. `db:test` kończy się ZERO DIFFERENCES.
- `access.ts`: macierz uprawnień MOD §6 i ewaluator flag z TTL 30 s, regułami ról/użytkowników, przełącznikiem nadrzędnym oraz unieważnianiem cache; cztery testy jednostkowe PASS. Podłączenie do API/pub-sub pozostaje otwarte.
- API/platform lint, typecheck, test, build PASS. Checkpoint przed wdrożeniem zatwierdzonego przez właściciela rozróżnienia MFA i jednorazowego odzyskania urządzenia w ciągu 10 minut.

## 2026-10-04 — zatwierdzone odzyskanie TOTP

- AUTH §6/§9 oraz OpenAPI opisują jednorazowe odzyskanie w 10 min; migracja 0003 dodaje `mfa_method`, DTO odróżnia backup od TOTP przy autoryzacji.
- Backup + hasło zezwala tylko na wymianę czynnika; rozpoczęcie zużywa uprawnienie. W trakcie wymiany konto nadal wymaga 2FA — brak obejścia przez nowe logowanie samym hasłem.
- Zakończenie: rotacja sesji, usunięcie pozostałych, nowy zaszyfrowany komplet backupów zwracany raz, audyt i zdarzenia bezpieczeństwa; e-mail odzyskania zgodnie z decyzją właściciela w BL-110.
- Realny PostgreSQL PASS: granica 10 min, złe hasło, ponowne użycie uprawnienia, nowe kody i unieważnienie starych, audyt/zdarzenia oraz odmowy bramek zmiany hasła, eksportu/PAT/admina. Normatywny test uniemożliwia roli app sfałszowanie metody MFA.
- `db:test` ZERO DIFFERENCES; API/platform lint/typecheck/test/build, klient i kontrakty PASS. Nadal 3 operacje HTTP wdrożone / 182 pending — fasada czeka na montaż i testy tras.

### 2026-10-04 — HTTP i konfiguracja runtime
- Trasy auth i step-up zamontowane; przepływ odzyskania przechodzi przez HTTP, 403 dla każdej nowej trasy. Pending 182 → 167, klient wygenerowany, 25 testów kontraktów PASS.
- Runtime łączy pule auth/app oraz prywatny stan Valkey. Zaufanie X-Forwarded-For ograniczone CIDR bezpośredniego proxy. Testy API (79) i ACL Linux (3) PASS.
- Checkpointy HTTP i kontraktu osobno; walidator dopuszcza style/revert z testem, historia Git zachowana, tytuł PR zmieniony na feat(auth).
