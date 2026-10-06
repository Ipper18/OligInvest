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

### 2026-10-04 — transport resetu hasła
- BL-107: zadanie notify z walidacją po obu stronach, fragment tokenu, wygaśnięcie 30 min, 3 próby i usunięcie sekretu z kolejki po zakończeniu; limit jednej wiadomości na adres/godzinę.
- Jobs wysyła przez nodemailer 10.0.13 (po karencji); produkcja wymaga Brevo/587/STARTTLS. Test SMTP na loopback PASS, bez wiadomości zewnętrznych.
- Lint/typecheck/test/build API/jobs/config/contracts/i18n PASS. SPF/DKIM/DMARC i test dostarczenia na instancji opisane dla właściciela; agent nie ma dostępu do DNS i sekretów.

### 2026-10-04 — zaproszenia, sesje, RBAC, CLI i flagi
- Osobne checkpointy zaproszeń (1746f03) i tożsamości (9a0fd75), wypchnięte; CI 9a0fd75 całe zielone. Pending 167 → 164, klient zgodny.
- Sesje: przybliżone IP, zakaz odwołania cudzej sesji; RBAC user/pro → 403, admin + TOTP → zapis audytu. Backup nadal nie otwiera admina.
- CLI administracyjne: walidacja, audyt zamiaru/wyniku, powód, zaproszenia, reset 2FA + powiadomienie, odwołania sesji/PAT, kolejki i flagi. Testy rzeczywistego SQL PASS.
- Flagi API/jobs z cache 30 s i flags.changed; test dwóch procesów na Valkey PASS. Skrypt maintenance z audytem i przywróceniem stanu Caddy — 4 testy Linux PASS.
- Poprawione własne odwzorowania: rehash hasła także przed wyzwaniem MFA, ograniczenie ciała zaproszenia wewnątrz audytu i identyfikator żądania. Dokumentacja operatora uzupełniona.
- Bramy M1 pozostają otwarte; czynności na VM/DNS należą do właściciela. Estymacje bez zmian, nakład niezmierzony, bez nowych decyzji ADR.

### 2026-10-05 — naprawa unit i workers na 9de4c65
- Import modułu jobs nie ładuje transportu SMTP ani runtime bazy; test regresji bez zwiększania limitu 5 s.
- Przyczyną startup_failed był filtr usuwający DB_HOST/PORT/NAME z procesu jobs. Filtr poprawiony; Mailpit skonfigurowany lokalnie z syntetycznymi danymi.
- Diagnostyka podaje klasę/kod i znaną nazwę zmiennej, bez message/stack/wartości; test redakcji PASS.
- Worker nie dziedziczy limitu 1,5 s producenta dla blokujących odczytów. Pełny pnpm dev:test i kolejka → worker → Mailpit PASS; brak błędów połączenia. Lint/typecheck/test/build jobs i zależności PASS.

### 2026-10-05 — końcowe testy sesji, audytu i idempotencji
- 6b9c86d: wszystkie kontrole zielone, w tym unit/workers/images. Pełny dev:test sprawdza kolejkę → worker → Mailpit i współbieżne liczniki Valkey z TTL.
- Sesje odnawiają termin DB i ciasteczko najwyżej raz na 24 h, nigdy ponad 30 dni; testy starej sesji i wygaśnięcia SQL PASS. Bramka modułu daje 404/200/404 po zmianach flagi.
- Audyt HTTP zawiera IP, UA, korelację, zasób i bezpieczny stan; CLI cel i stan przed/po bez tokenów. O-01 formalnie zamknięte według zatwierdzonej decyzji.
- Test wylicza natywne ścieżki Better Auth i odrzuca nieudostępnione; step-up obejmuje limit godzinowy. Liczniki Valkey mają atomowe TTL i odrzucają błędy transakcji.
- Właściciel zatwierdził odtworzenie zaproszenia przez 24 h: ten sam admin/klucz/treść, token HMAC bez jawnego zapisu. OpenAPI i konwencje poprawione, klient wygenerowany; pending nadal 164.

### 2026-10-05 — zamknięcie zakresu agentowego M1-1
- Zweryfikowano zielone CI kodu 6cd13f4, w tym unit/workers, kolejkę → Mailpit, DB/RLS i zgodność schematu; poprawki jobs były już wypchnięte.
- BL-101/102/103/105/106/108/109/111/117 gotowe; BL-107 czeka wyłącznie na DNS/doręczenia właściciela. R-30 zamknięte testami.
- Raport nadpisany, opis PR uaktualniony; przegląd właściciela i bramy M1 nadal otwarte. Estymacje bez zmian, bez nowych ADR/ryzyk.

### 2026-10-05 — poprawki przeglądu bezpieczeństwa M1-1
- Osobne commity: a866964 sesje bez tokenów/id+current; 607f649 timingSafeEqual każdego kodu; 9f768b9 rotacja podpisu ciasteczek; f247936 blokady zaproszeń.
- Lokalnie pełne 88/88 zadań PASS, API 92 testy, DB/RLS/fasada i współbieżność PASS; schemat ZERO DIFFERENCES, kontrakty/klient zgodne.
- R-31 otwarte: globalna blokada auth 730101 szereguje także niezwiązane konta. Kontrakt sesji i oczekiwanie idempotencji zatwierdzone; brak nowych ADR/usług/kosztów.
- Raport stanu nadpisany; bieżące CI w kontrolach PR #7. BL-107 i bramy całego M1 nadal otwarte z przyczyn opisanych w raporcie.
