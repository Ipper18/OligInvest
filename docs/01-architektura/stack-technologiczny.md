# Stack technologiczny

**Cel:** zapisać każdy element stosu OligInvest z wersją, licencją i uzasadnieniem wyboru (oraz odrzuconymi alternatywami), tak aby żadna zależność nie trafiła do projektu bez powodu.

Stan na **2026-09-18**. Wersje pochodzą z `npm view`, PyPI JSON API, GitHub Releases i stron projektów; research porównawczy w [`../09-decyzje/research-biblioteki.md`](../09-decyzje/research-biblioteki.md). Wersje w repozytorium przypina lockfile (`pnpm-lock.yaml`, `uv.lock`), a aktualizacje proponuje Renovate — tabela podaje linię wersji, od której startujemy.

## 1. Polityka zależności

Nowa zależność runtime trafia do projektu tylko, jeśli spełnia **wszystkie** warunki:

1. Nie da się tego sensownie zrobić standardem platformy (Web API, Node, PostgreSQL, CSS) w < 1 dniu pracy i < 200 linii.
2. Licencja: MIT, Apache-2.0, BSD, ISC, MPL-2.0, BlueOak-1.0.0, MIT-0, PostgreSQL; LGPL tylko jako biblioteka bez modyfikacji; **bez AGPL/GPL w kodzie aplikacji** (dopuszczalne jako osobne usługi infrastrukturalne).
3. Aktywne utrzymanie (release lub commit ≤ 6 miesięcy) albo świadomie zaakceptowane ryzyko opisane w tym dokumencie.
4. Wpływ na bundle przeglądarki mieści się w budżecie trasy (`04-frontend/wydajnosc.md`).
5. Wpis w tym dokumencie (lub w ADR) z uzasadnieniem.

BL-017 (2026-09-30): Next.js **16.3.6** zastępuje 16.3.5 ze względu na [GHSA-vcvr-r3jv-pc5j](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j), CVSS 9,5. Poprawka opublikowana w npm 2026-09-22 16:19 UTC, po karencji; bez wyjątku OSV i bez zmiany linii stosu. OligInvest nie używa `next/og`, jednak próg audytu obowiązuje niezależnie od osiągalności. OSV Scanner **2.6.0** i Syft **1.52.0** (Apache-2.0) to istniejące wybory stosu, przypięte w skrypcie instalacji CI z SHA-256 oficjalnych artefaktów GitHub Releases (sprawdzone 2026-09-30); nie trafiają do runtime aplikacji.

Decyzja właściciela 2026-10-08: BlueOak-1.0.0 dopuszczona ogólnie w polityce i audycie licencji, bez wyjątków per pakiet; kontrole podatności i pokrycia SBOM pozostają obowiązkowe. Rozbudowane zależności runtime yahoo-finance2 4.0.2 pozostają bez zmian w M1-2; osobna ocena w BL-159 (R-33).

