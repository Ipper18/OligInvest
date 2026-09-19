# Stack technologiczny

**Cel:** zapisać każdy element stosu OligInvest z wersją, licencją i uzasadnieniem wyboru (oraz odrzuconymi alternatywami), tak aby żadna zależność nie trafiła do projektu bez powodu.

Stan na **2026-09-18**. Wersje pochodzą z `npm view`, PyPI JSON API, GitHub Releases i stron projektów; research porównawczy w [`../09-decyzje/research-biblioteki.md`](../09-decyzje/research-biblioteki.md). Wersje w repozytorium przypina lockfile (`pnpm-lock.yaml`, `uv.lock`), a aktualizacje proponuje Renovate — tabela podaje linię wersji, od której startujemy.

## 1. Polityka zależności

Nowa zależność runtime trafia do projektu tylko, jeśli spełnia **wszystkie** warunki:

1. Nie da się tego sensownie zrobić standardem platformy (Web API, Node, PostgreSQL, CSS) w < 1 dniu pracy i < 200 linii.
2. Licencja: MIT, Apache-2.0, BSD, ISC, MPL-2.0, MIT-0, PostgreSQL; LGPL tylko jako biblioteka bez modyfikacji; **bez AGPL/GPL w kodzie aplikacji** (dopuszczalne jako osobne usługi infrastrukturalne).
3. Aktywne utrzymanie (release lub commit ≤ 6 miesięcy) albo świadomie zaakceptowane ryzyko opisane w tym dokumencie.
4. Wpływ na bundle przeglądarki mieści się w budżecie trasy (`04-frontend/wydajnosc.md`).
5. Wpis w tym dokumencie (lub w ADR) z uzasadnieniem.

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

| Element | Wybór | Wersja | Licencja | Uzasadnienie | Odrzucone |
|---|---|---|---|---|---|
| Menedżer pakietów JS | **pnpm** | 12.4 | MIT | Ścisła izolacja zależności (brak „fantomowych” importów — pomaga egzekwować granice modułów), szybki, workspaces. | npm (hoisting ukrywa brakujące zależności), Yarn (brak przewagi). |
| Orkiestracja zadań | **Turborepo** | 2.11 | MIT | Graf zadań i cache buildów/testów per pakiet; prosta konfiguracja ([ADR-002](../09-decyzje/ADR-002-monorepo.md)). | Nx (więcej abstrakcji i generatorów niż potrzebujemy). |
| Język | **TypeScript** | 7.0 (kompilator natywny) | Apache-2.0 | Szybkie sprawdzanie typów w monorepo; `strict`. Jeśli któraś biblioteka okaże się niezgodna — powrót do linii 6.x (decyzja w M0). | JS bez typów. |
| Lint + format (TS/JS/JSON/CSS) | **Biome** | 2.5 | MIT/Apache-2.0 | Jedno narzędzie zamiast ESLint + Prettier + wtyczek; szybkie; reguły React hooks i dostępności. Next.js 16 nie ma już `next lint`. | ESLint + Prettier (więcej zależności i konfiguracji). |
| Python: zależności | **uv** | 0.12 | MIT/Apache-2.0 | Lockfile (`uv.lock`), szybkie instalacje, zarządzanie wersją Pythona. | pip-tools, Poetry (wolniejsze). |
| Python: lint + format | **Ruff** | 0.16 | MIT | Jedno narzędzie (lint + format). | flake8 + black + isort. |
| Python: typy | **mypy** | 2.3 | MIT | Dojrzały, tryb `strict` dla kodu analityki. | pyright (dodatkowy runtime Node w obrazie Pythona). |
| Testy TS | **Vitest** | 5.0 | MIT | Szybki, zgodny z ESM/TS, `bench` dla wydajności `core`. | Jest (wolniejszy z ESM). |
| Testy Python | **pytest** + **hypothesis** | 9.1 / 6.168 | MIT / MPL-2.0 | Testy właściwości (property-based) dla wzorów i symulacji. | unittest. |
| Testy e2e | **Playwright** + `@axe-core/playwright` | 1.63 / 4.13 | Apache-2.0 / MPL-2.0 | Chromium, WebKit (Safari/iOS), Firefox w jednym narzędziu; testy dostępności. | Cypress (brak WebKit). |
| Budżety wydajności | **Lighthouse** (uruchamiany w CI skryptem z asercjami) + **size-limit** | 13.5 / 14.0 | Apache-2.0 / MIT | LCP/CLS/TBT w CI; twardy limit rozmiaru JS per trasa (NFR-01.02); szczegóły w `04-frontend/wydajnosc.md` § 6. | `@lhci/cli` 0.15.1 — ostatnie wydanie 2025-06, zawiera Lighthouse 12.6.1 (sprawdzone 2026-09-19); tylko ręczne pomiary. |

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

