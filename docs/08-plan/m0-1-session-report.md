# M0-1 — stan bieżący

**Cel:** przekazać stan i następny krok; wcześniejsze dowody w [historii](m0-1-session-history.md).

**2026-09-29**, gałąź `feat/m0-1-skeleton`, [roboczy PR #2](https://github.com/Ipper18/OligInvest/pull/2), bez scalania. Node 24.21.0, pnpm 12.4.2, Python 3.13.13; uv `.git/tools/uv-0.12.16/uv.exe` (PATH lub `UV_BIN`). `packages/core` bez zmian — osobny PR #3.

## BL-012 — wykonane lokalnie

12 disclaimerów `2026-09` dosłownie z LAW § 4.3, 23 komunikaty błędów z TXT i zgodność kodów z OpenAPI. Słowniki JSON, interpolacja tekstu i polskie formy liczby mnogiej. Formatery Intl przyjmują `string | Decimal`, odrzucają number również w runtime; bez konwersji kwot na float, z ROUND_HALF_UP na prezentacji. Osobno daty sesyjne i znaczniki ze strefą.

Skaner całych słów Unicode obejmuje słowniki, MDX i komponenty; zawiera tabelę zamienników TXT. Wyjątki tylko dla 12 tekstów disclaimerów, z uzasadnieniem i osobnym testem dosłownej zgodności. Lint AST odrzuca teksty JSX i etykiet dostępności. Kontrole w lint/test oraz CI web, bez cache skanera całego repo.

Natywne Button/TextField/SelectField/Disclosure/ModalDialog/Popover oraz DataFreshness/AssumptionsBlock/Disclaimer, bez literałów. Dialog showModal, fokus i Escape; popover natywny, kotwice CSS z fallbackiem; domyślnie otwarte założenia, zawsze widoczne podsumowanie. Świeżość: rzeczywiste opóźnienie, EOD, NBP, wszystkie przyczyny stale i region status. Techniczna trasa `/ui-preview`, wyłącznie syntetyczne dane. Właściciel zatwierdził w TXT zmienne opóźnienie, flagę „nieaktualne” i pięć brakujących przyczyn. Bez zmiany ADR.

Dowody: frozen PASS; monorepo **88/88** (78 cache); i18n **13**, ui **9**, web **9**, skaner **19** testów PASS. Chromium **11/11**, axe **0 naruszeń** (oba motywy, 320/1280 px, dialog i popover), klawiatura/fokus/reflow PASS; zrzuty obejrzane. check:deps, check:docs, check:repository i diff check PASS. WebKit/Firefox oraz pełne budżety pozostają BL-018/016. Logi `.git/bl012-*.log`. Uszkodzony cache Turbopacka zachowany w `.git/bl012-next-cache`; ponowny build PASS.

Commity/push po etapach: słowniki `f8eacfd`, kontrole `10d590a`, UI `136299b`; końcowa korekta usuwa znaczniki formatowania MDX przed skanowaniem (dwa nowe testy regresji PASS). CI `136299b`: [web](https://github.com/Ipper18/OligInvest/actions/runs/36620268371), contracts, db, modules, workers i CodeQL PASS. Status `w toku` do wspólnego DoD; estymacja 2 d bez zmiany, odchylenie nakładu niezmierzone. Bez nowych ADR/ryzyk, serwery i ustawienia GitHub bez zmian.

## Paczka i następny krok

BL-001–015/034 wykonane lokalnie, BL-032 technicznie zamknięty. BL-011: CSP nonce, klient server-only, tokeny/motywy; CI `e368c9a` PASS, initial JS 169,7 KiB. Wyjątek TS: prywatne `tools/openapi-client` z openapi-typescript 7.13.0 i TS 5.9.3; aplikacje nadal TS 7.0.2, strict peers bez wyciszeń (R-20). Usunąć wyjątek po wsparciu TS 7 przez generator. Baza: RLS/audyt, 12 testów pul i ZERO DIFFERENCES; queues:test/db:seed:test/dev:test PASS. Analytics: izolacja systemowa od M3, obecnie pytest blokuje gniazda poza Valkey.

Dalej BL-016/018/033, pełne CI BL-017, ustawienia BL-019 i pozostałe BL-035. Ruleset disabled. M0 pozostaje otwarty: kryteria 1–3 mają dowody, 4–7 wymagają dalszych prac/właściciela, 8 częściowo.
