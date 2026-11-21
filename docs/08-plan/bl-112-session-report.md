# BL-112, BL-501, BL-509 — stan sesji

**Cel:** przekazać stan powłoki administratora `/admin` (użytkownicy bez danych finansowych, zaproszenia, role, sesje, blokada, reset 2FA, usunięcie konta; FR-08.01, FR-08.02), decyzje podjęte w trakcie, dowody weryfikacji i pytania do właściciela.

**2026-11-21**, gałąź `feat/bl-112-admin-shell`, worktree `OligInvest-wt/bl-112-admin`, baza: `main`. Status `w toku` do zielonego CI i przeglądu właściciela.

## Zakres

- **Baza (migracja 0013):** `identity.deletion_requests.requested_by` (`user`/`admin`) z restrykcyjną polityką RLS — użytkownik widzi wniosek administratora, ale nie może go anulować ani podrobić. Funkcje `SECURITY DEFINER`: `admin_schedule_deletion`, `admin_cancel_deletion`, `admin_deletion_status` (tylko kontekst admina, bez własnego konta). Testy w `testy-rls.sql`.
- **API (`apps/api/src/admin-user-routes.ts`):** `adminListUsers`, `adminGetUser`, `adminUpdateUser` (rola, e-mail, blokada), `adminDeleteUser`, `adminCancelUserDeletion`, `adminResetTwoFactor`, `adminRevokeUserSessions`, `adminListInvitations`, `adminRevokeInvitation`, `adminListSessions`, `adminRevokeSession`. Każda operacja przechodzi przez `Administration.http`: sesja z 2FA → rola (`FORBIDDEN`) → step-up dla zmian (`STEP_UP_REQUIRED`) → audyt (także odczytów i nieudanych prób). Flaga `module.admin` i build bez modułu admin → `404`. Operacje usunięte z `openapi-pending.json`, dopisane do `openapi.test.mjs` i `health.test.mjs`.
- **Odczyty bez danych finansowych:** `modules/admin/src/server/users.ts` czyta wyłącznie `auth.users`, `auth.sessions`, `identity.invitations` i `identity.deletion_requests` (`ADMIN_READ_TABLES`). Dowody: test statyczny `modules/admin/test/no-financial-data.test.mjs` (żaden plik serwera admina nie nazywa schematów domenowych) oraz test PostgreSQL w `apps/api/integration/admin-users.mjs` — przechwytuje każde zapytanie SQL obu połączeń podczas wszystkich odczytów i zmian administratora i sprawdza, że żadne nie dotyka `portfolio`, `market`, `analytics`, `alerts`; konto z rachunkiem-znacznikiem nie pojawia się w żadnej odpowiedzi, a rola auth dostaje `42501` na tabelach portfela.
- **Zmiana e-maila (decyzja właściciela 2026-11-21):** step-up, audyt (bez adresów), zadanie `auth.email-changed` na stary i nowy adres (PL/EN wg języka konta, ważne dobę), alert do wszystkich aktywnych administratorów, unieważnienie wszystkich sesji; własnego adresu nie da się zmienić tą ścieżką (`409`), zajęty adres → `409`.
- **Usunięcie zlecone przez administratora (decyzja właściciela 2026-11-21):** ten sam proces co RODO BL-114 (14 dni), e-mail do użytkownika. W `/ustawienia` użytkownik widzi tylko informację (zlecił administrator, data, kontakt z `LEGAL_CONTACT_EMAIL`), bez przycisku anulowania; `DELETE /me/deletion-request` zwraca `409`. Anulować może tylko administrator (osobna akcja, step-up, audyt, e-mail). Wniosek użytkownika działa jak dotąd, a akcja administratora go nie dotyka.
- **Web (`apps/web/src/admin`, trasy `(app)/admin/**`):** server components czytające przez API (kontrakty Zod tylko na serwerze), zakładki, tabele w przewijanym regionie dostępnym z klawiatury, filtry i stronicowanie kursorem. Zmiany przez jedną Server Action `adminMutation` z listą dozwolonych operacji (przeglądarka nie podaje ścieżki API). Natywny `<dialog>` z potwierdzeniem; `STEP_UP_REQUIRED` zamienia go w pole kodu TOTP i ponawia wywołanie raz. Teksty PL/EN w osobnym wejściu `@oliginvest/i18n/admin`, rozwiązywanym na serwerze — nie trafiają do kopii wysyłanych z każdą stroną.
- **Nawigacja:** wpis `admin` w rejestrze modułów UI (`nav.admin`, uprawnienie `admin:users`); proxy zwraca `404` dla `/admin` przy roli innej niż admin, a `requireAdmin()` sprawdza rolę, flagę i obecność modułu.

