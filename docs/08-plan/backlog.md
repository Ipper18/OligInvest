# Backlog — zadania z estymacją i zależnościami

**Cel:** rozpisać budowę OligInvest na zadania `BL-xxx` przypisane do etapów, z wymaganiami, dokumentami źródłowymi, zależnościami i estymacją — tak, aby agent budujący brał zadania po kolei, a każde wymaganie FR/NFR miało co najmniej jedno zadanie (podstawa macierzy pokrycia).

Powiązane: [`roadmapa.md`](roadmapa.md) (etapy i kryteria wyjścia), [`mvp.md`](mvp.md), [`ryzyka.md`](ryzyka.md), [`prompty-codex.md`](prompty-codex.md), [`../00-przeglad/wymagania.md`](../00-przeglad/wymagania.md), [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) (Definition of Done).

## 0. Konwencje

- **ID** `BL-NNN` — pierwsza cyfra to etap, w którym zadanie powstało (0 = M0 … 6 = M6, 7 = „Później”); ID się nie zmienia, nawet gdy zadanie przenosimy. Nowe zadanie dostaje kolejny wolny numer w zakresie etapu; numerów nie używamy ponownie.
- **[A] / [B]** (tylko M1): brama A — MVP właściciela; brama B — udostępnienie zaufanym osobom ([`roadmapa.md`](roadmapa.md) § 3).
- **d** — estymacja w dniach idealnych doświadczonego programisty (0,5 / 1 / 1,5 / 2 / 3 / 4 / 5); zadanie powyżej 5 d dzielimy.
- **Zależy od** — zadania, które muszą mieć status `gotowe` przed rozpoczęciem.
- **Status:** `todo` → `w toku` → `gotowe`; albo `wycięte` / `przeniesione (BL-xxx lub etap)`. Status i odchylenia (np. „+2 d: zmiana formatu XTB”) aktualizuje agent w tym samym PR co kod.
- **Kryterium akceptacji** zadania = Definition of Done z `CONTRIBUTING.md` + kryteria akceptacji wymagań z kolumny „Wymagania” + opis zadania.
- Zadanie zmieniające kontrakt (OpenAPI, schemat bazy, wzory, disclaimery) zaczyna się od zmiany dokumentu w tym samym PR (NFR-10.01).

### 0.1 Legenda dokumentów

| Skrót | Dokument | Skrót | Dokument |
|---|---|---|---|
| ARCH | [przeglad-architektury.md](../01-architektura/przeglad-architektury.md) | MOD | [moduly.md](../01-architektura/moduly.md) |
| STACK | [stack-technologiczny.md](../01-architektura/stack-technologiczny.md) | FLOW | [przeplywy-danych.md](../01-architektura/przeplywy-danych.md) |
| API | [openapi.yaml](../02-api/openapi.yaml) | KONW | [konwencje-api.md](../02-api/konwencje-api.md) |
| RT | [realtime.md](../02-api/realtime.md) | DB | [schema.sql](../03-dane/schema.sql) i [testy-rls.sql](../03-dane/testy-rls.sql) |
| MD | [model-danych.md](../03-dane/model-danych.md) | OBL | [obliczenia-finansowe.md](../03-dane/obliczenia-finansowe.md) |
| IMP | [formaty-importu.md](../03-dane/formaty-importu.md) | SRC | [zrodla-danych.md](../03-dane/zrodla-danych.md) |
| CACHE | [strategia-cache.md](../03-dane/strategia-cache.md) | VEC | [wektory-testowe.json](../03-dane/wektory-testowe.json) |
| UI | [architektura-ui.md](../04-frontend/architektura-ui.md) | DS | [system-projektowy.md](../04-frontend/system-projektowy.md) |
| EKR | [mapa-ekranow.md](../04-frontend/mapa-ekranow.md) | PERF | [wydajnosc.md](../04-frontend/wydajnosc.md) |
| A11Y | [dostepnosc.md](../04-frontend/dostepnosc.md) | MOB | [strategia-mobilna.md](../05-mobile/strategia-mobilna.md) |
| IOS | [ios-integracje.md](../05-mobile/ios-integracje.md) | AND | [android-integracje.md](../05-mobile/android-integracje.md) |
| AUTH | [uwierzytelnianie-autoryzacja.md](../06-bezpieczenstwo/uwierzytelnianie-autoryzacja.md) | SEC | [kontrole-bezpieczenstwa.md](../06-bezpieczenstwo/kontrole-bezpieczenstwa.md) |
| THR | [model-zagrozen.md](../06-bezpieczenstwo/model-zagrozen.md) | RODO | [prywatnosc-rodo.md](../06-bezpieczenstwo/prywatnosc-rodo.md) |
| IR | [plan-reagowania.md](../06-bezpieczenstwo/plan-reagowania.md) | INF | [infrastruktura.md](../07-wdrozenie/infrastruktura.md) |
| CI | [ci-cd.md](../07-wdrozenie/ci-cd.md) | MON | [monitoring.md](../07-wdrozenie/monitoring.md) |
| DR | [backup-dr.md](../07-wdrozenie/backup-dr.md) | RISK | [ryzyka.md](ryzyka.md) |
| LIM | [10-ograniczenia.md](../10-ograniczenia.md) | LAW | [11-zgodnosc-prawna.md](../11-zgodnosc-prawna.md) |
| USR | [instrukcja.md](../12-dla-uzytkownika/instrukcja.md) | ADMIN | [instrukcja-administratora.md](../12-dla-uzytkownika/instrukcja-administratora.md) |
| SLOW | [slownik-pojec.md](../00-przeglad/slownik-pojec.md) | ADR-NNN | [decyzje](../09-decyzje/ADR-000-szablon.md) (link w wierszu) |

## 1. M0 — Szkielet i infrastruktura

Bez logiki domenowej; wynik: działające CI, baza z RLS, wydanie podpisane i wdrożone na docelową infrastrukturę.

