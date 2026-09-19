# Instrukcja administratora OligInvest

**Cel:** zebrać w jednym miejscu codzienne i awaryjne czynności administratora instancji — zaproszenia, polecenia administracyjne, wdrożenia, kopie i ich testy, obsługę praw użytkowników i zmian regulaminu — oraz ustalić nazwy poleceń CLI jako kontrakt dla implementacji (BL-111).

Powiązane: [`../06-bezpieczenstwo/plan-reagowania.md`](../06-bezpieczenstwo/plan-reagowania.md) (incydenty, playbooki P1–P14), [`../07-wdrozenie/infrastruktura.md`](../07-wdrozenie/infrastruktura.md), [`../07-wdrozenie/ci-cd.md`](../07-wdrozenie/ci-cd.md) § 6, [`../07-wdrozenie/backup-dr.md`](../07-wdrozenie/backup-dr.md), [`../07-wdrozenie/monitoring.md`](../07-wdrozenie/monitoring.md), [`../06-bezpieczenstwo/prywatnosc-rodo.md`](../06-bezpieczenstwo/prywatnosc-rodo.md).

> Adresy IP, porty, nazwy hostów i sekrety nie trafiają do repozytorium — trzymaj je w menedżerze haseł i w materiałach awaryjnych offline ([`../06-bezpieczenstwo/plan-reagowania.md`](../06-bezpieczenstwo/plan-reagowania.md) § 1).

## 1. Zasady

- Administrator nie przegląda danych finansowych użytkowników; panel `/admin` ich nie pokazuje, a impersonacja jest wyłączona. Dostęp do bazy — wyłącznie przy naprawie awarii albo na prośbę użytkownika, z wpisem w notatkach.
- Każde polecenie administracyjne zapisuje wpis audytu (aktor `system`, powód); powód podawaj zawsze (`--reason`).
- Zmiany w panelu admina wymagają świeżej weryfikacji TOTP (step-up, 15 min).

## 2. Polecenia administracyjne (CLI)

Na serwerze: `sudo /opt/oliginvest/bin/oli-admin <polecenie> [opcje]` — skrypt uruchamia CLI w kontenerze `api` (`docker compose exec`). Lokalnie w repozytorium: `pnpm admin:<polecenie>`. Nazwy i opcje poniżej są kontraktem dla BL-111.

| Polecenie | Skutek | Kiedy |
|---|---|---|
| `invite --email <adres> --role user\|pro\|admin` | tworzy zaproszenie ważne 72 h i wysyła e-mail; wypisuje link (token we fragmencie adresu) | pierwsze konto administratora; zaproszenie bez panelu |
| `reset-2fa --email <adres> --reason "<powód>"` | wyłącza TOTP konta; przy następnym logowaniu użytkownik konfiguruje go od nowa; e-mail do użytkownika | utracony telefon i kody (po potwierdzeniu tożsamości poza aplikacją); break-glass P13 |
| `revoke-sessions --email <adres>` | wylogowuje użytkownika ze wszystkich urządzeń (≤ 60 s) | podejrzenie przejęcia konta (P1) |
| `revoke-all-sessions --reason "<powód>"` | wylogowuje wszystkich | incydent, odtworzenie z kopii starszej niż 1 h |
| `revoke-pats --email <adres>` / `revoke-all-pats --reason "<powód>"` | odwołuje tokeny PAT użytkownika albo wszystkie | zgubiony telefon (P4), incydent, odtworzenie z kopii |
| `queues pause\|resume [--queue <nazwa>]` | wstrzymuje lub wznawia kolejki (importy, alerty, e-maile, push) | incydent, masowe błędy dostawcy |
| `flag <klucz> on\|off [--role <rola>] [--user <adres>]` | włącza lub wyłącza moduł albo funkcję (`module.<id>…`, `auth.oauth` …) | wyłącznik awaryjny modułu, stopniowe włączanie funkcji |
| `erasure-replay --file <ścieżka erasure-log.jsonl>` | ponownie usuwa konta z listy usunięć | zawsze po odtworzeniu z kopii ([`../07-wdrozenie/backup-dr.md`](../07-wdrozenie/backup-dr.md) § 6–7) |
| `recompute-all` | przelicza pozycje i wyceny wszystkich rachunków | po odtworzeniu, po korekcie danych rynkowych |
| `terms-notify --version <RRRR-MM> --effective <RRRR-MM-DD>` | wysyła e-mail o zmianie regulaminu | co najmniej 14 dni przed wejściem nowej wersji (§ 6) |

Skrypty hosta (poza CLI aplikacji): `infra/scripts/deploy.sh <wersja>` (wdrożenie), `infra/scripts/maintenance.sh on|off` (tryb serwisowy w Caddy — strona 503), `infra/scripts/generate-secrets.sh` (pierwsza instalacja, rotacja).

## 3. Zaproszenia i konta

1. Pierwsze konto administratora: `oli-admin invite --email <adres> --role admin`, rejestracja z linku, TOTP, kody zapasowe do menedżera haseł.
2. Kolejne osoby: **/admin → Zaproszenia** (brama B M1). Zapraszaj tylko pełnoletnie osoby, które same o to prosiły; e-mail z zaproszeniem zawiera informację z art. 14 RODO.
3. Rola `pro` daje dostęp do ciężkich analiz (Monte Carlo, optymalizacja, backtest, testy skrajne) — nadawaj świadomie, bo obciążają serwer współdzielony z Immichem.
4. Blokada konta: **/admin → Użytkownicy** (od M5a) albo `revoke-sessions` + `revoke-pats`, z e-mailem do użytkownika (regulamin § 4 ust. 4).