## Decyzje samodzielne

Rozbieżności rozstrzygnięte według kolejności ADR → wymagania → konwencje → OpenAPI/schemat → backlog:

1. **Odczyty bez step-upu, zmiany ze step-upem.** ADR-006 wymaga step-upu przy zmianach; odczyty są audytowane, ale nie pytają o kod (inaczej każde wejście na listę zużywałoby limit 5/min i 20/h).
2. **Rola przed step-upem.** Kolejność w `Administration.http` zmieniona: konto bez roli admin dostaje `FORBIDDEN`, nigdy prośby o kod (nie ujawnia, że operacja istnieje i wymaga TOTP).
3. **Ochrona przed samym sobą (`409`):** własne konto nie może zmienić e-maila, zostać zablokowane, usunięte ani mieć resetu 2FA; ostatni administrator nie traci roli i nie może zostać usunięty.
4. **Sesje kończone przy zmianie roli, e-maila i blokady** (oraz przy resecie 2FA, jak w BL-111). Alerty do administratorów: zmiana roli, e-maila i reset 2FA (jak w kontrolach § 5.2; blokada i usunięcie mają e-mail do użytkownika).
5. **`email_verified` bez zmian przy zmianie adresu** — zmiana jest na prośbę z dotychczasowego adresu (instrukcja administratora § 7); obie skrzynki dostają powiadomienie.
6. **Bez adresów e-mail w audycie** zmiany adresu: usunięcie konta pseudonimizuje identyfikatory, ale nie tekst; zapis adresu przeżyłby usunięcie.
7. **`AdminInvitation.invitedBy` opcjonalne** (kolumna zerowana po usunięciu autora) i **`banReason` 5–500 znaków** (jak `--reason` w CLI) — zmiany addytywne w `openapi.yaml` i CHANGELOG.
8. **Anulowanie przez administratora dotyczy tylko wniosków administratora;** wniosek użytkownika anuluje użytkownik.
9. **`FOR NO KEY UPDATE` przy blokowaniu konta:** `FOR UPDATE` w transakcji auth blokował sprawdzenie klucza obcego w transakcji app tego samego żądania (przekroczenie `lock_timeout` przy zapisie wniosku usunięcia).
10. **Kursor z dokładnym znacznikiem czasu bazy** (`to_json(created_at)`), bo milisekundy ISO gubiły mikrosekundy i powtarzały wiersz na granicy strony.
11. **Zmiany przez Server Action z listą operacji** (jak `mutateResource` portfela) zamiast `fetch` z przeglądarki: Zod zostaje na serwerze (budżet `/admin/*` zakazuje Zod), ścieżka API nie pochodzi z przeglądarki, a ścieżka działa także w testowym serwerze bez bramy Caddy.
12. **Wpis budżetu `/admin`** (kopia progów `/admin/*`, bo wzorzec `*` nie obejmuje samego `/admin`) i fixture `userId` dla trasy dynamicznej — bez zmiany żadnego progu.
13. **`uiDefinition` modułu admin bez importu `@oliginvest/platform`** — unika nowej zależności workspace dla jednej stałej.
14. **AGENTS.md § 6.2** nie istnieje na `main` (PR #91 nie jest scalony); pracowałem według treści z polecenia właściciela.

## Dowody lokalne

UZUPEŁNIĆ_DOWODY

## Pytania do właściciela

UZUPEŁNIĆ_PYTANIA