| ID | Zadanie | Wymagania | Dokumenty | Zależy od | d | Status |
|---|---|---|---|---|---|---|
| BL-001 | Bootstrap repozytorium kodu: pnpm 12 (workspace z polityką z SEC §4.3: `minimumReleaseAge`, `trustPolicy`, `strictDepBuilds`, `blockExoticSubdeps`, `allowBuilds`), Turborepo 2.11, `.nvmrc` (Node 24), Biome 2.5, `tsconfig` strict, sprawdzanie tytułów PR (Conventional Commits) | NFR-02.01, NFR-03.09, NFR-10.03, NFR-10.05 | STACK, SEC | — | 1 | w toku |
| BL-002 | Struktura `apps/*`, `modules/*`, `packages/*` z pustymi pakietami, polem `exports` w modułach i testami dymnymi | NFR-02.01, NFR-02.02 | MOD | BL-001 | 1 | todo |
| BL-003 | Skrypt `pnpm check:deps` (reguły warstw) z testem negatywnym | NFR-02.03 | MOD, [ADR-002](../09-decyzje/ADR-002-monorepo.md) | BL-002 | 1 | todo |
| BL-004 | Generator `pnpm gen:module <nazwa>` według szablonu modułu | NFR-02.02, NFR-02.07 | MOD | BL-002 | 1 | todo |
| BL-005 | `packages/config`: schemat zmiennych środowiskowych (Zod) z obsługą `*_FILE`, zgodny z `.env.example` | NFR-03.12 | INF | BL-002 | 0,5 | todo |
| BL-006 | `packages/platform`: kontrakt i rejestry modułów, kontekst żądania, `request-id`, logger pino z redakcją, błędy RFC 9457, walidacja Zod `.strict()` na granicy | NFR-02.02, NFR-03.07, NFR-09.04 | MOD, KONW, SEC | BL-002 | 3 | todo |
| BL-007 | `packages/db`: Drizzle odzwierciedlający `schema.sql`, migracje, polityki RLS, helper transakcji z `SET LOCAL app.user_id/app.role`, osobne pule per rola | NFR-03.04 | DB, MD, [ADR-004](../09-decyzje/ADR-004-postgres-better-auth-rls.md) | BL-002 | 4 | todo |
| BL-008 | Zadanie CI `db`: PostgreSQL 18, migracje od zera, porównanie schematu z `schema.sql`, `testy-rls.sql` | NFR-03.04, NFR-10.02 | CI, DB | BL-007 | 1 | todo |
| BL-009 | `apps/api`: Hono + `@hono/zod-openapi`, `/api/v1/health/live|ready`, `/api/v1/openapi.json` | NFR-09.04 | API, KONW | BL-006 | 1 | todo |
| BL-010 | Test spójności OpenAPI (generowany vs `docs/02-api/openapi.yaml`) z listą `apps/api/openapi-pending.json`, która może tylko maleć; lint Redocly | NFR-02.05 | CI, [ADR-012](../09-decyzje/ADR-012-api-jako-granica-domenowa.md), API | BL-009 | 2 | todo |
| BL-011 | `apps/web`: Next.js 16.3, `proxy.ts` z CSP nonce, klient API dla RSC (ciasteczko, `request-id`), tokeny Tailwind 4 z systemu projektowego, brak zewnętrznych skryptów | NFR-03.06, NFR-01.02, NFR-11.01 | UI, DS, SEC, [ADR-012](../09-decyzje/ADR-012-api-jako-granica-domenowa.md) | BL-006 | 3 | todo |
| BL-012 | `packages/i18n` (formatery `Intl` pl-PL, słownik, lint literałów, test zakazanych zwrotów z LAW §4.1, teksty disclaimerów z LAW §4.3) i `packages/ui` (prymitywy, `<DataFreshness/>`, `<AssumptionsBlock/>`, `<Disclaimer/>`) | NFR-10.04, NFR-07.01, FR-04.01 | DS, LAW | BL-011 | 2 | todo |
| BL-013 | `apps/jobs`: BullMQ 6.3, rejestr kolejek i harmonogramów, health | NFR-09.04 | MOD | BL-006 | 1 | todo |
| BL-014 | `apps/analytics`: Python 3.13 + uv, Ruff, mypy, pytest, konsument `bullmq` bez logiki | NFR-10.02 | STACK, [ADR-003](../09-decyzje/ADR-003-hybryda-obliczen-i-kolejki.md) | BL-002 | 1 | todo |
| BL-015 | `packages/test-vectors` z `wektory-testowe.json` i loaderami dla Vitest i pytest | NFR-02.06, NFR-08.02 | OBL, VEC | BL-002, BL-014 | 0,5 | todo |
| BL-016 | Egzekwowanie budżetów: `size-limit`, `route-budgets.mjs`, wykrywanie zakazanych bibliotek w chunkach początkowych, skrypt Lighthouse 13.5 z asercjami (raport do M1) | NFR-01.02, NFR-01.03 | PERF | BL-011 | 2 | todo |
| BL-017 | CI w GitHub Actions: `lint`, `typecheck`, `unit`, `contracts`, `build` (macierz bez modułów), `budgets`, `deps-audit`; akcje przypięte SHA, token tylko do odczytu; CodeQL przez konfigurację domyślną GitHub po scaleniu M0-1 (BL-019), poza własnymi workflow | NFR-03.09, NFR-10.02, NFR-10.03, NFR-02.02 | CI | BL-003, BL-008, BL-010, BL-016 | 2 | w toku |
| BL-018 | E2E: Playwright (Chromium, WebKit, Firefox) z `@axe-core/playwright`; M0-1: test dymny lokalnego buildu produkcyjnego z usługami `compose.dev.yaml`; M0-2: ten sam test na obrazach produkcyjnych po BL-020–BL-023; zamknięcie dopiero po obu częściach | NFR-04.01, NFR-06.01 | CI, A11Y | BL-017; część M0-2: BL-020–BL-023 | 1 | todo |
| BL-019 | Ustawienia repozytorium: ruleset `main`, skanowanie sekretów z push protection, CodeQL, alerty Dependabot, prywatne zgłaszanie podatności, `CODEOWNERS`, Renovate, reguła CI dla `.xlsx/.csv` spoza fixtures | NFR-03.12, NFR-03.09, NFR-10.03 | CI, [ADR-013](../09-decyzje/ADR-013-repozytorium-publiczne.md) | BL-017 | 1 | w toku |
| BL-020 | Obrazy Docker (nie-root, FS tylko do odczytu, bazy przypięte digestem): `web`, `api`, `jobs`, `analytics`, `postgres` z pgBackRest, `migrate` | NFR-03.11 | INF | BL-009, BL-011, BL-013, BL-014 | 2 | todo |
| BL-021 | Workflow `release.yml`: GHCR, SBOM (syft), poświadczenia, cosign keyless, osv-scanner obrazów, podpisana paczka wdrożeniowa | NFR-03.09 | CI | BL-020 | 2 | todo |
| BL-022 | `compose.yaml`: sieci `edge`/`backend`/`analytics` (internal) i `egress`, limity zasobów, sekrety jako pliki, dwie instancje Valkey z ACL | NFR-01.08, NFR-03.11 | INF, [ADR-003](../09-decyzje/ADR-003-hybryda-obliczen-i-kolejki.md) | BL-020 | 1,5 | todo |
| BL-023 | Skrypty `bootstrap-vm.sh`, `generate-secrets.sh`, `deploy.sh` (weryfikacja cosign, kopia przed migracją, bramka zdrowia, wycofanie) | NFR-09.05, NFR-03.11 | INF, CI | BL-021, BL-022 | 3 | todo |
| BL-024 | VPS: nginx `stream` (SNI, PROXY v1), port 80 (301/403), nftables, WireGuard (tunel i przekaźnik administracyjny z MTU), NAT ruchu wychodzącego | NFR-03.11 | INF, [ADR-011](../09-decyzje/ADR-011-topologia-wdrozenia.md) | — | 2 | todo |
| BL-025 | VM i Caddy: hardening (nftables, SSH, chrony z NTS, DNS-over-TLS, AppArmor), `daemon.json`, Caddyfile (TLS 1.3, `proxy_protocol`, TLS-ALPN-01), BIOS *AC Recovery*, VM „Start at boot” | NFR-03.11, NFR-03.06 | INF | BL-024 | 2 | todo |
| BL-026 | DNS w home.pl: A/AAAA, spike parametrów CAA (`accounturi`, `validationmethods`) z decyzją, DNSSEC, 2FA, blokada transferu | NFR-03.11 | INF | BL-025 | 0,5 | todo |
| BL-027 | Migracja TLS Immicha na dom (fazy 0–3; faza 4 po 7 dniach) w oknie serwisowym | NFR-03.11 | INF | BL-024, BL-025 | 1,5 | todo |
| BL-028 | Kopie: pgBackRest (WAL, zst, AES-256-CBC), restic → rest-server append-only na VPS, timery, weryfikacja repozytoriów | NFR-09.03 | DR | BL-022, BL-024 | 2 | todo |
| BL-029 | Uptime Kuma na VPS: sondy `app-ready`, `app-certificate`, `vm-health`, alerty e-mail | NFR-09.01, NFR-09.04 | MON | BL-023, BL-024 | 1 | todo |
| BL-030 | Spike: przedrostek `__Host-` w Better Auth — notatka lub ADR (odstępstwo O-01) | NFR-03.03 | AUTH | BL-009 | 1 | todo |
| BL-031 | Spike: przechowywanie sekretu TOTP, kodów zapasowych (`encrypted`) i kluczy API w Better Auth; czas Argon2id na serwerze (100–250 ms) | NFR-03.02, NFR-03.08 | [ADR-004](../09-decyzje/ADR-004-postgres-better-auth-rls.md), AUTH | BL-009, BL-023 | 1 | todo |
| BL-032 | Spike: TypeScript 7 z Next.js, Hono, Drizzle i Better Auth — decyzja 7.x albo 6.x | NFR-10.05 | STACK | BL-011 | 0,5 | todo |
| BL-033 | Raport rozmiarów bazowych (Next.js, Zod, Radix) i aktualizacja PERF §2 | NFR-01.02 | PERF | BL-016 | 0,5 | todo |
| BL-034 | Środowisko deweloperskie w M0-1: samodzielne `compose.dev.yaml` (PostgreSQL, Valkey ×2, Mailpit), `pnpm dev`, dane syntetyczne; bez zależności od produkcyjnego Compose i obrazów aplikacji | NFR-10.01 | CI | BL-013, BL-014 | 1 | todo |
| BL-035 | Test spójności dokumentacji w CI: każde FR/NFR z `wymagania.md` ma zadanie w `backlog.md` i wiersz w `macierz-pokrycia.md`; linki wewnętrzne w `docs/` działają; każdy dokument zaczyna się od „Cel:” | NFR-10.01 | CI | BL-017 | 0,5 | todo |
| | **Suma etapu** | | | | **51** | |

