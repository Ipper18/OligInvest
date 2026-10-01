# M0-2 — uruchomienie przez właściciela

**Cel:** przeprowadzić pierwsze wydanie i wdrożenie po przeglądzie PR, bez umieszczania konfiguracji instancji w publicznym repozytorium.

## Przygotowanie VM

1. Przejrzyj `infra/scripts/bootstrap-vm.sh` ze scalonego commita. Na dedykowanej VM Debian 13 amd64 uruchom jako root `sh infra/scripts/bootstrap-vm.sh --apply`. Skrypt instaluje Docker z repozytorium podpisanego kluczem o sprawdzonym odcisku; odmawia nadpisania innej konfiguracji demona. Uruchom ponownie Docker w oknie serwisowym, aby zastosować konfigurację.
2. Wykonaj hardening INF §11, sieć i firewall INF §4–5, NTS i DNS-over-TLS. Konfiguracja tunelu, SSH, adresy i porty instancji pozostają wyłącznie na serwerze. Zarezerwuj UID/GID z INF §8.1; nie przydzielaj ich lokalnym użytkownikom. Sam bootstrap nie potwierdza hardeningu ani monitoringu.
3. Zainstaluj `cosign` 3.1.3 z oficjalnego wydania Sigstore i zweryfikuj jego pochodzenie/checksum według instrukcji wydawcy. W PATH wymagane: `docker` z Compose, `python3` ≥3.13, `cosign`, `logger`. Root ma dostęp do publicznych GitHub Releases/GHCR i usług weryfikacji Sigstore.
4. Skopiuj `infra/instance.env.example` do `/etc/oliginvest/instance.env`, właściciel root, tryb 0600. Uzupełnij wszystkie `<…>`. `CADDY_ADMIN_URL` wskazuje IPv4 loopback **wewnątrz kontenera** i administracyjny port Caddy; nie jest publikowany na hoście. Publiczny origin musi zgadzać się z domeną certyfikatu.
5. Zaufaną, przejrzaną kopię `deploy.sh` i `deploy.py` przechowuj razem poza katalogiem tymczasowym. Skrypt pobiera i weryfikuje paczkę przed jej rozpakowaniem; nie uruchamiaj skryptu z nieweryfikowanego archiwum.

## Pierwsze wydanie i wdrożenie

1. Po scaleniu poczekaj na zielone kontrole commita `main`. Właściciel tworzy tag SemVer wskazujący ten commit. Agent M0-2 nie tworzy tagu, wydania ani pakietów.
2. `release.yml` najpierw testuje obrazy i skanuje je, następnie zadanie `release` publikuje dziewięć obrazów, podpisuje digesty, tworzy poświadczenia SBOM i pochodzenia. Dopiero po wszystkich poświadczeniach publikuje podpisaną paczkę. Sprawdź widoczność pakietów przed pierwszym pobraniem anonimowym; ustawienia GitHub zmienia właściciel.
3. Na VM uruchom jako root `sh <TRUSTED_SCRIPT_DIRECTORY>/deploy.sh <VERSION>`. Nie kopiuj znaczników dosłownie. Skrypt sprawdza tożsamość workflow/tagu, wystawcę OIDC oraz zgodność commita w podpisanym poświadczeniu z `images.lock`. Pobiera wyłącznie digesty przypisane do tego repozytorium.
4. Generator tworzy brakujące oryginały sekretów i kopie według jednej tabeli INF §8.1. Sekrety opcjonalne dostawców właściciel zapisuje wcześniej w `/etc/oliginvest/secrets/<NAME>` (root/0600); nie generujemy fikcyjnych poświadczeń dostawców. Żaden sekret nie trafia do parametrów wywołania ani publicznych logów.
5. Pierwsze uruchomienie inicjalizuje bazę i repozytorium pgBackRest, robi pełną kopię; następne — kopię przyrostową przed migracją. Migrator korzysta wyłącznie z roli owner. Odtwarzane są wszystkie kontenery, aby ponownie zamontować atomowo wymienione pliki. Bramka zdrowia ma limit 120 s. Sukces zapisuje `system.deploy` w audycie i atomowo przesuwa `/opt/oliginvest/current`.
6. Sprawdź HTTPS przez VPS, TLS 1.3/HSTS, health ready, brak publikacji portów wewnętrznych oraz sondy i alarmy z BL-029. Lokalny test Compose nie jest dowodem działania docelowego tunelu, certyfikatu publicznego ani kopii poza VM.

## Awaria, powtórzenie i rotacja

Nieudana kopia lub migracja zatrzymuje wdrożenie przed wymianą aplikacji. Nieudana bramka po wymianie przywraca obrazy aplikacji z poprzedniego wydania; nie cofa migracji ani wolumenów. Przy pierwszym wdrożeniu bez poprzednika zatrzymuje aplikacje i zachowuje bazę. Migracje muszą być rozszerzające i zgodne z poprzednią wersją. Awaria odtworzenia danych wymaga procedury DR, nie automatycznego `down -v`.

Istniejącego `/opt/oliginvest/releases/<VERSION>` skrypt nie nadpisuje: po awarii właściciel sprawdza stan, zachowuje diagnostykę, porządkuje wyłącznie nieaktywnego kandydata i powtarza wdrożenie. Wskaźnik `current` oznacza ostatnie zakończone wdrożenie; nie zastępuje kontroli zdrowia.

Przed wdrożeniem właściciel instaluje lokalny wykonywalny hook `/etc/oliginvest/deploy-failed` (root, bez prawa zapisu grupy/innych), który wysyła alert przez istniejące SMTP. Nie przyjmuje parametrów ani treści logów; agent nie wysyła wiadomości. Uptime Kuma z BL-029 pozostaje niezależną sondą gotowości. Przetestuj alarm syntetyczną awarią w oknie serwisowym.

Rotacja: pod blokadą `.operation.lock` atomowo wymień oryginał root/0600, uruchom `generate-secrets.sh`, a dopiero po sukcesie odtwórz **wszystkich** odbiorców z tabeli INF (`--force-recreate`, nie samo `restart`). Generator sam nie restartuje kontenerów. Nie uruchamiaj go równolegle z wdrożeniem. Hasła ról PostgreSQL wymagają skoordynowanej zmiany w bazie; klucz szyfrowania pgBackRest wymaga osobnej migracji repozytorium kopii. Zwykła podmiana tych plików nie jest kompletną rotacją.

## Dowody lokalne i CI

`node scripts/ci-images.mjs` buduje dziewięć obrazów i sprawdza USER, dokładne montowania sekretów, brak zapisu, izolację sieci i danych analytics, migrację, szyfrowaną kopię i ten sam zestaw 36 E2E w trzech przeglądarkach. `--skip-build` służy wyłącznie do powtórzenia testów istniejących lokalnych obrazów. Testy generatora i wdrożenia działają na Linux; nie używają sekretów instancji. Artefakt `production-images-report` zawiera jawnie wybrane logi testów oraz SBOM/OSV, bez plików sekretów i konfiguracji runtime.

Spiki oraz polecenie kalibracji Argon2id na VM: [BL-030/031](../08-plan/bl-030-031-auth-spikes.md). Wyniki i decyzje właściciela trzeba dopisać przed zamknięciem odpowiedniej części kryterium M0 nr 8.
