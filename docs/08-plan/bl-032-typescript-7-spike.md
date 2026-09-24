# BL-032 — zgodność TypeScript 7

**Cel:** sprawdzić wybraną linię TypeScript z Next.js, Hono, Drizzle i Better Auth oraz zapisać decyzję bez naprawiania deklaracji bibliotek.

Decyzja z 2026-09-21: **pozostajemy na TypeScript 7.0.2**, `strict: true`, `skipLibCheck: true` zgodnie z jawną zgodą właściciela. Nie ma zmiany ADR ani powodu do przejścia na linię 6. Nie dodano shimów, deklaracji ambient dla Bun, nieużywanych sterowników baz ani łatek zależności.

| Próba | Wynik |
|---|---|
| Next.js 16.3.5 + React 19.3.0 | build produkcyjny strony testowej i render w teście PASS |
| Hono 4.13.8 + Zod OpenAPI 1.6.3 | typowany router testowy i odpowiedź JSON PASS, bez nasłuchiwania na porcie |
| Drizzle 0.45.2 + pg 8.23.0 | typowane zapytanie z parametrem `$1`, generowanie SQL bez bazy PASS |
| Better Auth 1.7.5 | `BetterAuthOptions`, typ sesji i jej identyfikator użytkownika PASS; bez uruchamiania uwierzytelniania |
| Błędny typ opcji Better Auth, `null` przypisane do string i liczbowy identyfikator zapytania | kompilator nadal odrzuca je w kodzie własnym; `@ts-expect-error` kontroluje obecność błędu |

Próby przy `skipLibCheck: false` na **obu kompilatorach 7.0.2 i 6.0.3** zwracają tę samą liczbę i kategorie błędów: 72 Drizzle oraz jeden Better Auth. TypeScript 6.0.3 pobrano tylko do lokalnej diagnozy po sprawdzeniu daty publikacji (2026-04-16) i SHA-512; nie zmieniono manifestu ani lockfile projektu. Oba kompilatory przechodzą te same fixture'y z zatwierdzonym `skipLibCheck: true`.

Wyciszane diagnostyki (wyłącznie deklaracje bibliotek):

| Kod | Liczba na kompilator | Przyczyna |
|---|---:|---|
| TS2307 | 12 | brak opcjonalnych typów innych adapterów, m.in. `gel`, `mysql2/promise`, `mysql2` w Drizzle oraz `bun:sqlite` w Better Auth |
| TS2420 | 7 | deklaracje klas niezgodne z deklarowanymi interfejsami, m.in. `SQLWrapper` i konfiguracje polityk |
| TS2559 | 2 | role Gel/PostgreSQL bez właściwości wspólnych z typem konfiguracji |
| TS2344 | 18 | ograniczenia generyczne selektorów MySQL/SingleStore/SQLite |
| TS2515 | 33 | brak deklarowanych implementacji abstrakcyjnych metod, m.in. `getSQL` i `generatedAlwaysAs` |
| TS2416 | 1 | niezgodna deklaracja właściwości klasy w Drizzle |

[Pełna lista](audits/bl-032-library-diagnostics.json) zawiera każdy plik, wiersz, kolumnę i komunikat dla obu kompilatorów. `skipLibCheck` ogranicza sprawdzanie wnętrza plików `.d.ts`; typy na granicy naszego kodu nadal są używane i sprawdzane. Ryzyko ukrytych niespójności deklaracji pozostaje jawne przy aktualizacjach bibliotek.

Przegląd wcześniejszych zmian tsconfig:

- Zachowano `ES2024.Promise` w `apps/web`: Next używa `PromiseWithResolvers`; target kodu pozostaje ES2023. Nie dodaje to polyfilli ani użycia nowego API w aplikacji.
- DOM dodano wyłącznie do konfiguracji fixture'ów spike, gdzie biblioteki deklarują Web API; bazowa konfiguracja pakietów nie dostaje DOM.
- Pozostałe różnice to formatowanie Biome. Next generuje deklaracje tras podczas buildu, dlatego typecheck web zależy od własnego buildu w Turbo.
- Nie zmieniono żadnej z opcji `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` ani `noImplicitOverride`.

Odtworzenie: `pnpm --filter @oliginvest/api typecheck`, `pnpm --filter @oliginvest/db typecheck`, ich testy oraz `pnpm --filter @oliginvest/web build`. Diagnoza bibliotek: `pnpm exec tsc -p apps/api/spike/tsconfig.json --noEmit --skipLibCheck false` i odpowiednik dla `packages/db/spike/tsconfig.json`. Pełny szkielet: `pnpm turbo run lint typecheck test build`.

Zakres dowodu: lokalny Windows x64, Node 24.21.0. CI i Linux nadal do weryfikacji w BL-017; konsument kolejki, auth, CSP i połączenia z bazą nie są częścią tego spike'u. Wcześniejsze wykonanie spike'u przed pełnym BL-011 zostało zlecone przez właściciela.