## 5. Backend (`apps/api`, `apps/jobs`, moduły)

| Element | Wybór | Wersja | Licencja | Uzasadnienie | Odrzucone |
|---|---|---|---|---|---|
| Framework HTTP | **Hono** + `@hono/node-server` | 4.13 / 2.1 | MIT | Lekki, oparty na standardach Web (Request/Response), dobre wsparcie SSE, integracja z Better Auth. | Express (brak typów i Web API), Fastify (więcej konwencji), NestJS (ciężki). |
| Kontrakty i OpenAPI | **Zod** + `@hono/zod-openapi` | 4.6 / 1.6 (peer: zod ^4) | MIT | Jedna definicja schematu → walidacja, typy, OpenAPI, JSON Schema dla Pythona (`z.toJSONSchema`) ([ADR-012](../09-decyzje/ADR-012-api-jako-granica-domenowa.md)). | tRPC (nie-REST; trudny dla Skrótów), ręczne OpenAPI. |
| Uwierzytelnianie | **Better Auth** + wtyczki `twoFactor`, `admin`, `haveIBeenPwned`, `@better-auth/api-key` | 1.7.5 | MIT | TOTP + kody zapasowe, role i bany, klucze API z zakresami i limitami (PAT), adapter Drizzle ([ADR-004](../09-decyzje/ADR-004-postgres-better-auth-rls.md)). | Auth.js (brak TOTP), Keycloak (Java, ~1 GB RAM), Lucia (wycofana). |
| Hashowanie haseł | **@node-rs/argon2** (Argon2id) | 2.2 | MIT | Better Auth domyślnie używa scrypt; specyfikacja wymaga Argon2id → własne funkcje `hash`/`verify`. Natywne wiązania Rust, bez kompilacji node-gyp. | `argon2` (node-gyp), scrypt (niezgodne z wymaganiem). |
| ORM i migracje | **Drizzle ORM** + **drizzle-kit** | 0.45.2 / 0.31.10 | Apache-2.0 / MIT | SQL-owy, bez silnika pośredniczącego, pełna kontrola nad transakcjami (`SET LOCAL` dla RLS); wspierany przez Better Auth. | Prisma (silnik zapytań, trudniejsze RLS per transakcja), Kysely (brak migracji z pudełka). |
| Sterownik PostgreSQL | **pg** (node-postgres) | 8.23 | MIT | Dojrzały, wspierany przez Drizzle i Better Auth. | postgres.js (Unlicense; brak przewagi). |
| Kolejki | **BullMQ** (Node) / **bullmq** (Python) | 6.3 / 3.2 | MIT | Jeden system kolejek dla dwóch runtime'ów; priorytety, opóźnienia, ponowienia, limity, zdarzenia postępu ([ADR-003](../09-decyzje/ADR-003-hybryda-obliczen-i-kolejki.md)). | Celery + BullMQ (dwa systemy), pg-boss (brak Pythona). |
| Logi | **pino** | 10.3 | MIT | Szybkie logi JSON, redakcja pól wrażliwych. | winston (wolniejszy). |
| Pieniądze | **decimal.js** | 10.6 | MIT | Arytmetyka dziesiętna o konfigurowalnej precyzji ([ADR-014](../09-decyzje/ADR-014-pieniadze-waluty-czas.md)). | `number` (błędy zmiennoprzecinkowe), big.js (brak funkcji potrzebnych w XIRR, np. `pow` z ułamkiem), Dinero.js (zbędna warstwa). |
| Pliki XLS/XLSX/CSV | **SheetJS Community Edition** (`xlsx`) z oficjalnego CDN | 0.20.3 | Apache-2.0 | Archiwum GPW zwraca binarny XLS (BIFF), XTB — XLSX; jedna biblioteka dla obu i dla CSV. Rejestr npm ma przestarzałe 0.18.5 z podatnościami — instalujemy z `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` (hash w lockfile, Renovate z regułą niestandardową). Tylko po stronie serwera (`jobs`). | read-excel-file (bez XLS), exceljs (brak wydań od 2023), parsowanie w Pythonie (wymagałoby internetu i zapisu w `analytics`). |
| Klient Yahoo Finance | **yahoo-finance2** | 4.0 | MIT | Utrzymywany klient nieoficjalnego API (obsługa ciasteczek/crumb, walidacja odpowiedzi); tylko w adapterze `yahoo`. | Własny klient `fetch` (koszt nadążania za zmianami Yahoo). |
| E-mail | **nodemailer** przez SMTP (Brevo) | 10.0 | MIT-0 | Niezależność od dostawcy: zmiana na Resend = zmiana danych SMTP ([ADR-010](../09-decyzje/ADR-010-kanaly-powiadomien.md)). | SDK dostawców (uzależnienie). |
| Web Push | **web-push** | 3.6 | MPL-2.0 | Standardowa implementacja VAPID i szyfrowania treści powiadomień. | Własna implementacja (kryptografia — nie piszemy sami). |
| Magazyn sesji/limitów (opcjonalnie) | `@better-auth/redis-storage` | 1.7.5 | MIT | Jeśli limity Better Auth mają trafić do Valkey zamiast Postgresa — decyzja w `06-bezpieczenstwo/`. | — |