### 1.1 Postęp i odchylenia

- **2026-09-20, BL-001:** audyt rozszerzony na graf npm/PyPI i binaria platformowe wyznacza wspólny termin karencji **2026-09-21 18:31:49 Europe/Warsaw**. Właściciel zatwierdził oczekiwanie bez zmiany ADR-002 i bez wyjątków od polityki oraz prace dokumentacyjne i konfiguracyjne przed instalacją. Estymacja 1 d bez zmian; oczekiwanie jest opóźnieniem kalendarzowym, odchylenie nakładu do ustalenia po implementacji. Dowody i ograniczenia: [raport BL-001](bl-001-bootstrap-readiness.md).
- **2026-09-20, podział M0-1/M0-2:** zatwierdzono pozostawienie BL-034 w M0-1 z zależnościami BL-013 i BL-014. BL-018 pozostaje otwarty do testów obrazów w M0-2; BL-019 i kryterium wyjścia M0 nr 7 wymagają potwierdzenia ustawień przez właściciela po scaleniu M0-1. Przygotowanie plików przed instalacją nie oznacza ukończenia zadań ani zielonego CI.
- **2026-09-20, BL-017/BL-019:** na wyraźne polecenie właściciela przygotowano podczas karencji szkic CI, CODEOWNERS, szablon PR, Renovate, nieaktywny ruleset i instrukcję ustawień. Status `w toku` obejmuje wyłącznie przygotowanie plików; uruchomienie CI czeka na gotowe zależności. Lokalny skrypt kontroli fixtures/tytułu PR ma 7 przechodzących testów bez instalowania pakietów, na zastanym Node 25; nie zastępuje testów na Node 24. Odchylenia 2 d / 1 d do ustalenia po wykonaniu zadań. Szczegóły i brakujące dowody: [raport sesji](m0-1-session-report.md).

## 2. M1 — MVP

Brama A (**[A]**) — MVP właściciela; brama B (**[B]**) — funkcje wymagane przed zaproszeniem innych osób. Zakres i cięcia awaryjne: [`mvp.md`](mvp.md).