BL-017 (2026-10-08): Next.js **16.3.8** zastępuje 16.3.6; [GHSA-cjq9-62q9-8jv4](https://github.com/vercel/next.js/security/advisories/GHSA-cjq9-62q9-8jv4), CVSS 8,3, poprawka wskazana przez OSV. Wydanie npm 2026-09-30 16:07 UTC, poza karencją; aktualizacja w tej samej linii bez overrides i wyjątków OSV. Frozen install, testy/build web i pełny audyt zależności PASS. Graf Yahoo bez zmian.

## 2. Runtime i platforma

| Element | Wybór | Wersja | Licencja | Uzasadnienie | Odrzucone |
|---|---|---|---|---|---|
| Runtime JS | **Node.js** | 24 LTS „Krypton” (Active LTS; migracja na 26 LTS po październiku 2026) | MIT | LTS = poprawki bezpieczeństwa do 04.2028; wymagany przez Next.js, Hono, BullMQ. | Node 25/26 Current (brak LTS), Bun/Deno (mniejsza zgodność ekosystemu, ryzyko dla Better Auth/BullMQ). |
| Runtime Python | **Python** | 3.13 | PSF | Kolo wheels dla cp313: numpy 2.5, scipy 1.18, pandas 3.0, numba 0.67, cvxpy 1.9, TA-Lib 0.8 (zweryfikowane); vectorbt 1.1 wymaga ≥ 3.11. | 3.14 (młodsze wheels części bibliotek), 3.12 (numpy 2.5 wymaga ≥ 3.12 — działa, ale bez powodu do starszej wersji). |
| Baza danych | **PostgreSQL** | 18 (18.6; wsparcie do 14.11.2030) | PostgreSQL | RLS, `NUMERIC`, natywne `uuidv7()`, dojrzałość; najdłuższe wsparcie spośród wspieranych wersji. | 16 (wsparcie do 2028, bez `uuidv7()`), SQLite (brak RLS), Supabase (ADR-004). |
| Magazyn klucz-wartość | **Valkey** ×2 (kolejki; cache) | 9.1 | BSD-3 | Zgodny z protokołem Redis; BullMQ wykrywa Valkey automatycznie; licencja OSI. Dwie instancje, bo BullMQ wymaga `noeviction`, a cache — polityki LRU ([ADR-003](../09-decyzje/ADR-003-hybryda-obliczen-i-kolejki.md)). | Redis 8 (AGPLv3/SSPL/RSAL — dopuszczalne, ale bez przewagi), Dragonfly (BSL), pg-boss bez Valkey (brak portu dla Pythona). |
| System VM | **Debian** | 13 „trixie” | — | Stabilna baza dla Dockera; zgodna z Proxmox VE 9 (także Debian 13). | Ubuntu (brak przewagi), Alpine jako OS VM (musl, mniej narzędzi). |
| Konteneryzacja | **Docker Engine + Compose v2** | bieżące stabilne z repozytorium Dockera | Apache-2.0 | Standard; jeden plik `compose.yaml` na środowisko; limity zasobów per kontener. | Kubernetes/K3s (nadmiarowy dla jednego węzła), Podman (mniej przykładów dla Compose). |
| Wirtualizacja | **Proxmox VE** (istniejący) | wersja właściciela (❓ do odnotowania w `07-wdrozenie`) | AGPL-3.0 (host, bez zmian) | Już działa na serwerze; izolacja VM od Immicha. | LXC zamiast VM (słabsza izolacja kernela dla danych finansowych). |

## 3. Monorepo i narzędzia deweloperskie

BL-011: `openapi-fetch` **0.17.0** (MIT) realizuje klienta wskazanego w architekturze UI § 3. `server-only` **0.0.1** (MIT) to stabilny znacznik kompilatora Next.js; świadomie używamy starszej wersji, a ochronę potwierdza negatywny build. Zod **4.6.5** i `@oliginvest/config` walidują wejścia wyłącznie na serwerze. `@playwright/test` **1.63.0** (Apache-2.0) służy do kontroli produkcyjnego CSP i zasobów strony testowej; pełna macierz pozostaje BL-018. Runtime klienta nie trafia do przeglądarki. Licencje i wersje potwierdzone w npm; instalacja frozen z niezmienionymi politykami pnpm.

BL-011 — wyjątek zatwierdzony 2026-09-29: prywatny workspace `tools/openapi-client` ma wyłącznie devDependencies `openapi-typescript` **7.13.0** i `typescript` **5.9.3** (MIT/Apache-2.0), w dokładnych wersjach. Generator wymaga peer TS `^5.x`; kod aplikacji, w tym web, nadal sprawdza TS **7.0.2**. `strictPeerDependencies: true` pozostaje bez wyciszeń. Narzędzie generuje commitowany `apps/web/src/api/schema.d.ts`; `pnpm check:api-client` w `contracts` sprawdza zgodność z OpenAPI. `check:deps` zabrania zależności i importów narzędzia z aplikacji, modułów i pakietów. Renovate grupuje ten workspace osobno, TS ogranicza do 5.x, bez automerge. **Warunek usunięcia wyjątku:** `openapi-typescript` obsługuje TS 7 i przechodzi generowanie oraz test zgodności; wtedy usuwamy prywatny TS 5. Bez nowego ADR, bo kompilator aplikacji się nie zmienia.

BL-010 (2026-09-27): `@redocly/cli` **2.54.2** (MIT) jako devDependency realizuje wymagany lint OpenAPI; `yaml` **2.9.1** (ISC, już obecny w lockfile) jest jawną devDependency do odczytu kontraktu w testach i generatorze pending. Node nie ma parsera YAML ani walidatora OpenAPI. Narzędzia nie trafiają do przeglądarki ani runtime API. Wersje/licencje sprawdzone w rejestrze npm; Redocly wydane 2026-09-22, wersja 2.54.3 pominięta z powodu karencji. Instalacja frozen przy niezmienionych politykach pnpm; bez nowych skryptów instalacyjnych. Dokumentacja: [lint Redocly](https://redocly.com/docs/cli/commands/lint), [parser YAML](https://eemeli.org/yaml/).

| Element | Wybór | Wersja | Licencja | Uzasadnienie | Odrzucone |
|---|---|---|---|---|---|
| Menedżer pakietów JS | **pnpm** | 12.4 | MIT | Ścisła izolacja zależności (brak „fantomowych” importów — pomaga egzekwować granice modułów), szybki, workspaces. | npm (hoisting ukrywa brakujące zależności), Yarn (brak przewagi). |
| Orkiestracja zadań | **Turborepo** | 2.10.13 na starcie M0; 2.11 osobnym PR Renovate po karencji | MIT | Graf zadań i cache buildów/testów per pakiet ([ADR-002](../09-decyzje/ADR-002-monorepo.md)); wersja startowa zgodnie z [ADR-015](../09-decyzje/ADR-015-linia-turborepo-na-starcie-m0.md), decyzja 2026-09-21. | Nx (więcej abstrakcji i generatorów niż potrzebujemy). |
| Język | **TypeScript** | 7.0 (kompilator natywny) | Apache-2.0 | Szybkie sprawdzanie typów w monorepo; `strict`. Jeśli któraś biblioteka okaże się niezgodna — powrót do linii 6.x (decyzja w M0). | JS bez typów. |
| Lint + format (TS/JS/JSON/CSS) | **Biome** | 2.5 | MIT/Apache-2.0 | Jedno narzędzie zamiast ESLint + Prettier + wtyczek; szybkie; reguły React hooks i dostępności. Next.js 16 nie ma już `next lint`. | ESLint + Prettier (więcej zależności i konfiguracji). |
| Python: zależności | **uv** | 0.12 | MIT/Apache-2.0 | Lockfile (`uv.lock`), szybkie instalacje, zarządzanie wersją Pythona. | pip-tools, Poetry (wolniejsze). |
| Python: lint + format | **Ruff** | 0.16 | MIT | Jedno narzędzie (lint + format). | flake8 + black + isort. |
| Python: typy | **mypy** | 2.3 | MIT | Dojrzały, tryb `strict` dla kodu analityki. | pyright (dodatkowy runtime Node w obrazie Pythona). |
| Testy TS | **Vitest** | 5.0 | MIT | Szybki, zgodny z ESM/TS, `bench` dla wydajności `core`. | Jest (wolniejszy z ESM). |
| Testy Python | **pytest** + **hypothesis** | 9.1 / 6.168 | MIT / MPL-2.0 | Testy właściwości (property-based) dla wzorów i symulacji. | unittest. |
| Testy e2e | **Playwright** + `@axe-core/playwright` | 1.63 / 4.13 | Apache-2.0 / MPL-2.0 | Chromium, WebKit (Safari/iOS), Firefox w jednym narzędziu; testy dostępności. | Cypress (brak WebKit). |
| Budżety wydajności | **Lighthouse** (uruchamiany w CI skryptem z asercjami) + **size-limit** | 13.5 / 14.0 | Apache-2.0 / MIT | LCP/CLS/TBT w CI; twardy limit rozmiaru JS per trasa (NFR-01.02); szczegóły w `04-frontend/wydajnosc.md` § 6. | `@lhci/cli` 0.15.1 — ostatnie wydanie 2025-06, zawiera Lighthouse 12.6.1 (sprawdzone 2026-09-19); tylko ręczne pomiary. |

### 3.1 Pakiety pomocnicze szkieletu M0-1

Decyzja właściciela 2026-09-21: start na `bullmq` npm 6.3.6, `bullmq` PyPI 3.2.2 (najnowsze dojrzałe 3.2.x), `psycopg` i `psycopg-binary` 3.3.5; późniejsze patche proponuje Renovate w zwykłym trybie po karencji. Źródła publikacji i sumy kontrolne: [inwentarz](../08-plan/audits/m0-1-release-age.json). Lighthouse 13.5.0 dodano do manifestu w BL-016 (2026-09-30, po karencji zakończonej 2026-09-21). Better Auth 1.7.5 jest zależnością deweloperską `apps/api` dla spików BL-032 i BL-030/031, bez produkcyjnej implementacji uwierzytelniania. BL-030/031 dodaje devDependencies `@better-auth/api-key` 1.7.5 i `@node-rs/argon2` 2.2.1 (MIT): rzeczywiste testy zapisu kluczy i kalibracji Argon2id wymagają implementacji bibliotek; instalacja frozen z karencją, bez tych pakietów w obrazach runtime.

Przygotowane manifesty (BL-001, 2026-09-20) używają dokładnych wersji z [inwentarza audytu](../08-plan/audits/m0-1-release-age.json). 2026-09-21 utworzono oba lockfile, porównano wybrane wersje i sumy z audytem oraz wykonano instalacje frozen i lokalne testy; dowody w [raporcie sesji § 8](../08-plan/m0-1-session-history.md#8-lockfile-i-instalacja-po-zatwierdzeniu-patchy--2026-09-21). Pełny audyt CI pozostaje do BL-017.

| Pakiet | Wersja | Licencja | Uzasadnienie |
|---|---|---|---|
| `@types/node` | 24.13.5 | MIT | Deklaracje API Node 24 dla aplikacji serwerowych i pakietów z I/O; bez kodu runtime |
| `@types/react`, `@types/react-dom` | 19.3.0 | MIT | Deklaracje React 19.3 dla Next.js i wspólnego UI; bez kodu runtime |
| `@types/pg` | 8.23.1 | MIT | Deklaracje sterownika `pg` dla typowanych pul i transakcji RLS |
| `ioredis` | 6.0.0 | MIT | Sterownik Valkey dla BullMQ 6.3 (opcjonalny peer, wymagany przez wybrany backend Redis), sesji/flag w API oraz limitów i cache w `packages/data-providers` (BL-131); tylko backend, bez zależności web/Pythona. Kwoty i breaker w trwałym `valkey-queue`, cache w `valkey-cache`; stałe skrypty Lua z argumentami i kontrolą właściciela blokady. Publikacja 2026-07-31, sprawdzone 2026-09-28 w [rejestrze npm](https://registry.npmjs.org/ioredis/6.0.0) |
| `@vitest/coverage-v8` | 5.0.1 | MIT | Provider pokrycia Vitest tej samej wersji, potrzebny do bramki pokrycia `core` |
| `setuptools` | 84.0.0 | MIT | Backend budowania minimalnego pakietu Python (BL-002); przypięty w build-system i grupie dev, już uwzględniony w audycie; build bez izolowanego pobierania zależności |
| `@tailwindcss/postcss` | 4.3.3 | MIT | Oficjalny adapter Tailwind 4 dla potoku CSS Next.js |
| `size-limit`, `@size-limit/esbuild`, `@size-limit/file` | 14.0.0 | MIT | BL-016: bundlowanie współdzielonych wejść i kontrola gzip; tylko narzędzia deweloperskie web |
| `esbuild` | 0.28.2 | MIT | BL-033: powtarzalne pomiary Zod i natywnych prymitywów UI; ta sama zatwierdzona wersja co w potoku testowym |
| `chrome-launcher` | 1.2.1 | Apache-2.0 | BL-016: programowe uruchamianie lokalnego Chromium dla Lighthouse 13.5.0, bez pobierania przeglądarki przez skrypt; 1.2.2 jeszcze w karencji |

Te pakiety uzupełniają wybrane narzędzia, bez zmiany architektury lub ADR. Inne biblioteki figurujące w audycie (np. Better Auth do spike BL-032, narzędzia e2e i biblioteki naukowe) nie są automatycznie dodawane do manifestów. `apps/analytics/package.json` zawiera wyłącznie polecenia dla Turbo; minimalne zależności Pythona są już zapisane w `pyproject.toml` i `uv.lock`; konsument testowej kolejki BL-014 korzysta z tego samego lockfile, bez dodatkowych zależności Pythona.

Ustawienia pnpm 12 poza rejestrem są w `pnpm-workspace.yaml`: `saveExact`, `engineStrict`, `pmOnFail: error` (odrzucenie niezgodnej wersji menedżera bez jej automatycznego pobrania). `.npmrc` wskazuje rejestr, bez poświadczeń. `allowBuilds` zawiera decyzje dla dokładnych wersji pnpm/esbuild/fsevents/msgpackr-extract po [przeglądzie skryptów](../08-plan/m0-1-install-scripts.md); nowe wersje wymagają ponownego przeglądu. Źródła konfiguracji, sprawdzone 2026-09-20: [ustawienia pnpm 12](https://pnpm.io/settings), [pmOnFail](https://pnpm.io/settings/cli#pmonfail).

## 4. Frontend (`apps/web`)

| Element | Wybór | Wersja | Licencja | Uzasadnienie | Odrzucone |
|---|---|---|---|---|---|
| Framework | **Next.js** (App Router) | 16.3 | MIT | SSR, React Server Components i streaming = szybki pierwszy render na telefonie; manifest PWA i CSP z nonce (`proxy.ts`) wbudowane. | Vite SPA (gorsze LCP bez SSR), Remix/React Router 7 (brak przewagi przy RSC), Astro (słabszy dla aplikacji interaktywnej). |
| Biblioteka UI | **React** | 19.3 | MIT | Standard ekosystemu; wymagany przez Next.js. | — |
| Style | **Tailwind CSS** | 4.3 | MIT | Zero runtime JS, tokeny jako zmienne CSS (`@theme`), małe CSS dzięki usuwaniu nieużytych klas. | CSS-in-JS (koszt runtime), czysty CSS Modules (wolniejsza praca bez systemu tokenów). |
| Prymitywy dostępne | **HTML natywny** (`<dialog>`, atrybut `popover`, `<details>`, formularze) + **Radix Primitives** tylko tam, gdzie natywne nie wystarczą (np. menu z nawigacją klawiaturą, combobox wyszukiwarki) | Radix 1.x/2.x per komponent | MIT | Dostępność (focus, ARIA) bez pisania od zera; import per komponent (małe chunki). Lista dozwolonych komponentów w `04-frontend/architektura-ui.md`. | Pełne biblioteki komponentów (MUI, Mantine — ciężkie), shadcn/ui jako całość (kopiujemy tylko potrzebne wzorce). |
| Pobieranie danych po stronie klienta | **TanStack Query** | 5.103 | MIT | Cache zapytań, deduplikacja, unieważnianie na zdarzenia SSE; przewidywalne stany ładowania. | SWR (mniej kontroli nad unieważnianiem), własny cache (błędogenny). |
| Tabele | **TanStack Table** + **TanStack Virtual** | 9.2 / 3.14 | MIT | Headless (własne style, WCAG), wirtualizacja długich list (dziennik, screener). | AG Grid (ciężki, część płatna). |
| Wykresy finansowe | **TradingView Lightweight Charts** | 5.2 | Apache-2.0 (wymagana atrybucja TradingView) | Świece + wolumen na canvas, 60 KB gzip, płynny na telefonie ([ADR-009](../09-decyzje/ADR-009-wykresy.md)). | ECharts (359 KB), Recharts/visx (SVG). |
| Wykresy serii | **uPlot** | 1.6 | MIT | 21 KB gzip; krzywe kapitału, obsunięcia, wachlarze percentyli. | Chart.js (większy, wolniejszy przy dużych seriach). |
| Onboarding | **driver.js** | 1.8 | MIT | 7 KB, bez zależności, dostępny z klawiatury; ładowany leniwie. | Shepherd.js (AGPL), react-joyride (większy). |
| PWA | **Manifest z Next.js** (`app/manifest.ts`) + **własny service worker** (`public/sw.js`, wg oficjalnego przewodnika PWA Next.js 16) | — | — | Standard platformy: push, `notificationclick`, cache powłoki offline; zero zależności ([ADR-008](../09-decyzje/ADR-008-pwa-i-integracje-mobilne.md)). | Serwist (dodatkowa zależność; generowanie manifestu precache nie jest potrzebne — zasoby `/_next/static/*` cache'ujemy w runtime). |
| Formularze | **Natywne formularze** + walidacja HTML (Constraint Validation API); źródłem prawdy są schematy **Zod** w `api` (błędy `422` mapowane na pola) | — | — | Zero JS walidacji w początkowym bundlu; Zod w przeglądarce tylko w leniwych, złożonych formularzach (pomiar: ≈ 25 KB gz, import `{ z }` ≈ 90 KB gz — `04-frontend/architektura-ui.md` § 11). | react-hook-form (niepotrzebny przy prostych formularzach). |
| Internacjonalizacja | **`Intl`** (liczby, waluty, daty) + słowniki komunikatów w `packages/i18n` | — | — | Standard platformy; PL na start, klucze gotowe na EN (NFR-10.04). | next-intl/i18next (zbędne przy jednym języku). |
| Stan globalny | **Brak biblioteki** (stan w URL, TanStack Query, lokalny stan React) | — | — | Mniej warstw. | Redux/Zustand. |

BL-012: `packages/i18n` deklaruje bezpośrednio istniejące `decimal.js` 10.6.0 (MIT), aby przyjmować i rozpoznawać `Decimal`; formatery przekazują dokładny ciąg dziesiętny do `Intl`, bez obliczeń finansowych i bez zależności od `packages/core`. Test zgodności kodów błędów używa istniejącego `yaml` 2.9.1 (ISC, tylko dev). `@axe-core/playwright` 4.13.0 (MPL-2.0, tylko dev w web) realizuje audyt natywnych prymitywów i komponentów zgodności. Testy renderowania `packages/ui` deklarują istniejący `react-dom` 19.3.0 (MIT, dev). Brak nowych bibliotek UI.

BL-007: pakiet db deklaruje także istniejące `zod@4.6.5` do walidacji konfiguracji puli i kontekstu transakcji; siedem modułów posiadających tabele deklaruje istniejące `drizzle-orm@0.45.2` bezpośrednio, aby pnpm egzekwował zależności definicji `db/schema.ts`. Odwołania do tabel modułów fundamentowych przechodzą przez `/server`; warunek `default` eksportu wskazuje ten sam plik ESM co `import`, także dla narzędzia Drizzle Kit działającego w Node 24. Nie dodano nowej biblioteki ani wersji; pozostałe wiersze tej tabeli zachowują dotychczasowe decyzje.

## 5. Backend (`apps/api`, `apps/jobs`, moduły)

| Element | Wybór | Wersja | Licencja | Uzasadnienie | Odrzucone |
|---|---|---|---|---|---|
| Framework HTTP | **Hono** + `@hono/node-server` | 4.13 / 2.1 | MIT | Lekki, oparty na standardach Web (Request/Response), dobre wsparcie SSE, integracja z Better Auth. | Express (brak typów i Web API), Fastify (więcej konwencji), NestJS (ciężki). |
| Kontrakty i OpenAPI | **Zod** + `@hono/zod-openapi` | 4.6 / 1.6 (peer: zod ^4) | MIT | Jedna definicja schematu → walidacja, typy, OpenAPI, JSON Schema dla Pythona (`z.toJSONSchema`) ([ADR-012](../09-decyzje/ADR-012-api-jako-granica-domenowa.md)). | tRPC (nie-REST; trudny dla Skrótów), ręczne OpenAPI. |
| Uwierzytelnianie | **Better Auth** + wtyczki `twoFactor`, `admin`, `haveIBeenPwned`, `@better-auth/api-key` | 1.7.5 | MIT | TOTP + kody zapasowe, role i bany, klucze API z zakresami i limitami (PAT), adapter Drizzle ([ADR-004](../09-decyzje/ADR-004-postgres-better-auth-rls.md)). | Auth.js (brak TOTP), Keycloak (Java, ~1 GB RAM), Lucia (wycofana). |
| Hashowanie haseł | **@node-rs/argon2** (Argon2id) | 2.2 | MIT | Better Auth domyślnie używa scrypt; specyfikacja wymaga Argon2id → własne funkcje `hash`/`verify`. Natywne wiązania Rust, bez kompilacji node-gyp. | `argon2` (node-gyp), scrypt (niezgodne z wymaganiem). |
| Adapter uwierzytelniania SQL | **@better-auth/drizzle-adapter** | 1.7.5 | MIT | BL-101: adapter wydzielony z Better Auth, używa przypiętego Drizzle 0.45.2 i transakcji puli `oliginvest_auth`; potrzebny do produkcyjnej integracji SQL. Better Auth, API key i Argon2id przechodzą z devDependencies do dependencies API w M1-1. | Własny adapter SQL (powielanie biblioteki). |
| ORM i migracje | **Drizzle ORM** + **drizzle-kit** | 0.45.2 / 0.31.10 | Apache-2.0 / MIT | SQL-owy, bez silnika pośredniczącego, pełna kontrola nad transakcjami (`SET LOCAL` dla RLS); wspierany przez Better Auth. | Prisma (silnik zapytań, trudniejsze RLS per transakcja), Kysely (brak migracji z pudełka). |
| Sterownik PostgreSQL | **pg** (node-postgres) | 8.23 | MIT | Dojrzały, wspierany przez Drizzle i Better Auth. BL-009: także bezpośrednia zależność `apps/api` (`pg` 8.23.0, `@types/pg` 8.23.1) wyłącznie do sondy `SELECT 1`; bez nowych wersji w lockfile. Sonda Valkey używa `node:net` i ograniczonej wymiany AUTH/PING bez dodatkowego klienta. | postgres.js (Unlicense; brak przewagi). |
| Kolejki | **BullMQ** (Node) / **bullmq** (Python) | 6.3 / 3.2 | MIT | Jeden system kolejek dla dwóch runtime'ów; priorytety, opóźnienia, ponowienia, limity, zdarzenia postępu ([ADR-003](../09-decyzje/ADR-003-hybryda-obliczen-i-kolejki.md)). | Celery + BullMQ (dwa systemy), pg-boss (brak Pythona). |
| Logi | **pino** | 10.3 | MIT | Szybkie logi JSON, redakcja pól wrażliwych. | winston (wolniejszy). |
| Pieniądze | **decimal.js** | 10.6 | MIT | Arytmetyka dziesiętna o konfigurowalnej precyzji ([ADR-014](../09-decyzje/ADR-014-pieniadze-waluty-czas.md)). | `number` (błędy zmiennoprzecinkowe), big.js (brak funkcji potrzebnych w XIRR, np. `pow` z ułamkiem), Dinero.js (zbędna warstwa). |
| Pliki XLS/XLSX/CSV | **SheetJS Community Edition** (`xlsx`) z oficjalnego CDN | 0.20.3 | Apache-2.0 | Archiwum GPW zwraca binarny XLS (BIFF), XTB — XLSX; jedna biblioteka dla obu i dla CSV. Rejestr npm ma przestarzałe 0.18.5 z podatnościami — instalujemy z `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` (hash w lockfile, Renovate z regułą niestandardową). Tylko po stronie serwera (`jobs`). | read-excel-file (bez XLS), exceljs (brak wydań od 2023), parsowanie w Pythonie (wymagałoby internetu i zapisu w `analytics`). |
| Klient Yahoo Finance | **yahoo-finance2** | 4.0 | MIT | Utrzymywany klient nieoficjalnego API (obsługa ciasteczek/crumb, walidacja odpowiedzi); tylko w adapterze `yahoo`. | Własny klient `fetch` (koszt nadążania za zmianami Yahoo). |
| E-mail | **nodemailer** przez SMTP (Brevo) | 10.0.13 (BL-107; `@types/nodemailer` 8.0.2) | MIT-0 | Worker `jobs` wysyła reset hasła; transport SMTP z wymaganym STARTTLS, bez SDK dostawcy ([ADR-010](../09-decyzje/ADR-010-kanaly-powiadomien.md)). Wersja 10.0.13 po karencji 72 h; nowsza 10.0.14 jeszcze przed karencją 2026-10-04. | SDK dostawców (uzależnienie). |
| Web Push | **web-push** | 3.6 | MPL-2.0 | Standardowa implementacja VAPID i szyfrowania treści powiadomień. | Własna implementacja (kryptografia — nie piszemy sami). |
| Magazyn sesji/limitów (opcjonalnie) | `@better-auth/redis-storage` | 1.7.5 | MIT | Jeśli limity Better Auth mają trafić do Valkey zamiast Postgresa — decyzja w `06-bezpieczenstwo/`. | — |

## 6. Analityka (`apps/analytics`, Python)

M1-2: moduł `market` korzysta z już przypiętego `ioredis` 6.0.0 (MIT) do trwałych limitów pobierania oraz publikacji notowań w `jobs`; nie dodaje nowej biblioteki do przeglądarki. `api` i `jobs` zależą od publicznych eksportów modułu `market`.

| Element | Wybór | Wersja | Licencja | Uzasadnienie | Odrzucone |
|---|---|---|---|---|---|
| Backtesting | **vectorbt** | 1.1 (wymaga pandas ≥ 3.0.3, numpy ≥ 2.4.6) | Apache-2.0 + **Commons Clause** (zakaz sprzedaży oprogramowania, którego wartość wynika z vectorbt) | Wektorowe backtesty wielu wariantów, walk-forward; baza wiedzy w skillu `vectorbt-reference`. Ograniczenie licencyjne opisane w [`../10-ograniczenia.md`](../10-ograniczenia.md) (L-41; nie dotyczy użytku prywatnego). | backtesting.py (AGPL), nautilus_trader (silnik live, zbyt ciężki). |
| Optymalizacja portfela | **PyPortfolioOpt** + **cvxpy** | 1.6 / 1.9 | MIT / Apache-2.0 | Markowitz, Black-Litterman, HRP, ograniczenia wag — gotowe i sprawdzone. | Własna implementacja (ryzyko błędów numerycznych). |
| Metryki i raporty | **quantstats** | 0.0.81 | Apache-2.0 | Metryki i tearsheety dla wyników symulacji. | pyfolio-reloaded (starszy, cięższy). |
| Numeryka | **numpy**, **pandas**, **scipy** | 2.5 / 3.0 / 1.18 | BSD | Standard. | — |
| Kolejka | **bullmq** (Python) | 3.2 | MIT | Ten sam protokół kolejek co Node. | Celery. |
| Dostęp do danych rynkowych | **psycopg** | 3.3 | LGPL-3.0 (używany bez modyfikacji) | Dojrzały sterownik; rola tylko do odczytu. | SQLAlchemy (zbędna warstwa). |
| Walidacja wejścia | **jsonschema** | 4.26 | MIT | Walidacja treści zadań schematami eksportowanymi z Zod — jedno źródło prawdy kontraktu. | Ręczne modele Pydantic (duplikacja kontraktu). |
| Tylko testy | **TA-Lib** (python), **empyrical-reloaded** (≥ 0.5.12 — starsze używają `np.NINF`, usuniętego w NumPy 2) | 0.8 / 0.5.12 | BSD / Apache-2.0 | Wartości referencyjne dla wektorów testowych `packages/core` i analityki. | pandas-ta (repozytorium autora zniknęło z GitHuba). |

## 7. Infrastruktura, CI/CD i łańcuch dostaw

BL-017, przegląd licencji 2026-09-30: właściciel zatwierdził **Python-2.0 wyłącznie dla argparse**, **PSF-2.0 dla typing-extensions** i **CC-BY-4.0 dla caniuse-lite**. Pozostała allowlista z §1 i SEC §4.4 bez rozszerzeń. LGPL w istniejących psycopg/psycopg-binary i pakietach @img/sharp-* dotyczy niezmodyfikowanych bibliotek: natywne libvips są linkowane dynamicznie, opcjonalny wariant WASM występuje w lockfile, ale nie jest używany przez aplikację. Nie jest to ogólna zgoda na LGPL w innych pakietach; zmiana sposobu dystrybucji wymaga ponownego przeglądu.

Syft tworzy CycloneDX ze **wszystkich pakietów obu lockfile**, także wariantów platformowych; wzbogaca licencje z rejestrów, a kontrola porównuje pokrycie z pełnym wynikiem OSV. Uzupełnienia niepełnych metadanych są przypisane do konkretnych wersji: bullmq 3.2.2 MIT i pathspec 1.1.1 MPL-2.0 (klasyfikatory PyPI), colorama 0.4.6 BSD-3-Clause oraz mypy-extensions 1.1.0 MIT (LICENSE w zainstalowanym wheel), python-dateutil 2.9.0.post0 Apache-2.0 OR BSD-3-Clause (LICENSE w wheel). Nazwy „MIT License” i „Apache 2.0” są normalizowane do SPDX. Źródła: [PyPI bullmq](https://pypi.org/project/bullmq/3.2.2/), [pathspec](https://pypi.org/project/pathspec/1.1.1/), [colorama](https://pypi.org/project/colorama/0.4.6/), [mypy-extensions](https://pypi.org/project/mypy-extensions/1.1.0/), [python-dateutil](https://pypi.org/project/python-dateutil/2.9.0.post0/). Własny prywatny workspace oliginvest-analytics nie podlega allowliście zależności (ADR-013). Inna nieznana licencja lub brak pakietu w SBOM blokuje audyt. M1-2 (2026-10-07): wersja i licencja SheetJS CE 0.20.3 są odczytywane z `package.json` i `LICENSE` oficjalnego tarballa CDN, po sprawdzeniu SHA-512 z lockfile. Syft zapisuje URL jako wersję — audyt uzupełnia CycloneDX do `xlsx@0.20.3`, Apache-2.0. Dla tego konkretnego artefaktu zakresy dwóch starych zgłoszeń npm są uzupełniane według advisories producenta: [CVE-2023-30533](https://cdn.sheetjs.com/advisories/CVE-2023-30533) poprawione od 0.19.3 oraz [CVE-2024-22363](https://cdn.sheetjs.com/advisories/CVE-2024-22363) od 0.20.2. Surowe wyniki OSV pozostają w raporcie; zmiana wersji, źródła, hasha lub zakresu wymaga ponownego przeglądu. Nowe zgłoszenia nadal blokują; bez wyjątków OSV.


| Element | Wybór | Wersja | Licencja | Uzasadnienie | Odrzucone |
|---|---|---|---|---|---|
| Reverse proxy w VM | **Caddy** | 2.11 | Apache-2.0 | Automatyczne certyfikaty ACME, TLS 1.3 domyślnie, prosta konfiguracja. | nginx w VM (ręczna obsługa certyfikatów), Traefik (więcej ruchomych części). |
| Edge na VPS | **nginx `stream`** (`ssl_preread`, protokół PROXY do domu) + **WireGuard** + firewall | pakiety Debiana | BSD-2 / GPL-2.0 (kernel) | Routing po SNI bez odszyfrowania ruchu; zastępuje obecny Caddy na VPS, który dziś kończy TLS dla Immicha ([ADR-011](../09-decyzje/ADR-011-topologia-wdrozenia.md)). | Cloudflare Tunnel (terminacja TLS u firmy trzeciej), Caddy z modułem `layer4` (własna kompilacja), HAProxy (alternatywa). |
| Ochrona przed nadużyciami | **CrowdSec** (agent w VM; LAPI i bouncer nftables na VPS) | 1.8 | MIT | Wykrywanie na podstawie logów Caddy w domu, blokowanie już na krawędzi; darmowa sieć reputacji. | fail2ban (tylko lokalne reguły; może działać równolegle dla SSH). |
| Kopie zapasowe | **pgBackRest** (PostgreSQL: kopie pełne i różnicowe + ciągła archiwizacja WAL, odtwarzanie do punktu w czasie) + **restic** z **rest-server** `--append-only` na VPS (kopia poza domem) | 2.59 / 0.19 / 0.14 | MIT / BSD-2 / BSD-2 | RPO bazy: minuty lokalnie, ≤ 1 h poza domem; szyfrowane repozytoria; tryb append-only chroni kopię przed skasowaniem z zainfekowanego serwera ([`../07-wdrozenie/backup-dr.md`](../07-wdrozenie/backup-dr.md)). | Sam `pg_dump` (RPO 24 h), WAL-G 3.0 (równorzędna alternatywa), Barman (cięższy), Duplicati. |
| Monitoring | **Uptime Kuma** na VPS (sondy z zewnątrz, sygnały życia zadań, alerty e-mail) + wykresy VM w Proxmoxie + metryki aplikacji w panelu admina | 2.5 | MIT | Wykrywa także awarię całego domu; bez dodatkowych kontenerów z dostępem do gniazda Dockera ([`../07-wdrozenie/monitoring.md`](../07-wdrozenie/monitoring.md)). | Prometheus/Grafana/Loki (RAM), Dozzle i Beszel (wymagają gniazda Dockera), GlitchTip/Sentry self-hosted (RAM). |
| CI | **GitHub Actions** | — | — | Darmowe dla repozytoriów publicznych na standardowych runnerach (dokumentacja GitHub, 2026-09-18). | Self-hosted runner od startu (niepotrzebny). |
| Lokalny SMTP do testów | **Mailpit** | 1.31.1 (tylko Compose dev) | MIT | Przechwycenie syntetycznych wiadomości bez wysyłki do Brevo; zaplanowane w BL-034 i CI/CD § 8. Wersja i licencja sprawdzone 2026-09-20 w [wydaniu projektu](https://github.com/axllent/mailpit/releases/tag/v1.31.1); digest i instrukcja w [środowisku developerskim](../07-wdrozenie/srodowisko-deweloperskie.md). | Rzeczywisty SMTP w testach (wysyłka i poświadczenia poza potrzebami dev). |
| Aktualizacje zależności | **Renovate** (aplikacja GitHub) + alerty **Dependabot** | 44.x | AGPL-3.0 (usługa zewnętrzna, nie w kodzie) | Grupowanie aktualizacji, reguły niestandardowe (np. tarball SheetJS). | Tylko Dependabot (słabsza obsługa niestandardowych źródeł). |
| SCA | **osv-scanner** | 2.6 | Apache-2.0 | Baza OSV obejmuje npm i PyPI. | npm audit + pip-audit osobno. |
| SBOM | **syft** (CycloneDX) | 1.52 | Apache-2.0 | SBOM dla obrazów kontenerów. | — |
| Podpisywanie obrazów | **cosign** (keyless, OIDC GitHub) | 3.1 | Apache-2.0 | Podpis i weryfikacja obrazów przed wdrożeniem. | Brak podpisów. |
| Analiza kodu | **CodeQL**, skanowanie sekretów z push protection | — | — | Darmowe dla repozytoriów publicznych ([ADR-013](../09-decyzje/ADR-013-repozytorium-publiczne.md)). | — |
| Rejestr obrazów | **GitHub Container Registry** | — | — | Darmowy dla pakietów publicznych; alternatywnie budowa obrazów lokalnie na serwerze. | Docker Hub (limity pobrań). |

## 8. Usługi zewnętrzne (darmowe)

| Usługa | Rola | Limit darmowy | Szczegóły |
|---|---|---|---|
| Dostawcy danych rynkowych | Notowania, FX, makro, newsy | wg tabeli | [`../03-dane/zrodla-danych.md`](../03-dane/zrodla-danych.md) |
| Brevo (SMTP) | E-mail transakcyjny (alerty, zaproszenia, reset hasła) | 300 e-maili/dzień, logo Brevo w stopce, bez karty | [ADR-010](../09-decyzje/ADR-010-kanaly-powiadomien.md) |
| Web Push (APNs, FCM, Mozilla) | Doręczanie powiadomień PWA | bez opłat | — |
| Pwned Passwords (HIBP) | Sprawdzanie wycieków haseł (k-anonimowość) | bez klucza | [ADR-004](../09-decyzje/ADR-004-postgres-better-auth-rls.md) |
| Google / GitHub OAuth | Logowanie (P2) | bez opłat | Z-04 |
| Context7, Playwright MCP, Alpha Vantage MCP, Twelve Data MCP | Wyłącznie środowisko deweloperskie Claude Code | — | [`../09-decyzje/audyt-pluginow.md`](../09-decyzje/audyt-pluginow.md) |

## 9. Co i gdzie się ładuje (skrót)

| Warstwa | Serwer (RSC/SSR, streaming) | Klient (JS w przeglądarce) | Strumień SSE |
|---|---|---|---|
| Powłoka aplikacji, nawigacja, dashboard | ✅ HTML z danymi | minimalne wyspy interaktywne | wycena, wynik dnia |
| Tabele portfela i transakcji | ✅ pierwsza strona danych | sortowanie, filtry, wirtualizacja | aktualizacje wycen |
| Wykresy | dane zdecymowane | Lightweight Charts / uPlot (leniwie) | nowe świece/kursy |
| Analizy (MC, optymalizacja, backtest) | formularz, wynik zapisany | wizualizacja wyniku (leniwie) | postęp i zakończenie zadania |
| Panel admina, onboarding | ✅ | leniwe chunki tylko na tych trasach | status kolejek |

Pełne budżety i strategia ładowania: `docs/04-frontend/wydajnosc.md` (Krok 4).

## 10. Zmiany względem tabeli zaakceptowanej w Kroku 2

| Zmiana | Powód |
|---|---|
| PostgreSQL 16 → **18** | Wsparcie do 2030 (16: do 2028), natywne `uuidv7()`. |
| Redis 7 → **Valkey 9 (dwie instancje)** | Licencja OSI; BullMQ wymaga `noeviction`, cache potrzebuje LRU — jedna instancja łączyłaby sprzeczne polityki. |
| Serwist → **własny service worker** | Oficjalny przewodnik PWA Next.js 16 realizuje push i manifest bez bibliotek; mniej zależności (§6.6). |
| Debian 12 → **Debian 13** | Aktualna wersja stabilna, zgodna z Proxmox VE 9. |
| Lighthouse CI → **Lighthouse 13.5 + skrypt asercji** (Krok 4) | `@lhci/cli` nie jest rozwijany od 2025-06 i zawiera starszy Lighthouse 12.6.1; wymóg specyfikacji „budżety egzekwowane w CI” spełnia Lighthouse uruchamiany w GitHub Actions. |
| Walidacja formularzy w przeglądarce (Krok 4) | Pomiar rozmiaru Zod 4 w bundlu (25–90 KB gz) — domyślnie walidacja natywna HTML + błędy `422` z `api`; Zod tylko w leniwych formularzach. |
| CrowdSec: LAPI na VPS zamiast w domu (Krok 5) | Brak dodatkowego przepływu VPS → dom; agent w domu wysyła alerty połączeniem wychodzącym ([ADR-011](../09-decyzje/ADR-011-topologia-wdrozenia.md)). |
| Kopie zapasowe: pgBackRest + restic/rest-server (Krok 5) | Cel RPO ≤ 1 h dla bazy (NFR-09.03) wymaga archiwizacji WAL, a nie tylko nocnego `pg_dump`. |
| Doprecyzowania | Argon2id zamiast domyślnego scrypt w Better Auth; SheetJS CE z CDN dla XLS GPW; jsonschema jako kontrakt dla Pythona; brak dostępu `analytics` do internetu i danych użytkowników. |

M1-1: `.pnpmfile.cjs` usuwa z metadanych Better Auth 1.7.5 wyłącznie opcjonalne peer dependencies `drizzle-kit`, `vitest`, `next`, `react`, `react-dom`. API używa eksportów serwera i adaptera SQL; nie korzysta z generatorów, narzędzi testowych ani integracji frontendowych Better Auth. Własne narzędzia workspace pozostają dostępne. Zapobiega to włączaniu starych binariów esbuild/Go do obrazu API przez `pnpm deploy --prod`; test obrazu sprawdza ich brak i import fasady auth. Bez wyjątków OSV i bez osłabienia strictPeerDependencies.