## 6. Analityka (`apps/analytics`, Python)

| Element | Wybór | Wersja | Licencja | Uzasadnienie | Odrzucone |
|---|---|---|---|---|---|
| Backtesting | **vectorbt** | 1.1 (wymaga pandas ≥ 3.0.3, numpy ≥ 2.4.6) | Apache-2.0 + **Commons Clause** (zakaz sprzedaży oprogramowania, którego wartość wynika z vectorbt) | Wektorowe backtesty wielu wariantów, walk-forward; baza wiedzy w skillu `vectorbt-reference`. Ograniczenie licencyjne opisane w `10-ograniczenia.md` (nie dotyczy użytku prywatnego). | backtesting.py (AGPL), nautilus_trader (silnik live, zbyt ciężki). |
| Optymalizacja portfela | **PyPortfolioOpt** + **cvxpy** | 1.6 / 1.9 | MIT / Apache-2.0 | Markowitz, Black-Litterman, HRP, ograniczenia wag — gotowe i sprawdzone. | Własna implementacja (ryzyko błędów numerycznych). |
| Metryki i raporty | **quantstats** | 0.0.81 | Apache-2.0 | Metryki i tearsheety dla wyników symulacji. | pyfolio-reloaded (starszy, cięższy). |
| Numeryka | **numpy**, **pandas**, **scipy** | 2.5 / 3.0 / 1.18 | BSD | Standard. | — |
| Kolejka | **bullmq** (Python) | 3.2 | MIT | Ten sam protokół kolejek co Node. | Celery. |
| Dostęp do danych rynkowych | **psycopg** | 3.3 | LGPL-3.0 (używany bez modyfikacji) | Dojrzały sterownik; rola tylko do odczytu. | SQLAlchemy (zbędna warstwa). |
| Walidacja wejścia | **jsonschema** | 4.26 | MIT | Walidacja treści zadań schematami eksportowanymi z Zod — jedno źródło prawdy kontraktu. | Ręczne modele Pydantic (duplikacja kontraktu). |
| Tylko testy | **TA-Lib** (python), **empyrical-reloaded** (≥ 0.5.12 — starsze używają `np.NINF`, usuniętego w NumPy 2) | 0.8 / 0.5.12 | BSD / Apache-2.0 | Wartości referencyjne dla wektorów testowych `packages/core` i analityki. | pandas-ta (repozytorium autora zniknęło z GitHuba). |