| ID | Zadanie | Wymagania | Dokumenty | Zależy od | d | Status |
|---|---|---|---|---|---|---|
| BL-101 | **[A]** Better Auth: e-mail + hasło z Argon2id (`@node-rs/argon2`), pula `oliginvest_auth`, polityka haseł (12–128, lista 10k, słowa kontekstowe, HIBP), limity prób i opóźnienia per konto | FR-07.02, NFR-03.02 | AUTH, [ADR-004](../09-decyzje/ADR-004-postgres-better-auth-rls.md) | BL-007, BL-009, BL-031 | 3 | todo |
| BL-102 | **[A]** Zaproszenia i rejestracja: `adminCreateInvitation`, `previewInvitation` (token we fragmencie), akceptacja regulaminu i informacji (`consent_events`), CLI pierwszego zaproszenia administratora | FR-07.01, FR-07.12 | AUTH, RODO, API | BL-101 | 3 | todo |
| BL-103 | **[A]** TOTP: 10 kodów zapasowych (`encrypted`), ochrona przed powtórzeniem kodu, blokada po 5 błędach, bramka MFA | FR-07.04 | AUTH | BL-101 | 3 | todo |
| BL-104 | **[B]** Bramka regulaminu `TERMS_ACCEPTANCE_REQUIRED`, `/me/legal*`, zgoda na diagnostykę | FR-07.12 | RODO, API | BL-102 | 1,5 | todo |
| BL-105 | **[A]** Sesje: ciasteczka `__Host-` (albo O-01), 7/30 dni, rotacja, lista sesji i wylogowanie zdalne ≤ 60 s, `Clear-Site-Data` | FR-07.05, NFR-03.03 | AUTH | BL-103, BL-030 | 2 | todo |
| BL-106 | **[A]** Step-up TOTP (15 min) dla operacji wrażliwych | FR-07.04 | AUTH | BL-103 | 1 | todo |
| BL-107 | **[A]** Reset hasła (link 30 min we fragmencie, unieważnienie sesji); e-maile systemowe przez SMTP Brevo; SPF, DKIM, DMARC | FR-07.10, NFR-11.03 | AUTH, [ADR-010](../09-decyzje/ADR-010-kanaly-powiadomien.md) | BL-101 | 2 | todo |
| BL-108 | **[A]** RBAC: role, uprawnienia modułów wg MOD §6, testy 403; brak polityk RLS dla admina na tabelach portfela | FR-07.06, FR-08.01, NFR-03.04 | MOD, AUTH | BL-103, BL-007 | 2 | todo |
| BL-109 | **[A]** Audyt append-only: wpis dla każdej trasy `/api/v1/admin/*` i każdego polecenia CLI; pseudonim aktora | FR-08.05, FR-08.10 | SEC, DB | BL-108 | 2 | todo |
| BL-110 | **[B]** Zdarzenia bezpieczeństwa i reguły anomalii: e-mail o nowym urządzeniu, seria nieudanych logowań, masowy eksport | NFR-03.10 | SEC, THR | BL-105, BL-107 | 1,5 | todo |
| BL-111 | **[A]** Polecenia administracyjne `pnpm admin:*` z audytem: zaproszenie, reset 2FA (break-glass), wylogowanie wszystkich, tryb serwisowy, wstrzymanie kolejek, flagi | FR-08.01 | IR, ADMIN | BL-109 | 2 | todo |
| BL-112 | **[B]** Powłoka `/admin` (leniwa): użytkownicy bez danych finansowych, zaproszenia, role | FR-08.01 | [ADR-006](../09-decyzje/ADR-006-panel-administratora.md), EKR | BL-108, BL-121 | 2 | todo |
| BL-113 | **[A]** Preferencje: motyw jasny/ciemny/systemowy, paleta dla daltonistów bez przeładowania, waluta bazowa | FR-07.08, NFR-06.02 | DS, API | BL-121 | 1,5 | todo |
| BL-114 | **[B]** RODO: eksport danych (JSON + CSV w ZIP, 24 h, step-up), usunięcie konta z 14-dniową karencją, `erasure_log` i plik poza bazą, test „wszystkie tabele z `user_id`” | FR-07.09, NFR-11.02 | RODO, DR | BL-106, BL-109 | 3 | todo |
| BL-115 | **[B]** Zadania retencji: pliki importu, zaproszenia, eksporty, dziennik doręczeń, RUM, partycje audytu | NFR-11.02 | RODO | BL-114 | 1 | todo |
| BL-116 | **[A]** Strony `/regulamin`, `/prywatnosc`, `/zrodla-danych` (MDX, wersja `2026-09`, pola `LEGAL_*`), stopka z disclaimerem `general` | FR-07.12, NFR-07.03, NFR-07.04 | USR, LAW | BL-121 | 1 | todo |
| BL-117 | **[A]** Mechanizm flag: `feature_flags`, ocena z cache 30 s, `404` dla wyłączonych modułów, unieważnianie przez `flags.changed` | FR-08.04, NFR-02.02 | MOD | BL-006, BL-007 | 1,5 | todo |
| BL-118 | **[B]** Umowy powierzenia: akceptacja DPA Brevo, retencja logów Brevo 1 miesiąc, zapis wersji DPA OVHcloud | NFR-11.03 | RODO | BL-107 | 0,5 | todo |
| BL-121 | **[A]** Powłoka `(app)`: nawigacja mobilna i desktopowa, TanStack Query, klient SSE, stany ekranów, budżet powłoki ≤ 30 KB | NFR-01.02, NFR-04.02 | UI, EKR, PERF | BL-011, BL-012 | 3 | todo |
| BL-122 | **[A]** Ekrany uwierzytelniania: logowanie, 2FA, rejestracja, konfiguracja 2FA (QR, kody), reset hasła, akceptacja regulaminu | FR-07.01, FR-07.02, FR-07.04, FR-07.10, FR-07.12 | EKR | BL-102, BL-103, BL-107, BL-121 | 3 | todo |
| BL-123 | **[B]** Ustawienia: bezpieczeństwo (hasło, 2FA, sesje), prywatność (zgody, historia), dane (eksport, usunięcie), preferencje | FR-07.05, FR-07.08, FR-07.09, FR-07.12 | EKR | BL-113, BL-114, BL-122 | 2 | todo |
| BL-124 | **[B]** RUM za zgodą: `web-vitals` → `reportWebVitals`, zapis bez identyfikatora osoby | NFR-01.01, FR-07.12, NFR-11.01 | PERF, RODO | BL-104, BL-121 | 1 | todo |
| BL-125 | **[A]** Hub SSE: `GET /api/v1/stream`, strumień `sse:{userId}` z odtwarzaniem, pub/sub notowań, heartbeat, limit strumieni, zapas w postaci odpytywania | FR-02.03, NFR-01.06, NFR-03.05 | RT, [ADR-007](../09-decyzje/ADR-007-sse-zamiast-websocket.md) | BL-006, BL-013 | 3 | todo |
| BL-131 | **[A]** `packages/data-providers`: port `DataProvider`, rejestr, token bucket, circuit breaker, metadane `source/asOf/delayMinutes/stale`, cache L1/L2 z kluczami per użytkownik | NFR-02.04, NFR-05.02, NFR-03.05, NFR-01.05 | CACHE | BL-006 | 3 | todo |
| BL-132 | **[A]** Adaptery NBP (tabela A, limit 93 dni) i Frankfurter (zapas), zadanie dzienne kursów | FR-01.14 | SRC, CACHE | BL-131 | 1,5 | todo |
| BL-133 | **[A]** Adapter archiwum GPW (XLS przez SheetJS CE z CDN, identyfikujący User-Agent, 1 żądanie na sesję), test kontraktowy, backfill historii | FR-01.03, NFR-05.02 | IMP, [ADR-005](../09-decyzje/ADR-005-strategia-danych-rynkowych.md) | BL-131 | 3 | todo |
| BL-134 | **[A]** Adapter Yahoo (`yahoo-finance2`): notowania opóźnione GPW/USA, EOD USA, indeksy; degradacja do trybu „tylko EOD” | FR-01.02, FR-02.03, NFR-09.02 | SRC, CACHE | BL-131 | 2 | todo |
| BL-135 | **[A]** Katalog instrumentów i mapowanie symboli (ISIN, ticker brokera, MIC); wyszukiwarka < 300 ms p95 z wyszukiwaniem u dostawcy w tle | FR-01.01 | DB, API | BL-133, BL-134 | 2 | todo |
| BL-136 | **[A]** Kalendarz sesji i rozliczeń (XWAR, XNYS, XNAS) z wpisami admina; wyliczanie `settle_date` (USA T+1, UE T+2, od 11.10.2027 T+1) | FR-02.07 | OBL, LAW | BL-135 | 1,5 | todo |
| BL-137 | **[A]** Karta instrumentu: `getInstrument`, `getQuotes`, `getMarketDataStatus`, status i wiek danych | FR-01.02, FR-01.15 | EKR, API | BL-135, BL-121 | 2 | todo |
| BL-138 | **[A]** Wykres świecowy: `getInstrumentChart` z decymacją ≤ 3 000 punktów (1W/1M), leniwy wrapper Lightweight Charts, tabela alternatywna, atrybucja TradingView | FR-01.03, NFR-01.04, NFR-06.01 | [ADR-009](../09-decyzje/ADR-009-wykresy.md), PERF, LAW | BL-137 | 3 | todo |
| BL-139 | **[A]** Minimalna kontrola jakości EOD przy zapisie: integralność OHLC, duplikaty, skoki bez zdarzenia korporacyjnego | NFR-08.04 | OBL | BL-133 | 1,5 | todo |
| BL-141 | **[A]** `packages/core`: `Money`, `Quantity`, `Price`, `FxRate` (decimal.js, precyzja 34, zaokrąglenia), formatowanie pl-PL | NFR-08.01, NFR-04.04 | OBL, [ADR-014](../09-decyzje/ADR-014-pieniadze-waluty-czas.md) | BL-015 | 2 | todo |
| BL-142 | **[A]** `packages/core`: model operacji, partie FIFO (sprzedaż częściowa, split, przeniesienie), P/L zrealizowany ekonomiczny i podatkowy (`settle_date`, NBP D-1; marża przewalutowania osobno jako `fxCosts`, ustawienia `tax_date_basis` i `tax_include_fx_fee`) — wektor A | FR-02.07, FR-03.05, NFR-08.02 | OBL, VEC | BL-141 | 4 | todo |
| BL-143 | **[A]** `packages/core`: pozycje, gotówka per waluta, wycena, P/L niezrealizowany, wynik dnia — wektory F i G | FR-02.02, FR-02.04, FR-02.09 | OBL, VEC | BL-142 | 2 | todo |
| BL-144 | **[A]** Moduł `portfolio`: rachunki (zwykły, IKE, IKZE), operacje z walidacją per typ, przeliczenie ≤ 5 s | FR-02.01, FR-03.03 | API, DB | BL-108, BL-143 | 3 | todo |
| BL-145 | **[A]** Import XTB: upload ≤ 10 MB, parsowanie w `jobs`, oba szablony, statusy wierszy, idempotencja, mapowanie instrumentów, CFD jako `unsupported`, uzgodnienie sald, zatwierdzenie | FR-03.01, NFR-08.03, NFR-03.07 | IMP | BL-144, BL-135 | 5 | todo |
| BL-146 | **[A]** Przeliczanie pozycji i wycen (kolejka `recompute`), zdarzenie `portfolio.valuation.updated` do SSE, nocne `recompute-all` | FR-02.03 | MOD, FLOW | BL-145, BL-125 | 2 | todo |
| BL-147 | **[A]** Ekrany: Start, Pozycje, Operacje (lista i formularz), Rachunki, Partie; przełącznik P/L ekonomiczny/podatkowy z disclaimerem `tax_view` | FR-02.01, FR-02.02, FR-02.03, FR-02.04, FR-02.07, FR-02.09, FR-03.03 | EKR, LAW | BL-146, BL-121 | 4 | todo |
| BL-148 | **[A]** Ekrany importu: wybór pliku z instrukcją eksportu, podgląd, rozstrzyganie wierszy, uzgodnienie, zatwierdzenie | FR-03.01 | EKR, USR | BL-145, BL-121 | 3 | todo |
| BL-149 | **[A]** Fixtures w `modules/portfolio/test/fixtures/anonymized/` i lokalny skrypt anonimizacji plików właściciela | NFR-03.12 | [ADR-013](../09-decyzje/ADR-013-repozytorium-publiczne.md) | BL-145 | 1 | todo |
| BL-151 | **[B]** CrowdSec: agent w VM (Caddy, SSH), LAPI i bouncer nftables na VPS, test blokady ≤ 60 s | NFR-03.11 | INF, [ADR-011](../09-decyzje/ADR-011-topologia-wdrozenia.md) | BL-025 | 1,5 | todo |
| BL-152 | **[A]** Monitoring: 13 sond Uptime Kuma, health-checki usług, `/internal/metrics`, dzienny raport błędów | NFR-09.01, NFR-09.04 | MON | BL-029, BL-146 | 2 | todo |
| BL-153 | **[B]** Pierwszy test odtworzenia (B i D) z protokołem; automatyczny test miesięczny | NFR-09.03 | DR | BL-028, BL-114 | 1,5 | todo |
| BL-154 | **[A]** Lighthouse blokujący w CI dla tras MVP, raport JS per trasa, poprawki wydajności | NFR-01.01, NFR-01.02, NFR-01.03, NFR-01.05 | PERF, CI | BL-147, BL-138 | 2 | todo |
| BL-155 | **[A]** E2E ścieżek krytycznych (zaproszenie → TOTP → import XTB → portfel; bramki), axe, ręczny test VoiceOver z protokołem | NFR-10.02, NFR-06.01 | CI, A11Y | BL-148, BL-122 | 3 | todo |
| BL-156 | **[B]** Skan produkcji (nagłówki, CSP, TLS, porty z zewnątrz) i odhaczona lista kontrolna RODO § 12 | NFR-03.06, FR-07.12 | SEC, RODO, INF | BL-116, BL-151, BL-118 | 1 | todo |
| | **Suma etapu** | | | | **102** | |

