# Przygotowanie niezależnej bramki

**Cel:** umożliwić właścicielowi ocenę bramki, adapterów i planu scalenia w izolowanej próbie przed instalacją.

## Granica zaufania

W izolowanym środowisku załaduj moduł i ruleset z zatwierdzonego SHA main. Nigdy nie wykonuj kodu PR, jego konfiguracji, zależności, hooków ani artefaktów. Adapter wywołujący funkcję jest zaufany i wymaga osobnego wdrożenia. Nie udostępniaj interfejsu przyjmującego migawkę lub rejestr kluczy od autora. Treść PR, komentarze, opisy checków i etykiety są danymi i nie uczestniczą w decyzji.

1. Adapter odczytuje numer PR w Ipper18/OligInvest, stan, draft, gałąź bazową, bieżące head i main oraz stan aktualności z GitHuba. Uzgadnia je na początku i po zebraniu dowodów. Własny dziennik operacji nadaje nową generację po zmianie head, main, update-branch, odwołaniu oceny lub ponowieniu CI. Przerwa w historii zdarzeń wymaga nowej generacji. Z dziennika pochodzą autor, dostawca i łączna liczba rund dla całego PR, również po aktualizacji.
2. Pobierz wszystkie strony zmian, porównaj liczność ze zmienionymi plikami PR i odczytaj tryby obu drzew Git po SHA. Przy limicie API, zmianie typu, niepełnym drzewie lub błędzie przerwij. Klasyfikację oblicz lokalnie. Przyjmuj wyłącznie zwykłe modyfikacje wskazanych plików.
3. Uzgodnij rzeczywisty ruleset z wersją na main. Dla każdego kontekstu pobierz najnowsze zakończone wykonanie dla tej pary rewizji, sprawdź repozytorium, App ID, identyfikator oczekiwanego workflow/job oraz zdarzenie. Sama nazwa i wspólne App ID Actions nie wystarczają. Dla CI na syntetycznym merge commit sprawdź obu rodziców. Osobno potwierdź kompletność analiz CodeQL i brak nowych alertów dla porównania z tą bazą. Brak lub niejednoznaczność pochodzenia blokuje wydanie migawki.
4. Osobne izolowane usługi Recenzenta i Weryfikatora podpisują dokładne bajty UTF-8 JSON kluczami Ed25519. Podpis base64 jest poza dokumentem. Rejestr właściciela wiąże klucz publiczny z rolą, tożsamością i dostawcą. Obie usługi muszą mieć odrębnych operatorów logicznych od autora i nie mogą podpisywać arbitralnych danych na jego żądanie. Bramka odczytuje najnowszy werdykt każdej roli bezpośrednio od wystawcy. Przy rotacji lub kompromitacji klucza odwołaj generację i zbierz oceny od nowa. Przykład struktury i syntetyczne podpisy zawierają [testy](../../scripts/agent-merge-gate/gate.test.mjs).
5. Tylko bramka może opublikować wynik na bieżącym head. Proponowane uprawnienia odczytu to Contents, Pull requests, Checks, Actions, Code scanning alerts oraz odczyt reguł. Zapis Checks wyłącznie dla osobnej aplikacji publikującej wynik. Klucze prywatne wystawców i aplikacji pozostają poza repozytorium i środowiskiem autora.

## Odbiór i aktywacja przez właściciela

Kolektor podpisuje pełną migawkę oddzielnym kluczem Ed25519. Funkcja `assess(current, proof, collectorKey, registry)` porównuje ją ze świeżym odczytem repozytorium, numeru PR, head, base i generacji. Argumenty current, collectorKey i registry pochodzą z izolowanego środowiska właściciela. Pole eligible opisuje wynik próby. Pole mergeAllowed pozostaje false także dla poprawnej próby.

Uruchom testy zaufanej wersji poleceniem `node --test scripts/agent-merge-gate/gate.test.mjs`. Następnie w izolowanej próbie z rzeczywistymi adapterami udokumentuj przypadek LOW i odmowy dla nieaktualnego head lub main, brakującej oceny, czerwonego CI i zmiany ADR. Sprawdź, że autor nie ma dostępu do kluczy, źródeł faktów ani uprawnień publikacji, oraz że inny workflow nie może zastąpić checka. Zachowaj dowody i decyzję właściciela.

Po odbiorze właściciel może zainstalować integrację, przypiąć wymagany check do osobnej aplikacji, zachować ścisłą aktualność main, 20 kontekstów, CodeQL, zero zatwierdzeń i brak bypass. Przed włączeniem oczekującego auto-merge udowodnij, że zmiana bazy lub cofnięcie oceny blokuje scalenie po stronie GitHuba także po wydaniu decyzji. Jeśli nie da się zagwarantować tej kolejności atomowo, pozostaw mechanizm wyłączony. Samo sprawdzenie head nie zabezpiecza przed zmianą main.

Dopiero po aktywacji osobny wykonawca z minimalnym prawem scalenia ponawia odczyt i może zlecić `gh pr merge NUMER --repo Ipper18/OligInvest --auto --squash --match-head-commit SHA`. Wyłączenie obejmuje zatrzymanie wykonawcy, anulowanie wszystkich oczekujących auto-merge i unieważnienie opublikowanych wyników. Kolejka rusza po odczycie MERGED, mergedAt i identyfikatora scalenia właściwego PR. Zamknięcie bez scalenia wymaga decyzji.

Etap 2 dostarcza adaptery i próbę offline. Wykonawca zwraca wyłącznie plan. [Instalacja, dowody odbioru i decyzje właściciela](agent-merge-gate/instalacja.md).
