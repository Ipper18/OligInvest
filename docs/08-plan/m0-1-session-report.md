# M0-1 — stan bieżący

**Cel:** przekazać stan i następny krok; poprzednie dowody w [historii](m0-1-session-history.md).

**2026-09-29**, gałąź `feat/m0-1-skeleton`, [roboczy PR #2](https://github.com/Ipper18/OligInvest/pull/2), bez scalania. Node 24.21.0, pnpm 12.4.2, Python 3.13.13; uv `.git/tools/uv-0.12.16/uv.exe` (PATH lub `UV_BIN`). `packages/core` bez zmian — rozwijany osobno w PR #3.

## BL-011 — zakres wykonany lokalnie

Dynamiczna strona techniczna, `src/proxy.ts` generuje nonce per żądanie i przekazuje CSP do renderera/odpowiedzi. Produkcja bez unsafe-inline/eval i zewnętrznych źródeł; tylko dev dopuszcza eval. Typowany klient server-only przekazuje cookie, X-Request-Id i accept-language; no-store, timeout i brak przekierowań, stały origin API. Strona sprawdza wyłącznie health/live.

Tokeny Tailwind 4 z `packages/ui`: kolory, typografia, odstępy; fonty systemowe. Dark domyślny, light/system i paleta dla daltonistów. Wybór działa bez przeładowania, serwer odtwarza atrybuty z walidowanych ciasteczek strony testowej. Profil i synchronizacja konta FR-07.08 pozostają M1; bez ekranów produktowych.

Zatwierdzony wyjątek: prywatny `tools/openapi-client`, tylko devDependencies openapi-typescript 7.13.0 i TS 5.9.3; web nadal TS 7.0.2. Strict peers bez wyciszeń, typy commitowane, aktualność w contracts. check:deps blokuje narzędzie w apps/modules/packages; Renovate osobno, TS < 6. Usunąć wyjątek po obsłudze TS 7 przez generator. Stos/BL-032/R-20 zaktualizowane, bez nowego ADR.

Dowody: frozen PASS, monorepo **88/88** (5 cache), web **9**, ui **3**, Chromium **7**, granice **36** testów PASS. Negatywny build client → server-only i kontrola nieaktualnych typów PASS. Nonce także na 404, brak API/config w chunkach, zero zewnętrznych zasobów/pobranych fontów. Kontrasty obu motywów/palet, układ 360/768/1280 i klawiatura PASS; zrzuty obejrzane. Initial JS **169,7 KiB gzip-9** (7 skryptów) < 200 KiB; pełne budżety BL-016. Logi `.git/bl011-*.log`.

Osobne commity/push: generator `663a648`, CSP/klient `80b0a73`, tokeny w bieżącym etapie. tokeny `28e9147`, poprawka testu przełączania bez przeładowania `e368c9a` (pomiar żądania nowego dokumentu zamiast licznika nawigacji). CI `e368c9a` PASS: [web](https://github.com/Ipper18/OligInvest/actions/runs/36524690014), [contracts](https://github.com/Ipper18/OligInvest/actions/runs/36524690089), [db](https://github.com/Ipper18/OligInvest/actions/runs/36524690046), [modules](https://github.com/Ipper18/OligInvest/actions/runs/36524690049), [workers](https://github.com/Ipper18/OligInvest/actions/runs/36524690025), CodeQL. Status `w toku` do wspólnego DoD; estymacja 3 d bez zmiany, nakład niezmierzony.

## BL-012 — w toku

Etap 1: słowniki (12 disclaimerów 2026-09, 23 kody błędów, teksty z TXT) i formatery Intl bez konwersji kwot na number. Zatwierdzone przez właściciela uzupełnienia TXT: zmienne opóźnienie, flaga nieaktualności, pięć przyczyn z kontraktu. i18n lint/typecheck/test/build 4/4, 10 testów PASS; instalacja frozen PASS. Etap 2: skaner całych słów Unicode (słowniki/MDX/komponenty), lint AST dla tekstów JSX i atrybutów dostępności; 16 testów skanera, 13 testów i18n PASS, granice PASS. Kontrole w lint i CI web, bez cache dla skanowania całego repo. Dalej prymitywy i axe. `packages/core` bez zmian.

## Paczka i następny krok

BL-001–011/013–015/034 wykonane lokalnie; BL-032 technicznie zamknięty. Poprzednie dowody: queues:test, db:seed:test, dev:test PASS; RLS/audyt i 12 testów pul, ZERO DIFFERENCES (2026-09-28). Workery mają jawne NODE_ENV i pliki sekretów produkcyjnych; dev na hoście, pytest blokuje gniazda poza Valkey, izolacja systemowa analytics od M3 (ADR-003).

Dalej BL-012/016/018/033, pełne CI BL-017, ustawienia BL-019 i pozostałe BL-035. Ruleset disabled; nowy kontekst web uwzględnić przy BL-017/019. M0 otwarty: kryteria 1–3 mają dowody, 4–7 wymagają dalszych prac/właściciela, 8 częściowo. Serwery i ustawienia GitHub bez zmian.