## 3. M2 — Dane rynkowe, wskaźniki i onboarding

| ID | Zadanie | Wymagania | Dokumenty | Zależy od | d | Status |
|---|---|---|---|---|---|---|
| BL-201 | `packages/core`: SMA, EMA, wstęgi Bollingera, RSI, MACD, ATR — zgodność z TA-Lib (wektor E, 1e-8) | FR-01.05, NFR-08.02 | OBL, VEC | BL-141 | 3 | todo |
| BL-202 | `getInstrumentIndicators`, nakładki i panele na wykresie, parametry wskaźników | FR-01.05 | API, [ADR-009](../09-decyzje/ADR-009-wykresy.md) | BL-201, BL-138 | 2 | todo |
| BL-203 | Wyjaśnienia kontekstowe `<Explainer/>` (klucze i treści MDX modułu `education`) dla wskaźników i metryk MVP; test pokrycia kluczy | FR-01.07, FR-06.02, NFR-06.03 | DS, MOD | BL-202 | 2 | todo |
| BL-204 | Glosariusz: indeks statyczny, wyszukiwanie po fragmencie i synonimie, pierwsze 30 haseł ze słownika pojęć | FR-06.03 | EKR, SLOW | BL-203 | 2 | todo |
| BL-205 | Watchlisty: listy, kolejność, notatki, ekran z kursami | FR-01.08 | API, EKR | BL-137 | 2 | todo |
| BL-206 | Indeksy i benchmarki (WIG20, WIG, mWIG40, sWIG80, S&P 500, Nasdaq-100 i ETF-y): backfill ≥ 5 lat, `listBenchmarks`, ekran `/rynek` | FR-01.09 | SRC, EKR | BL-134 | 2 | todo |
| BL-207 | Klasyfikacja instrumentów (klasa, sektor, kraj, waluta) z nadpisaniami; `getAllocation` i ekran alokacji | FR-02.05 | API, EKR | BL-146 | 3 | todo |
| BL-208 | Import mBank eMakler (historia transakcji i finansowa, Windows-1250, mapowanie po nazwie) | FR-03.02 | IMP | BL-145 | 3 | todo |
| BL-209 | Pełna kontrola jakości danych: reguły BLOCK/WARN/INFO, `data_quality_issues`, oznaczenia w UI, blokada analiz | NFR-08.04, NFR-09.02 | OBL | BL-139 | 1,5 | todo |
| BL-210 | Zapasowe adaptery USA: Finnhub, Twelve Data, Alpha Vantage — kwoty, testy kontraktowe na zapisanych odpowiedziach | NFR-02.04, NFR-09.02 | SRC, CACHE | BL-131 | 2 | todo |
| BL-211 | Preferencje: metoda kosztu (FIFO/średnia), ustawienia widoku podatkowego (dzień przychodu, marża przewalutowania w koszcie — przelicza widok podatkowy), strefa czasowa, język; synchronizacja między urządzeniami | FR-07.08 | API | BL-113 | 1 | todo |
| BL-212 | Test opóźnienia SSE < 2 s p95 i wznowienia z `Last-Event-ID` | NFR-01.06 | RT, [ADR-007](../09-decyzje/ADR-007-sse-zamiast-websocket.md) | BL-125 | 1 | todo |
| BL-213 | Raport kompletności EOD GPW (weryfikacja ADR-005 przez 20 sesji) | NFR-09.02 | [ADR-005](../09-decyzje/ADR-005-strategia-danych-rynkowych.md) | BL-133 | 0,5 | todo |
| BL-214 | Ekran kursów walut `/rynek/waluty` z historią NBP | FR-01.14 | EKR | BL-132 | 1 | todo |
| BL-215 | Limity per rola w `platform` (np. liczba analiz dziennie), `429` z czasem odnowienia | FR-08.03 | MOD, KONW | BL-131 | 1,5 | todo |
| BL-216 | Onboarding przy pierwszym logowaniu (driver.js ładowany leniwie, pomijalny i powtarzalny, dostępny z klawiatury; treść z samouczków § 2) | FR-06.01 | A11Y, PERF, USR | BL-203 | 2 | todo |
| | **Suma etapu** | | | | **29,5** | |

