# M0-2 — stan bieżący

**Cel:** przekazać stan paczki wydaniowej i następny krok; dowody zamkniętych etapów w [historii](m0-2-session-history.md).

**2026-10-01**, [roboczy PR #5](https://github.com/Ipper18/OligInvest/pull/5), gałąź `feat/m0-2-release` z aktualnego `main` (`25e8762`). Zakres: BL-020, BL-021, BL-022, BL-023, BL-030, BL-031 i część obrazowa BL-018. Zależności M0-1 wykonane technicznie i scalone; zgodnie z AGENTS §6.1 ich status `w toku` nie blokuje pracy.

## Zrobione

Przeczytano instrukcje, raport M0-1, wiersze backlogu, kryteria M0, INF, CI, SEC §4 i ADR-003/004/011/013. Utworzono gałąź; przygotowano propozycję rozstrzygnięcia sprzeczności uprawnień sekretów w [notatce](m0-2-secret-permissions.md). Docker Engine 29.4.3 jest dostępny po uruchomieniu Docker Desktop.

Lokalny Compose na przypiętym obrazie PostgreSQL z `compose.dev.yaml`: syntetyczny plik `root:root 0600` jest nieczytelny dla UID 10001, także po ustawieniu `secrets.uid/gid/mode`. Kopia `10001:10001 0400` jest czytelna i niezapisywalna w kontenerze non-root, read-only, bez capabilities i sieci. Test PASS; projekt i jego wolumen usunięte. To dowód uprawnień, nie test obrazów aplikacji ani zamknięcie BL-018.

## Decyzja i następny krok

Właściciel zatwierdził 2026-10-01 korektę INF §5.3 i §8: oryginały root/0600, kopie per odbiorca 0400, katalogi root/0700. Jedna tabela UID/GID i sekretów w INF jest źródłem generatora i testów. Wymagane idempotencja, atomowa wymiana wszystkich kopii przed odtworzeniem odbiorców i test Linux w CI. Dokumentacja w osobnym commicie docs:, bez ADR. Blokada R-27 rozstrzygnięta; kontynuacja obrazów, Compose i wydania.

## Pominięte, odchylenia i ryzyka

Implementacja BL-020–023 oraz spiki BL-030/031 pozostają do wykonania po zatwierdzeniu korekty. BL-018 czeka na obrazy. BL-022 rozpoczęto od analizy dokumentu; pozostałe statusy bez zmian. Estymacje bez zmian, nakład niezmierzony. Nowe R-27: niedostępność sekretów dla non-root. Bez zmian OpenAPI, SQL, wzorów i disclaimerów; bez nowych zależności.

M0 nie jest zamknięty: kryterium 4 (wydanie i wdrożenie) oraz 8 (spiki) otwarte. Ta sesja nie potwierdza kryteriów infrastruktury docelowej. Bez tagów, wydań, publikacji GHCR, zmian ustawień GitHub i operacji na serwerach. Wynik bieżących kontroli: zakładka Checks roboczego PR; zielone CI dokumentacji nie oznacza ukończenia paczki.