## 4. Wdrożenie nowej wersji

1. Po scaleniu zmian utwórz tag `vX.Y.Z` na `main`; poczekaj na zielone zadanie `release` (obrazy, SBOM, podpisy).
2. Na VM przez sieć administracyjną: `sudo /opt/oliginvest/bin/deploy.sh vX.Y.Z` — skrypt sprawdza podpisy, robi kopię, migruje bazę, podmienia usługi i uruchamia test dymny; przy błędzie sam wraca do poprzedniej wersji i wysyła alert.
3. Sprawdź: `https://invest.oligi.pl/api/v1/health/ready`, sondy Uptime Kuma, brak nowych błędów w dziennym raporcie.

## 5. Czynności okresowe

| Kiedy | Czynność |
|---|---|
| codziennie (automatycznie) | raport błędów e-mailem; sondy Uptime Kuma; `ct-check` (certyfikaty dla `invest.oligi.pl` i `*.oligi.pl`) |
| co tydzień | przegląd PR-ów Renovate; weryfikacja repozytoriów kopii (automatyczna — sprawdź alerty) |
| co miesiąc | aktualizacje hosta Proxmox (po kopii VM); raport miesięczny z [`../07-wdrozenie/monitoring.md`](../07-wdrozenie/monitoring.md) § 9; automatyczny test odtworzenia — sprawdź wynik |
| co kwartał | ćwiczenie odtworzenia z protokołem (scenariusze A → C → D → E); przegląd drzewa zależności; przegląd sesji i tokenów administratorów |
| co rok | rotacja sekretów wg [`../07-wdrozenie/infrastruktura.md`](../07-wdrozenie/infrastruktura.md) § 8; przegląd dokumentów prawnych ([`../11-zgodnosc-prawna.md`](../11-zgodnosc-prawna.md) § 8); przegląd modelu zagrożeń i rejestru ryzyk |

## 6. Zmiana regulaminu lub informacji o danych

1. Przygotuj nową wersję w `docs/12-dla-uzytkownika/` (np. `2026-11`) z podsumowaniem zmian; PR aktualizuje też MDX i stałą wersji w `packages/contracts`.
2. Co najmniej 14 dni przed wejściem w życie: `oli-admin terms-notify --version <v> --effective <data>` (wyjątek: zmiana wymuszona prawem lub bezpieczeństwem).
3. Wdróż wersję aplikacji z nowym dokumentem przed datą wejścia w życie; od tej daty bramka `TERMS_ACCEPTANCE_REQUIRED` prosi o akceptację (eksport i usunięcie konta pozostają dostępne).
4. Zmiana samej informacji o danych nie blokuje aplikacji — wystarczy baner i e-mail.

## 7. Wnioski użytkowników (RODO)

- Eksport i usunięcie konta użytkownik wykonuje sam w ustawieniach. Pomóż tylko, gdy nie może się zalogować — po potwierdzeniu tożsamości (wiadomość z adresu konta i potwierdzenie w aplikacji albo inną znaną drogą).
- Sprostowanie adresu e-mail wykonuje administrator (`/admin → Użytkownicy`) na prośbę z dotychczasowego adresu.
- Sprzeciw, ograniczenie przetwarzania i inne wnioski: odpowiedź w ciągu miesiąca; zapis w notatkach administratora (bez danych finansowych).
- Każdy wniosek i jego realizacja trafiają do audytu.

## 8. Incydenty

Postępuj według [`../06-bezpieczenstwo/plan-reagowania.md`](../06-bezpieczenstwo/plan-reagowania.md): klasyfikacja SEV, wyłączniki awaryjne (§ 4 — m.in. usunięcie nazwy z mapy SNI na VPS, tryb serwisowy, flagi, `revoke-all-sessions`), playbooki P1–P14 i — przy naruszeniu ochrony danych — ocena i zgłoszenie do Prezesa UODO w ciągu 72 godzin (§ 7). Najczęstsze sytuacje:

| Sytuacja | Pierwsze kroki |
|---|---|
| Użytkownik zgubił telefon | `revoke-sessions` i `revoke-pats` dla konta; `reset-2fa` po potwierdzeniu tożsamości |
| Podejrzane logowanie (e-mail o nowym urządzeniu, którego nie było) | `revoke-sessions`, prośba o zmianę hasła, przegląd audytu i logów po `request-id` |
| Brak danych EOD GPW przez 2 sesje | sonda `eod-gpw`; sprawdź status dostawcy w `/admin/dostawcy`; w razie potrzeby import ręczny XLS w `/admin/dane-rynkowe` |
| Aplikacja niedostępna | Uptime Kuma: czy dom odpowiada (sonda `vm-health`); runbooki R1–R11 w [`../07-wdrozenie/monitoring.md`](../07-wdrozenie/monitoring.md) § 8 |
| Awaria dysku lub VM | procedury B–D w [`../07-wdrozenie/backup-dr.md`](../07-wdrozenie/backup-dr.md) § 5, potem § 6 (w tym `erasure-replay`, `recompute-all`) |