## 4. M3 — Wyniki historyczne i analizy scenariuszowe (P1)

M3 nie zależy od M4 (etapy mogą iść równolegle).

| ID | Zadanie | Wymagania | Dokumenty | Zależy od | d | Status |
|---|---|---|---|---|---|---|
| BL-301 | `packages/core`: TWR (metoda łańcuchowa) i XIRR, okresy, waluta stopy — wektor B | FR-03.06, NFR-08.02 | OBL, VEC | BL-143 | 3 | todo |
| BL-302 | Wyceny dzienne i historia wartości (`valuations_daily`, `cash_balances_daily`), `getPortfolioHistory`, wykres uPlot ładowany leniwie | FR-02.10 | OBL, [ADR-009](../09-decyzje/ADR-009-wykresy.md) | BL-146 | 3 | todo |
| BL-303 | `getPerformance` i ekran wyników (TWR, XIRR, okresy, P/L zrealizowany) | FR-03.06 | EKR | BL-301, BL-302 | 2 | todo |
| BL-304 | Benchmark: TWR portfela kontra indeks i symulacja „te same przepływy” | FR-03.07 | OBL | BL-303, BL-206 | 2 | todo |
| BL-305 | Obsunięcia i wykres „underwater” — wektor C | FR-03.09 | OBL, VEC | BL-302 | 1,5 | todo |
| BL-306 | Ekspozycja walutowa i rozbicie wyniku na efekt ceny i kursu | FR-02.06 | OBL | BL-143 | 1,5 | todo |
| BL-307 | Dywidendy: brutto, podatek u źródła, netto, stopa od kosztu, szacowana dopłata | FR-02.08 | OBL, VEC | BL-143 | 1,5 | todo |
| BL-308 | Średnia ważona jako metoda widoku i przeliczenie po zmianie metody | FR-03.05 | OBL | BL-142 | 1 | todo |
| BL-309 | Dziennik transakcji i postmortem | FR-03.11 | API, EKR | BL-144 | 2 | todo |
| BL-310 | Eksport transakcji, pozycji i wyników (CSV/JSON) z neutralizacją formuł i linią `export`; test eksport → import | FR-03.13 | SEC, LAW | BL-144 | 1,5 | todo |
| BL-311 | Worker `analytics`: kontrakty zadań (JSON Schema z Zod), walidacja `jsonschema`, rola `analytics_ro`, sieć bez wyjścia, limity CPU/RAM/czasu, testy izolacji | NFR-03.13, NFR-01.07 | [ADR-003](../09-decyzje/ADR-003-hybryda-obliczen-i-kolejki.md), INF | BL-014, BL-022 | 3 | todo |
| BL-312 | Moduł `analytics`: uruchomienia, postęp i wynik przez SSE, limity roli, anulowanie, zapis wyników w kontekście RLS | FR-04.01, NFR-01.07 | API, MOD | BL-311, BL-125 | 3 | todo |
| BL-313 | Monte Carlo: bootstrap stacjonarny i t-Student, proxy klas aktywów, przepływy, inflacja, podatek; wachlarz, P(cel), rozkład obsunięć, tabela wrażliwości, ziarno | FR-04.02, NFR-08.05 | OBL | BL-312 | 5 | todo |
| BL-314 | Ekran wyników analiz: rozkłady, „jak czytać”, blok założeń, disclaimer, dane do odtworzenia | FR-04.01, FR-06.06 | EKR, LAW | BL-313 | 2 | todo |
| BL-315 | Kalkulator rebalancingu: alokacje docelowe, tryby `full` i `buy_only`, koszty, szacowany podatek, blokada przy nieuzgodnionych danych — wektor H | FR-04.06 | OBL, VEC, LAW | BL-143, BL-207 | 3 | todo |
| BL-316 | Bramkowanie roli `pro` dla analiz ciężkich, komunikaty w UI | FR-07.06 | MOD | BL-312 | 1 | todo |
| BL-317 | Wektory B–D w pytest kontra empyrical-reloaded | NFR-02.06, NFR-08.02 | OBL | BL-311 | 1 | todo |
| BL-318 | Przegląd metodologiczny Monte Carlo i rebalancingu (checklisty z AGENTS.md) zapisany w PR | NFR-07.02 | LAW, OBL | BL-314, BL-315 | 0,5 | todo |
| BL-319 | Stopa wolna od ryzyka: FRED `DGS3MO` i szereg stopy referencyjnej NBP wpisywany przez admina | FR-03.10 | OBL, SRC | BL-131 | 1 | todo |
| | **Suma etapu** | | | | **38,5** | |

## 5. M4 — Alerty, PWA i Skróty

M4 zależy od M1 i M2, nie od M3.

