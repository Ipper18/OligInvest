# ADR-004: PostgreSQL 18 + Better Auth; RLS jako druga linia obrony; Argon2id; bramka MFA; osobne role bazodanowe

- **Status:** zaakceptowana
- **Data:** 2026-09-18
- **Decydent:** właściciel projektu (self-host + Better Auth wybrane w Kroku 0)
- **Powiązane wymagania:** FR-07.01–FR-07.11, FR-08.01, FR-08.05, NFR-03.02–NFR-03.05, NFR-03.08

## Kontekst

Specyfikacja wymaga: e-mail + hasło, OAuth (Google/GitHub), **obowiązkowego** 2FA TOTP z kodami zapasowymi, RBAC (user/pro/admin), hashowania Argon2id, ochrony przed credential stuffing, oraz Row Level Security, „bo dane finansowe użytkowników nie mogą wyciec przez błąd w kodzie aplikacji”. Budżet 0 zł i jeden serwer wykluczają ciężkie serwery tożsamości.

Ustalenia z weryfikacji (context7, dokumentacja Better Auth, 2026-09-18):
- Better Auth domyślnie hashuje hasła algorytmem **scrypt**; funkcje `password.hash`/`password.verify` można podmienić.
- Wtyczka `twoFactor` wymusza drugi składnik tylko dla logowań **credential** (`/sign-in/email` itp.); logowania OAuth, passkey i magic link **nie są domyślnie objęte 2FA** — dokumentacja zaleca własne hooki.
- Dostępne wtyczki: `admin` (role, bany, unieważnianie sesji, impersonacja), `apiKey` (klucze z uprawnieniami, wygasaniem i limitami), `haveIBeenPwned` (k-anonimowość).

## Rozważane opcje

| Opcja | Zalety | Wady |
|---|---|---|
| **Better Auth + PostgreSQL 18 (self-host)** | TOTP, kody zapasowe, role, klucze API, adapter Drizzle; lekki (biblioteka w procesie `api`) | Wymuszenie 2FA dla OAuth i Argon2id wymagają własnego kodu |
| Keycloak | Kompletny IdP (MFA, polityki) | Java, ~1 GB RAM, osobna usługa i integracja OIDC |
| Supabase self-host | Auth + RLS „z pudełka” | ~10 kontenerów, 1,5–2 GB RAM |
| Auth.js | Popularny | Brak TOTP i ról — do napisania samemu |

## Decyzja

1. **Better Auth 1.7** w procesie `api` (trasy `/api/auth/*`), z wtyczkami `twoFactor` (TOTP + 10 kodów zapasowych), `admin` (role `user`/`pro`/`admin`, **impersonacja wyłączona**), `@better-auth/api-key` (PAT), `haveIBeenPwned`.
2. **Argon2id** przez `@node-rs/argon2` jako własne `hash`/`verify`, z parametrami co najmniej wg OWASP (m = 19 MiB, t = 2, p = 1), dostrojonymi w M0 tak, by hash trwał ~100–250 ms na serwerze.
3. **Obowiązkowe 2FA** realizuje **bramka MFA** w `api`: sesja użytkownika bez włączonego TOTP ma dostęp wyłącznie do tras konfiguracji 2FA i wylogowania (403 `MFA_ENROLLMENT_REQUIRED`); logowanie credential z TOTP jest wyzwaniem Better Auth. **OAuth (FR-07.03) wchodzi dopiero w P2**, po spiku „wymuszenie wyzwania TOTP po callbacku OAuth” (własny hook `after`); do tego czasu flaga `auth.oauth` jest wyłączona (Z-04). Działania wrażliwe (tworzenie PAT, eksport danych, zmiany admina, wyłączenie 2FA, zmiana e-maila/hasła) wymagają **TOTP nie starszego niż 15 min** (step-up).
4. **Tokeny PAT** z wtyczki API key: zakresy minimalne, domyślna ważność 90 dni, limit żądań per token, pokazywane raz; tworzenie wymaga step-up TOTP (Z-17).
5. **PostgreSQL 18** z **RLS** na każdej tabeli z danymi użytkownika i czterema rolami:

| Rola | Używa | Uprawnienia | RLS |
|---|---|---|---|
| `oliginvest_owner` | tylko migracje | właściciel schematu | — |
| `oliginvest_auth` | Better Auth w `api` (osobna pula połączeń) | wyłącznie tabele uwierzytelniania (`user`, `session`, `account`, `verification`, `twoFactor`, `apikey`) | nie dotyczy (logowanie wymaga wyszukania po e-mailu) |
| `oliginvest_app` | moduły w `api` i `jobs` | tabele domenowe; brak dostępu do `account` (hashe haseł), `twoFactor`, `verification`; do danych konta przez widok z bezpiecznymi kolumnami; `audit_log` tylko `INSERT`/`SELECT` | **tak**, `NOBYPASSRLS`, `FORCE ROW LEVEL SECURITY`; kontekst `SET LOCAL app.user_id` w każdej transakcji |
| `oliginvest_analytics_ro` | `analytics` | `SELECT` wyłącznie na tabelach danych rynkowych | nie dotyczy |
| `oliginvest_backup` | zadanie kopii zapasowej (poza kontenerami aplikacji) | odczyt całości | `BYPASSRLS` (wymagane przez `pg_dump`); poświadczenia niedostępne dla aplikacji |

   Polityki mają postać `USING (user_id = current_setting('app.user_id', true)::uuid)` (+ `WITH CHECK`). Brak ustawionego kontekstu = brak wierszy. **Admin nie ma polityk na tabelach portfela** — nie widzi finansów innych użytkowników (FR-08.01).
6. Kody zapasowe przechowywane w postaci zaszyfrowanej (domyślnie w Better Auth); sposób przechowywania sekretu TOTP i kluczy API weryfikujemy w M0 — jeśli którykolwiek jest jawnym tekstem, dodajemy szyfrowanie po stronie aplikacji kluczem z sekretu środowiskowego (NFR-03.08).

## Konsekwencje

- Pozytywne: błąd w zapytaniu modułu nie ujawni cudzych danych (RLS); moduły domenowe nie mogą odczytać hashy haseł ani sekretów 2FA (rozdzielone role); PAT pozwalają na Skróty bez osłabiania 2FA sesji.
- Negatywne: własny kod bramki MFA i step-up; spike dla OAuth; testy RLS muszą towarzyszyć każdej nowej tabeli; dwie pule połączeń w `api`.
- Zadania: konfiguracja Better Auth + Argon2id + bramka MFA (M1), role i polityki RLS + testy izolacji (M1), step-up TOTP (M1), PAT (M4), spike OAuth (M5).

## Weryfikacja

Testy CI: (1) użytkownik A nie odczyta danych B nawet zapytaniem bez `WHERE`; (2) rola `oliginvest_app` nie ma `SELECT` na `account`; (3) sesja bez TOTP dostaje 403 na każdej trasie danych; (4) hash w bazie ma prefiks `$argon2id$`; (5) PAT z zakresem `portfolio:read` nie wykona zapisu.
