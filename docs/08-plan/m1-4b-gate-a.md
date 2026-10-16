# M1-4b — raport bramy A

**Cel:** rozdzielić automatyczne dowody paczki od odbioru wymaganego od właściciela.

**2026-10-16**, [PR #14](https://github.com/Ipper18/OligInvest/pull/14).
**Brama A pozostaje otwarta.** Automatyczne testy nie zastępują odbioru na
telefonie, realnego eksportu właściciela ani czynności na jego serwerze.
Zakres: BL-147/148/157/158/154/155 i aplikacyjna część BL-152.

## Dowody automatyczne i CI

Tabela wskazuje testy uruchamiane w CI, nie deklaruje zielonego wyniku bieżącego
PR. Wynik jednorazowego odczytu CI jest w [raporcie stanu](m1-4b-session-report.md).

| Kryterium roadmapy | Dowód w CI | Granica dowodu |
|---|---|---|
| 1. Uzgodnienie XTB i FIFO | `e2e`: `apps/web/e2e/mvp-real.spec.ts`; testy XTB i read-model w portfolio, wektory w core; integracje portfolio w workflow DB | Syntetyczny XLSX: uzgodnienie ilości po korekcie wiersza, gotówka 14518,27 PLN, zatwierdzenie przez worker i niepuste pozycje. To nie jest eksport właściciela. |
| 2. Import → portfel < 2 min | `e2e`: rzeczywiste zaproszenie, TOTP, 10 kodów zapasowych, rachunek, import, uzgodnienie, portfel i logout w Chromium, WebKit i Firefox; asercja < 120 s | Czas od wyboru pliku; oczekiwanie na okno limitera auth poza tym pomiarem. API, PostgreSQL i Valkey są rzeczywiste; zewnętrzne HIBP zastępuje deterministyczna odpowiedź testowa. |
| 3. SSE i degradacja | `workers`: `apps/api/scripts/test-stream.mjs`; testy market/portfolio; `e2e`: stany świeżości i aktualizacja UI | Izolacja, replay, adaptery i stan UI nie potwierdzają opóźnienia na serwerze ani wykonania rzeczywistych pobrań GPW/NBP. |
| 4. Wydajność | `web`: budżety JS i Lighthouse wszystkich czterech tras, mediana 3 pomiarów; systemowy Chrome z sandboxem; testy decymacji market | Progi bez zmian: powłoka ≤ 30 KiB, initial JS < 200 KiB i budżety tras; LCP < 2000 ms, TBT < 200 ms, CLS < 0,1. Fixture wydajności nie mierzy opóźnienia produkcyjnego API. |
| 5. Bezpieczeństwo | `e2e`: bramka MFA przed dostępem do portfela, anonimowe 401 i 401 po logout; testy API/identity, integracje RLS i audytu w workflow DB | Brak dowodu wykonania procedur awaryjnych na serwerze właściciela. |
| 6. Dostępność | `e2e`: axe WCAG A/AA, klawiatura, alternatywna tabela wykresu; axe także po rzeczywistym imporcie | Automaty nie zastępują VoiceOver. |
| 7. ADR-001 | Brak automatycznego pomiaru nakładu | Nakład i odchylenie niezmierzone; nie można potwierdzić limitu 2× estymacji. |

Lokalnie: pełne E2E **93/93 PASS**, sprawdzenia zmienionych pakietów **88/88 PASS**.
Powłoka **29,44/30 KiB**, Start **156,89 KiB**, portfel **161,76 KiB**,
instrument **162,00 KiB**, logowanie **143,76 KiB**. Wszystkie budżety tras PASS.
Logi robocze pozostają w `.git/`, bez publikowania sekretów testowych.

## BL-152 — część aplikacji

API i jobs wystawiają `/internal/metrics`; web ma `/internal/health`.
Caddy odrzuca publiczne `/internal` i `/internal/*`. Metryki obejmują HTTP,
auth, SSE, kolejki, wykonanie zadań, dostawców i zasoby. Raport błędów jest
agregowany w Valkey i wysyłany przez istniejący SMTP o 07:00 Europe/Warsaw
za poprzedni dzień UTC. Nie zawiera payloadów ani danych finansowych.

Workflow `workers` uruchamia `apps/jobs/scripts/test-monitoring.mjs`:
PostgreSQL + Valkey + Mailpit, agregacja współbieżna, restart, retry SMTP,
potwierdzenie doręczenia i metryki. Lokalnie PASS; test blokady Caddy PASS.
Ograniczenia utraty wpisu przy awarii Valkey i możliwego duplikatu między
akceptacją SMTP a zapisem potwierdzenia opisuje [monitoring § 5](../07-wdrozenie/monitoring.md).

## Do wykonania przez właściciela

1. Zaimportować rzeczywisty eksport XTB poza repozytorium. Zapisać wynik
   uzgodnienia: gotówka/ilości co do 0,00; P/L zrealizowany co do 0,01 PLN
   albo wyjaśnienie każdej różnicy. Nie dołączać wyciągu do PR.
2. Na telefonie zmierzyć import → portfel (< 2 min), płynność ekranów i wykresu.
   Po nowym notowaniu zmierzyć aktualizację przez SSE (≤ 5 s); potwierdzić GPW,
   NBP oraz zachowanie ostatnich danych po wyłączeniu adaptera.
3. Wykonać procedury awaryjne z [planu reagowania § 4](../06-bezpieczenstwo/plan-reagowania.md)
   i zachować protokół bez sekretów. Zweryfikować MFA, step-up i listę sesji
   na instancji docelowej.
4. Uzupełnić protokół VoiceOver poniżej. Porównać rzeczywisty nakład core/importu
   z estymacjami backlogu; powyżej 2× przeprowadzić przegląd ADR-001.
5. Zgodnie z [runbookiem](../07-wdrozenie/m0-3-backup-monitoring-runbook.md)
   i [monitoringiem § 3](../07-wdrozenie/monitoring.md) aktywować i odebrać
   wszystkie 13 sond: `app-ready`, `app-login-page`, `app-certificate`,
   `vm-health`, `jobs-scheduler`, `wal-archive`, `backup-local`, `backup-offsite`,
   `restore-test`, `eod-gpw`, `fx-nbp`, `ct-check`, `crowdsec-agent`.
   Sprawdzić rzeczywisty alarm i powrót do zdrowia, progi braku heartbeat,
   odbiór SMTP oraz dzienny raport. Tokeny monitorów pozostają na serwerze.
   Wszystkie 13 aktywnych sond to także warunek bramy B; ich gotowość nie
   wynika z implementacji metryk aplikacji.

### Protokół VoiceOver — niewykonany

Data, osoba, urządzenie, iOS/macOS, Safari, wersja aplikacji: **do uzupełnienia**.

| Czynność | Oczekiwanie | Wynik / uwagi |
|---|---|---|
| Logowanie i TOTP | Czytelne etykiety, komunikaty i fokus; brak pułapki klawiatury | do wykonania |
| Zapis kodów zapasowych | 10 kodów dostępnych do odczytu, potwierdzenie prowadzi do Start | do wykonania |
| Odczyt portfela | Nagłówki, kwoty/waluty, braki danych i świeżość odczytane poprawnie | do wykonania |
| Dodanie operacji | Walidacja i potwierdzenie ogłoszone, zachowana kolejność fokusu | do wykonania |
| Tabela zamiast wykresu | Dostęp do dat i OHLCV bez korzystania z canvas | do wykonania |

Decyzja o zamknięciu bramy A: **oczekuje na dowody właściciela i zielone CI/DoD**.