## 7. Infrastruktura, CI/CD i łańcuch dostaw

| Element | Wybór | Wersja | Licencja | Uzasadnienie | Odrzucone |
|---|---|---|---|---|---|
| Reverse proxy w VM | **Caddy** | 2.11 | Apache-2.0 | Automatyczne certyfikaty ACME, TLS 1.3 domyślnie, prosta konfiguracja. | nginx w VM (ręczna obsługa certyfikatów), Traefik (więcej ruchomych części). |
| Edge na VPS | **nginx `stream`** (`ssl_preread`, protokół PROXY do domu) + **WireGuard** + firewall | pakiety Debiana | BSD-2 / GPL-2.0 (kernel) | Routing po SNI bez odszyfrowania ruchu; zastępuje obecny Caddy na VPS, który dziś kończy TLS dla Immicha ([ADR-011](../09-decyzje/ADR-011-topologia-wdrozenia.md)). | Cloudflare Tunnel (terminacja TLS u firmy trzeciej), Caddy z modułem `layer4` (własna kompilacja), HAProxy (alternatywa). |
| Ochrona przed nadużyciami | **CrowdSec** (agent w VM; LAPI i bouncer nftables na VPS) | 1.8 | MIT | Wykrywanie na podstawie logów Caddy w domu, blokowanie już na krawędzi; darmowa sieć reputacji. | fail2ban (tylko lokalne reguły; może działać równolegle dla SSH). |
| Kopie zapasowe | **pgBackRest** (PostgreSQL: kopie pełne i różnicowe + ciągła archiwizacja WAL, odtwarzanie do punktu w czasie) + **restic** z **rest-server** `--append-only` na VPS (kopia poza domem) | 2.59 / 0.19 / 0.14 | MIT / BSD-2 / BSD-2 | RPO bazy: minuty lokalnie, ≤ 1 h poza domem; szyfrowane repozytoria; tryb append-only chroni kopię przed skasowaniem z zainfekowanego serwera ([`../07-wdrozenie/backup-dr.md`](../07-wdrozenie/backup-dr.md)). | Sam `pg_dump` (RPO 24 h), WAL-G 3.0 (równorzędna alternatywa), Barman (cięższy), Duplicati. |
| Monitoring | **Uptime Kuma** na VPS (sondy z zewnątrz, sygnały życia zadań, alerty e-mail) + wykresy VM w Proxmoxie + metryki aplikacji w panelu admina | 2.5 | MIT | Wykrywa także awarię całego domu; bez dodatkowych kontenerów z dostępem do gniazda Dockera ([`../07-wdrozenie/monitoring.md`](../07-wdrozenie/monitoring.md)). | Prometheus/Grafana/Loki (RAM), Dozzle i Beszel (wymagają gniazda Dockera), GlitchTip/Sentry self-hosted (RAM). |
| CI | **GitHub Actions** | — | — | Darmowe dla repozytoriów publicznych na standardowych runnerach (dokumentacja GitHub, 2026-09-18). | Self-hosted runner od startu (niepotrzebny). |
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