| ID | Zadanie | Wymagania | Dokumenty | Zależy od | d | Status |
|---|---|---|---|---|---|---|
| BL-401 | Manifest PWA (ikony, skróty z ikony), service worker (cache powłoki, `/offline`, push, `notificationclick`), komunikat o nowej wersji | FR-09.01, FR-09.06, NFR-04.03 | UI, MOB, AND | BL-121 | 3 | todo |
| BL-402 | Web Push: VAPID, subskrypcje, test, usuwanie wygasłych, `Urgency` i `TTL` | FR-09.03 | [ADR-010](../09-decyzje/ADR-010-kanaly-powiadomien.md), AND | BL-401 | 2 | todo |
| BL-403 | Moduł `notifications`: kanały, ciche godziny, deduplikacja, limit e-mail 300/dobę, dziennik doręczeń | FR-05.06 | [ADR-010](../09-decyzje/ADR-010-kanaly-powiadomien.md), MOD | BL-402, BL-107 | 2,5 | todo |
| BL-404 | Moduł `alerts`: alerty cenowe (próg, zmiana %), ewaluacja po notowaniach i EOD, histereza, cooldown | FR-05.01 | MOD, OBL | BL-137, BL-403 | 3 | todo |
| BL-405 | Treści alertów bez kwot portfela i bez języka rekomendacji; szablony z testem języka | FR-05.07 | LAW, [ADR-010](../09-decyzje/ADR-010-kanaly-powiadomien.md) | BL-404 | 1 | todo |
| BL-406 | Ekrany alertów: lista, kreator z podglądem treści, historia wyzwoleń i doręczeń | FR-05.01, FR-05.06 | EKR | BL-404 | 2 | todo |
| BL-407 | Tokeny PAT: zakresy, ważność 90/365 dni, limity 30/min i 2 000/dobę, step-up, e-mail o nowej sieci, ekran tokenów | FR-07.07 | AUTH | BL-106 | 2,5 | todo |
| BL-408 | API szybkich akcji `/api/v1/quick/*` (tekst i JSON, pl-PL, < 300 ms) z `quick/alerts` | FR-09.04 | API, IOS | BL-407, BL-146, BL-404 | 2,5 | todo |
| BL-409 | Gotowe Skróty iOS (linki iCloud, pytania przy imporcie) i ekran `/ustawienia/integracje` | FR-09.05 | IOS, USR | BL-408 | 1,5 | todo |
| BL-410 | Konfiguracje HTTP Shortcuts (eksport bez tokenu) i instrukcja dla Androida | FR-09.06 | AND, USR | BL-408 | 1 | todo |
| BL-411 | Linki głębokie w powiadomieniach i e-mailach; powrót do celu po logowaniu | FR-09.07 | MOB, EKR | BL-402 | 1 | todo |
| BL-412 | Testy na urządzeniach (iOS 17 i 18, Android ≥ 12, Windows, macOS) z protokołem | FR-09.01, FR-09.03, FR-09.05, FR-09.06, FR-09.07, NFR-04.01 | MOB | BL-409, BL-410, BL-411 | 1,5 | todo |
| | **Suma etapu** | | | | **23,5** | |

## 6. M5a — Administracja, edukacja i rynek rozszerzony

| ID | Zadanie | Wymagania | Dokumenty | Zależy od | d | Status |
|---|---|---|---|---|---|---|
| BL-501 | Admin: sesje użytkowników i ich unieważnianie | FR-08.02 | EKR | BL-112 | 1 | todo |
| BL-502 | Admin: flagi funkcji (globalnie, per rola, per użytkownik), zmiana widoczna ≤ 60 s | FR-08.04 | MOD, EKR | BL-112, BL-117 | 1,5 | todo |
| BL-503 | Admin: limity ról i budżety dostawców | FR-08.03 | EKR | BL-215 | 1 | todo |
| BL-504 | Admin: przegląd audytu z filtrami i eksportem | FR-08.05 | EKR | BL-109, BL-112 | 1,5 | todo |
| BL-505 | Admin: kolejki — liczniki, zadania, ponawianie i usuwanie z audytem | FR-08.07 | EKR | BL-112 | 1,5 | todo |
| BL-506 | Admin: status dostawców, breaker, kwoty, wymuszenie odświeżenia | FR-08.06 | EKR | BL-131, BL-112 | 1,5 | todo |
| BL-507 | Admin: health i wersje usług, podsumowanie RUM | FR-08.08, NFR-01.01 | EKR, MON | BL-152, BL-112 | 1 | todo |
| BL-508 | Admin: dane rynkowe — import ręczny (CSV Stooq, XLS GPW) przez tę samą kontrolę jakości, korekty instrumentów, zdarzenia korporacyjne, kalendarz | FR-08.09 | EKR, IMP | BL-209, BL-112 | 3 | todo |
| BL-509 | Admin: blokada konta, reset 2FA, usunięcie konta (UI) | FR-08.01 | EKR | BL-112 | 1 | todo |
| BL-511 | Tryb demo: rachunek `demo`, fikcyjny portfel, test izolacji, stały baner | FR-06.04 | API, LAW | BL-144 | 2,5 | todo |
| BL-512 | Glosariusz ≥ 60 haseł i przegląd prostego języka treści | FR-06.03, NFR-06.03 | SLOW | BL-204 | 1,5 | todo |
| BL-513 | Heatmapa sektorowa GPW i USA (CSS grid, tabela alternatywna), klasyfikacja z subindeksów | FR-01.10 | [ADR-009](../09-decyzje/ADR-009-wykresy.md), SRC | BL-207 | 3 | todo |
| BL-514 | Screener: kryteria, zestawy, wyniki < 1 s na całej GPW, lista spełnionych warunków, bez rankingu | FR-01.11 | EKR, LAW | BL-201 | 3 | todo |
| BL-515 | Kalendarz: wyniki spółek USA, makro (FRED), wpisy admina dla GPW i RPP, filtr „moje” | FR-01.12 | SRC | BL-508 | 2 | todo |
| BL-516 | Interwały intraday 15 min i 1 h z danych opóźnionych, z etykietą i nieaktywnym przełącznikiem przy braku danych | FR-01.04 | CACHE | BL-134 | 2 | todo |
| | **Suma etapu** | | | | **27** | |

## 7. M5b — Analizy zaawansowane, OAuth i offline

Każde zadanie z analizą przyszłości kończy się przeglądem metodologicznym (checklisty w [`../../AGENTS.md`](../../AGENTS.md)).

| ID | Zadanie | Wymagania | Dokumenty | Zależy od | d | Status |
|---|---|---|---|---|---|---|
| BL-551 | Metryki ryzyka: zmienność, Sharpe, Sortino, beta, korelacja, VaR i CVaR historyczne — wektor D; ekran z założeniami | FR-03.10 | OBL, VEC | BL-319, BL-302 | 3 | todo |
| BL-552 | Atrybucja wyniku: pozycje, sektory, waluty | FR-03.08 | OBL | BL-303, BL-207 | 2 | todo |
| BL-553 | Statystyki skuteczności decyzji z dziennika | FR-03.12 | OBL | BL-309 | 1,5 | todo |
| BL-554 | Import generyczny CSV z szablonami mapowania kolumn | FR-03.04 | IMP | BL-145 | 3 | todo |
| BL-555 | Optymalizacja portfela (min. wariancja, HRP, max-Sharpe z ostrzeżeniem, Black-Litterman, resampling wag) | FR-04.03 | OBL, LAW | BL-312 | 4 | todo |
| BL-556 | Testy warunków skrajnych: scenariusze historyczne i hipotetyczne, jawne proxy, próg pokrycia 80 %, scenariusze admina | FR-04.04 | OBL | BL-312 | 3 | todo |
| BL-557 | Analiza „co jeśli” dla hipotetycznej pozycji | FR-04.05 | OBL | BL-312 | 2 | todo |
| BL-558 | Backtest (vectorbt): strategie regułowe, uniwersum point-in-time GPW, koszty i poślizg, IS/OOS, walk-forward | FR-04.08 | OBL | BL-312, BL-201 | 5 | todo |
| BL-559 | Raport backtestu: liczba prób, Deflated Sharpe Ratio, reżimy, test anty-look-ahead, definicje strategii w UI | FR-04.08, NFR-07.02 | OBL, LAW | BL-558 | 3 | todo |
| BL-560 | Kalkulator celu (wspólne liczby losowe, p = 50/75/90 %) | FR-04.09 | OBL | BL-313 | 1,5 | todo |
| BL-561 | Screening kandydatów na bazie screenera, z listą spełnionych kryteriów | FR-04.07 | LAW | BL-514 | 1,5 | todo |
| BL-562 | Alerty na wskaźnikach (te same funkcje co wykres) | FR-05.02 | MOD | BL-404, BL-201 | 2 | todo |
| BL-563 | Alerty portfelowe (zmiana wartości, obsunięcie, odchylenie alokacji) | FR-05.03 | MOD | BL-404, BL-305 | 1,5 | todo |
| BL-564 | Spike i wdrożenie OAuth z wymuszonym TOTP za flagą `auth.oauth` (ADR) | FR-07.03 | AUTH, [ADR-004](../09-decyzje/ADR-004-postgres-better-auth-rls.md) | BL-103 | 3 | todo |
| BL-565 | Migawka offline: tylko w zainstalowanej PWA, po zgodzie, ≤ 30 dni, kasowana przy wylogowaniu i 401 | FR-09.02 | UI, RODO | BL-401 | 2 | todo |
| BL-566 | Przegląd metodologiczny i zgodności funkcji M5b (checklisty, test języka) | NFR-07.02 | LAW | BL-559, BL-555 | 0,5 | todo |
| | **Suma etapu** | | | | **38,5** | |

