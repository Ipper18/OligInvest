# BL-614 — stan sesji

**Cel:** zapisać wynik rozszerzenia ZAP baseline o anonimowe prawdziwe API oraz otwarte warunki odbioru.

2026-11-14; gałąź `feat/bl-614-zap-api`, baza `origin/main` `6673585`; osobny worktree wskazany przez właściciela; [draft PR #79](https://github.com/Ipper18/OligInvest/pull/79).

## Zrobione

- Istniejący `apps/web/scripts/zap-baseline.mjs` ma tryb `--api`: produkcyjny proces API, izolowany Compose, migracje, syntetyczny seed, PostgreSQL i oba Valkey, TLS przez Caddyfile.test.
- Jawne GET/POST przez hook baseline: 21 par metoda/ścieżka, wszystkie 14 tras fasady auth; asercje statusów, kodów problemów, gotowości zależności, braku sesji, cookies/autoryzacji i `no-store`. Test wykrywa dodanie trasy auth bez objęcia skanem.
- Pełny raport JSON respektuje poziomy reguł także dla ryzyka informacyjnego (klasyczny baseline pomija je w kodzie wyjścia). Bez nowych wyjątków, zależności ani zmian progów.
- Rozszerzony istniejący `dast`, bez nowego checka, zmiany rulesetu i timeoutów. Osobny katalog wyników API w dotychczasowym artefakcie.
- BL-614b dopisane: sesja po TOTP i atrybuty rzeczywiście wydanych ciasteczek Better Auth. Uaktualnione SEC, CI, macierz wymagań i R-56.

## Dowody

- API: 34 URL-e w drzewie ZAP, 26 rzeczywistych wymian HTTP, brak `Set-Cookie`, 0 FAIL; 3 informacyjne WARN: 10015, 10049, 10111. Skan 15 s, stos i skan 24 s.
- Próba negatywna na generowanej krawędzi: brak nosniff → 10021 FAIL, kod skryptu 1. Konfigurację przywrócono; produkcyjne nagłówki i kod API bez zmian.
- Regresja web: 30 / 154 URL-e, 0 FAIL, dotychczasowe reguły WARN; 35 s.
- Build API/db i web PASS; zmienione pakiety: lint/typecheck/test 16/16 zadań PASS (80 testów web na tym przebiegu), następnie rozszerzony zestaw skanera 8/8 PASS; check-ci, check-docs, check-repository, diff-check PASS.
- Grep z CLAUDE.md: 4 zastane syntetyczne fixtures, brak nowych trafień. Sekrety efemeryczne usunięte; lokalne logi instalacji/pobierania nie trafiają do commitu.

## Otwarte i pominięte

- Trzy informacyjne WARN opisane w [przeglądzie](../06-bezpieczenstwo/przeglady/2026-11-14-zap-api-baseline-bl-614.md); właściciel zaakceptował je 2026-11-14: pozostają raportowane WARN bez wyjątków i zmiany progów. CI i przegląd kodu przez właściciela wymagane przed uznaniem DoD.
- Sesja TOTP i wydane ciasteczka: BL-614b, zgodnie z decyzją właściciela. Nie zmieniano obszarów równoległego BL-306, core, i18n, manifestów ani lockfile.
- Estymata BL-614: 1 d bez zmian; nakład i odchylenie niezmierzone. Nowy ADR niepotrzebny. R-56 pozostaje otwarte dla sesji TOTP; brak nowego ryzyka. M6 nie jest kończony.
- Wymagany check: zachować istniejący `dast`, który obejmuje oba skany; nie potrzeba nowego wpisu rulesetu. Ewentualny podział joba w przyszłości wymaga osobnej decyzji właściciela.
