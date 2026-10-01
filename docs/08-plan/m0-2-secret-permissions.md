# M0-2 — uprawnienia sekretów w Compose

**Cel:** udokumentować sprzeczność w INF i przedstawić właścicielowi konkretną korektę przed implementacją BL-020/022/023.

**Status: propozycja do zatwierdzenia, 2026-10-01.** Nie zmienia obowiązującej konfiguracji ani ADR. Powiązane: [INF](../07-wdrozenie/infrastruktura.md) §5.3, §6.1 i §8, [AGENTS](../../AGENTS.md) §2.5, R-27 w [rejestrze ryzyk](ryzyka.md).

## Sprzeczność i dowód

INF §5.3 określa `/etc/oliginvest/secrets/` jako katalog roota 0700, a pliki jako własność roota 0600. INF §6.1 wymaga kontenerów non-root bez capabilities i sekretów montowanych pod `/run/secrets/`. Taki proces nie ma prawa odczytać pliku 0600 należącego do roota.

[Dokumentacja Docker Compose, secrets](https://docs.docker.com/reference/compose-file/services/#secrets), sprawdzona 2026-10-01: dla źródła `file` Compose stosuje bind mount i ignoruje `uid`, `gid` oraz `mode`. Dodanie tych pól w YAML nie rozwiązuje konfliktu.

Reprodukcja lokalna: Docker Engine 29.4.3, Compose, obraz PostgreSQL 18.6 przypięty tym samym digestem co `compose.dev.yaml`. Jednorazowy kontener przygotowujący utworzył w osobnym linuksowym wolumenie dwa pliki z tekstem syntetycznym. Kontener testowy UID/GID 10001, `network_mode: none`, `read_only: true`, `cap_drop: [ALL]`, `no-new-privileges` dostał te pliki przez `secrets.file`. Dla oryginału zadeklarowano także `uid/gid: 10001`, `mode: 0400`.

| Asercja | Wynik |
|---|---|
| Oryginał zachowuje 0:0 i 0600 mimo pól w Compose | PASS |
| Proces nie może odczytać oryginału | PASS |
| Kopia należąca do 10001:10001, tryb 0400, daje się odczytać | PASS |
| Proces nie może zapisać kopii | PASS |

Compose wypisał ostrzeżenie o ignorowaniu `uid/gid/mode`. Ścieżki plików z wolumenu demona nie istnieją na hoście Windows, co powoduje dodatkowe ostrzeżenia klienta, ale montowania i wszystkie asercje przeszły. Projekt testowy i jego wolumen usunięto. Test nie uruchamiał bazy, nie używał prawdziwych sekretów ani serwerów. Materiały diagnostyczne pozostają lokalnie w `.git/m0-2-secret-probe.yaml`.

## Proponowana korekta INF §5.3 i §8

Zachować oryginały `/etc/oliginvest/secrets/` jako root:root, katalog 0700 i pliki 0600. Dodać osobny katalog kopii do montowania `/etc/oliginvest/runtime-secrets/`: katalog główny i podkatalogi per usługa root:root 0700, pliki należące do liczbowego UID/GID odbiorcy z trybem 0400. Kontenery dostają wyłącznie indywidualne pliki swojej usługi, tylko do odczytu; katalogi hosta nie są montowane. Kopia wspólnego sekretu powstaje osobno dla każdego uprawnionego odbiorcy.

Kopie przygotowuje skrypt właściciela na hoście, przed uruchomieniem Compose, bez kontenera root inicjalizującego produkcję. Macierz sekret → odbiorcy oraz UID/GID musi być jawna i zgodna z obrazami. UID należy zarezerwować na VM bez lokalnych kont interaktywnych; w tej propozycji używany jest standardowy rootful Docker bez remapowania użytkowników. Inny model mapowania wymaga osobnej weryfikacji.

Generowanie i rotacja nie wypisują treści. Po atomowej wymianie kopii konieczne jest odtworzenie kontenerów odbiorców: bind mount może nadal wskazywać stary inode, a aplikacje czytają konfigurację przy starcie. Kopie nie zastępują depozytu oryginałów w menedżerze haseł. Procedura usuwania sekretu usuwa też wszystkie jego kopie. Sekrety nigdy nie wchodzą do obrazu, paczki wydania, repozytorium ani artefaktów CI.

Zachowane pozostają: non-root, read-only FS, `cap_drop: ALL`, `no-new-privileges`, `_FILE` i minimalny zestaw montowań per usługa. Odrzucone obejścia: 0444 dla oryginałów, proces aplikacji jako root, `CAP_DAC_OVERRIDE`, sekrety w zmiennych środowiskowych.

## Weryfikacja po zatwierdzeniu

Testy Linux/Compose sprawdzą odczyt wyłącznie własnych sekretów przez każdy produkcyjny UID, brak zapisu, brak montowań cudzych sekretów, brak dostępu zwykłego użytkownika hosta przez katalog root/0700, idempotencję generatora, rotację z odtworzeniem kontenera i brak wartości w logach. Reprodukcja powyżej potwierdza mechanizm uprawnień, ale nie zastępuje tych testów integracyjnych.

**Decyzja oczekiwana:** zatwierdzić tę korektę INF przed implementacją. Nie zmienia ona topologii ani stosu, dlatego proponujemy zmianę dokumentu, bez nowego ADR.