## 8. M6 — Hardening i dostępność

| ID | Zadanie | Wymagania | Dokumenty | Zależy od | d | Status |
|---|---|---|---|---|---|---|
| BL-601 | Przegląd tabeli ASVS z dowodami i protokołem w `docs/06-bezpieczenstwo/przeglady/` | NFR-03.01 | SEC | — | 3 | todo |
| BL-602 | Pasywny skan DAST (ZAP baseline) na lokalnej instancji i poprawki | NFR-03.06, NFR-03.07 | SEC | — | 1,5 | todo |
| BL-603 | Trusted Types w trybie report-only i decyzja o włączeniu | NFR-03.06 | SEC | — | 1 | todo |
| BL-604 | Ćwiczenie DR — scenariusz D na zastępczej VM, protokół z RPO i RTO | NFR-09.03 | DR | — | 1,5 | todo |
| BL-605 | Ręczny audyt WCAG 2.1 AA (VoiceOver, TalkBack, NVDA) i poprawki | NFR-06.01, NFR-06.02 | A11Y | — | 3 | todo |
| BL-606 | Przegląd wydajności w terenie (RUM przez 2 tygodnie), poprawki albo decyzja L-04; aktualizacja konfliktów wydajności | NFR-01.01, NFR-01.09 | PERF, LIM | — | 2 | todo |
| BL-607 | Test obciążeniowy na serwerze docelowym: ≤ 5 użytkowników, p95 < 300 ms, RAM VM ≤ 6 GB obok Immicha | NFR-01.05, NFR-01.08, NFR-05.03 | PERF, ARCH | — | 1,5 | todo |
| BL-608 | Przegląd drzewa zależności, licencji i stosu 0 zł; aktualizacja modelu zagrożeń i rejestru ryzyk | NFR-03.09, NFR-05.01, NFR-10.05, NFR-03.01 | THR, RISK, LIM | — | 1 | todo |
| BL-609 | Przegląd odstępstw O-01…O-09 i warunków powrotu | NFR-03.01 | SEC | BL-601 | 0,5 | todo |
| BL-610 | Ćwiczenie planu reagowania (scenariusze P1, P6, P13) | NFR-03.10 | IR | — | 0,5 | todo |
| BL-611 | Aktualizacja dokumentacji użytkownika i administratora do stanu faktycznego | NFR-10.01 | USR, ADMIN | — | 1 | todo |
| BL-612 | OpenSSF Scorecard (opcjonalnie) i poprawki praktyk repozytorium | NFR-03.09 | CI | — | 0,5 | todo |
| | **Suma etapu** | | | | **17** | |

## 9. Później (P3 i propozycje)

Poza planem etapów; estymacja orientacyjna. Przed startem każde zadanie przechodzi ocenę z [`../11-zgodnosc-prawna.md`](../11-zgodnosc-prawna.md) § 8.

| ID | Zadanie | Wymagania | Dokumenty | Zależy od | d | Status |
|---|---|---|---|---|---|---|
| BL-701 | Volume Profile przybliżony z barów dziennych, jawnie oznaczony | FR-01.06 | OBL | BL-202 | 2 | todo |
| BL-702 | Newsy z „tonem” artykułów (GDELT) i opcjonalnym sentymentem dostawcy (USA) | FR-01.13 | SRC, LAW | BL-137 | 3 | todo |
| BL-703 | Alerty na wynikach spółek (przypomnienie N dni przed publikacją) | FR-05.04 | MOD | BL-515, BL-404 | 1 | todo |
| BL-704 | Alerty na newsach (limit 1 dziennie na instrument) | FR-05.05 | MOD | BL-702, BL-404 | 1,5 | todo |
| BL-705 | Ścieżki nauki z ćwiczeniami na danych demo i zapisem postępu | FR-06.05 | EKR | BL-511 | 4 | todo |
| BL-706 | Passkeys (WebAuthn) jako dodatkowa metoda logowania | FR-07.11 | AUTH | BL-105 | 3 | todo |
| BL-707 | Przykładowy widżet Scriptable (iOS) i widżet wartości HTTP Shortcuts (Android) | FR-09.08 | IOS, AND | BL-408 | 1 | todo |
| BL-708 | Propozycje: import „na żywo” przez XTB xAPI (bez przechowywania hasła) i udostępnianie pliku do PWA na Androidzie (Web Share Target) | — | SRC, AND, LAW | BL-145 | 3 | todo |
| | **Suma etapu** | | | | **18,5** | |

## 10. Podsumowanie

| Etap | Zadania | Suma (d) | Uwagi |
|---|---|---|---|
| M0 Szkielet i infrastruktura | 35 | 51 |  |
| M1 MVP | 47 | 102 | brama A 85,5 d, brama B 16,5 d |
| M2 Dane rynkowe, wskaźniki, onboarding | 16 | 29,5 |  |
| M3 Wyniki historyczne i scenariusze | 19 | 38,5 |  |
| M4 Alerty, PWA i Skróty | 12 | 23,5 |  |
| M5a Admin, edukacja, rynek | 15 | 27 |  |
| M5b Analizy zaawansowane, OAuth, offline | 16 | 38,5 |  |
| M6 Hardening i dostępność | 12 | 17 |  |
| **Razem M0–M6** | **172** | **327** | bez narzutu przeglądu (ok. +30 %) |
| Później | 8 | 18,5 | poza planem |

**Pokrycie wymagań:** każde z 151 wymagań FR/NFR z [`../00-przeglad/wymagania.md`](../00-przeglad/wymagania.md) ma co najmniej jedno zadanie (sprawdzone skryptem 2026-09-19: brak wymagań bez zadania, brak zależności wstecz między etapami, M3 i M4 niezależne). Pełna macierz wymaganie → dokument → zadanie: [`../00-przeglad/macierz-pokrycia.md`](../00-przeglad/macierz-pokrycia.md).
