# Odbiór etapu 2 przez właściciela

**Cel:** zebrać dowody dla konkretnego PR, pary rewizji i generacji przed decyzją o instalacji. Domyślnie działa ręczne scalanie według ADR-018. Stan projektu ADR-019 to „proponowana”.

## Próba offline

Na zatwierdzonym SHA main uruchom w Node 24:

```sh
node --test scripts/agent-merge-gate/
node scripts/agent-merge-gate/acceptance.mjs /tmp/gate-trial.json
```

Podaj nową nazwę pliku. Raport JSON zawiera czas, tryb offline oraz oczekiwany i zaobserwowany wynik każdego scenariusza. Podpisy powstają przy użyciu jednorazowych kluczy w pamięci. Dla LOW oczekuj `eligible: true` i `mergeAllowed: false`. Lista LOW jest w policy.json.

## Instalacja próbna na izolowanym hoście

1. Właściciel przypina zweryfikowany SHA main i instaluje odrębne konta systemowe kolektora, obu wystawców, publikatora i wykonawcy. Katalog z kodem i konfiguracja są tylko do odczytu. Autor PR nie ma dostępu do kont, systemu plików, panelu wydawania poświadczeń ani endpointów usług. Odbiór zaczyna się od samego odczytu.
2. Utwórz osobne Apps instalowane wyłącznie dla OligInvest. Nadaj kolektorowi Metadata, Contents, Pull requests, Checks, Actions, Code scanning alerts i Administration (odczyt reguł) w trybie read. Publikator potrzebuje Metadata read i Checks write. Dla przyszłego wykonawcy przygotuj osobną tożsamość z Metadata read, Pull requests write i Contents write. Do próby planowania nie instaluj jej klucza. Żadna z aplikacji nie otrzymuje bypass ani prawa administracji write. Weryfikuj rzeczywiste uprawnienia tokenów instalacyjnych. [Checks API](https://docs.github.com/en/rest/checks/runs)
3. W osobnych magazynach utwórz trzy pary Ed25519 (kolektor, Recenzent i Weryfikator). Do procesu trafia wyłącznie właściwy klucz: `GATE_COLLECTOR_KEY_FILE` lub `GATE_ISSUER_KEY_FILE`, ewentualnie PEM w odpowiedniej zmiennej bez przyrostka `_FILE`. Pliki muszą leżeć poza checkoutem, z ACL tylko dla odpowiedniego konta. Osobne klucze prywatne GitHub Apps pozostają w magazynach ich operatorów. Broker kolektora dostarcza krótkotrwały `GATE_COLLECTOR_TOKEN`; publikator otrzymuje JWT wyłącznie własnej App. Klucze Ed25519 i klucze Apps pełnią różne funkcje.
4. Właściciel przypina publiczny klucz kolektora oraz rejestr wystawców. Pusty rejestr instalacyjny to `{}`. Wypełnij pola `reviewer` i `verifier` obiektami z `id`, `provider` i publicznym PEM `publicKey`. Sprawdź dowód posiadania klucza przez każdego operatora. Recenzent ma innego dostawcę niż autor. Po rotacji otwórz nową generację. Kolektor czyta jedynie klucze publiczne wystawców.
5. Przygotuj plik JSON wskazany przez `GATE_COLLECTOR_CONFIG`: `collectorPublicKey`, `registry`, `journalDirectory`, `issuerDirectories` (osobny katalog dla każdej roli) i `pins`. W `pins` umieść liczbowe `rulesetId`, `actionsAppId`, mapę nazw plików workflow bez rozszerzenia na ich stałe GitHub workflow ID (`workflows`) oraz `codeql` z zatwierdzonymi polami `language/analysisKey/category/environment` dla actions, javascript-typescript i python. Wartości ustal niezależnie na main. Jobs pochodzą z konkretnej próby wykonania workflow. URL check-run wiąże job ID z check ID, także dla macierzy. Brak wymaganych pól lub związku obu rodziców testowego scalenia zamyka ocenę. [Workflow jobs](https://docs.github.com/en/rest/actions/workflow-jobs) i [Code scanning](https://docs.github.com/en/rest/code-scanning/code-scanning)
6. Źródłem dziennika jest zaufany operator orkiestracji. Udostępnia kolektorowi pełną, odporną na cofnięcie projekcję zdarzeń w pliku `<PR>.json`, wymienianym atomowo. Pierwszy wpis typu `checkpoint` zawiera repo, pr, head, base, offset, autora logicznego, githubAuthor, authorProvider, łączną liczbę rund, liczniki sequences obu ról i ciEpoch (funkcja `ciEpoch` z collector-ci.mjs). Rejestruj każde revision, update-branch, retry-ci, revoke i round pod kolejnym offsetem. Po zmianie rewizji zapisz oba SHA; po ponowieniu CI lub zmianie rewizji zapisz również nowy ciEpoch. Luka zatrzymuje ocenę do uzgodnienia źródeł i nowego checkpointu z wyższym offsetem i zachowanymi licznikami. Wznowienie po utracie historii wymaga wycofania poprzednich ocen. Ochronę przed przywróceniem całego starego dziennika zapewnia magazyn właściciela z trwałym, monotonicznym kursorem. Zwykły współdzielony katalog zapisywalny przez autora nie spełnia tego warunku. Zaufany odbiorca zapisuje dostawę poleceniem `node scripts/agent-merge-gate/record-operation.mjs` z JSON na stdin zawierającym `event` i `expectedOffset`. `GATE_JOURNAL_CONFIG` wskazuje plik z directory (`journalDirectory`) i rejestrem (`registry`). Dla zdarzeń rewizji i CI narzędzie samodzielnie odczytuje SHA oraz ciEpoch przez token tylko do odczytu. Blokada zapisu chroni porównanie kursora i podmianę całej projekcji. Po awarii w trakcie zapisu operator uzgadnia źródło, kursor i pozostałe pliki .lock/.next przed wznowieniem.
7. Kolektor wystawia podpisane, ważne 60 sekund wyzwanie dla bieżącej generacji. Każdy wystawca przeprowadza własną ocenę. Jego konfiguracja `GATE_ISSUER_CONFIG` zawiera rolę, registry, collectorPublicKey i absolutną ścieżkę challengeFile oraz issuerDirectory wskazujące na trwały katalog dostępny do zapisu wyłącznie dla wystawcy. Wywołanie CLI dostępne jest wyłącznie operatorowi tej roli.

```sh
node scripts/agent-merge-gate/collect-cli.mjs challenge "$PR"
node scripts/agent-merge-gate/sign-verdict.mjs < verdict.json
node scripts/agent-merge-gate/collect-cli.mjs evaluate "$PR"
```

   Werdykt zawiera repo, pr, head, base, generation, role, issuer, provider, verdict, risk, issuedAt (sekundy Unix), ttl (1–900 sekund) i sequence. CLI rezerwuje plik <PR>/<sequence>.json w magazynie wystawcy wyłącznym otwarciem do zapisu. Kolektor czyta najwyższy numer bezpośrednio z tego magazynu. Operator zapisuje zdarzenie verdict z tą samą kopertą w dzienniku. Przerwany zapis zatrzymuje ocenę do uzgodnienia historii. Rozbieżność obu źródeł blokuje decyzję. Odwołanie oceny lub DO POPRAWY wymaga ponownego podpisania przez obie role. Operator nie oferuje autorowi usługi podpisującej dowolny JSON.
8. [Propozycję workflow](agent-merge-gate.workflow.proposed.yml) instaluje wyłącznie właściciel. Pierwsze zadanie testuje wskazaną rewizję main na jednorazowym runnerze. Drugie uruchamia [lokalny launcher](owner-acceptance) zainstalowany w /opt/oliginvest-gate/bin/owner-acceptance i porównuje SHA z checkoutem przeznaczonym tylko do odczytu. Grupa runnerów może wykonywać wyłącznie ten workflow z chronionej gałęzi main. Środowisko dopuszcza tylko main i wymaga zgody właściciela. Jeśli plan GitHuba nie umożliwia takiej izolacji, uruchamiaj launcher poza Actions. Nie montuj sekretów wystawców, publikatora ani wykonawcy. Nie uruchamiaj artefaktów, skryptów ani zależności z PR.

## Próba z rzeczywistymi adapterami

Zachowaj osobny zapis JSON dla każdej próby: czas UTC, SHA kolektora z main, repo, numer PR, head, base, generację, ID workflow/run/attempt/job/check/App, identyfikatory analiz CodeQL, podpisaną migawkę, numery ocen, termin ważności, expected, observed, checkId i wynik. Usuń nagłówki HTTP i poświadczenia z zapisów. Powtórz pozytywny przypadek dla zwykłej zmiany instrukcji użytkownika oraz odmowy po zmianie main, aktualizacji gałęzi, braku werdyktu, DO POPRAWY po GOTOWE, ponowieniu CI, czerwonym CI i zmianie ADR. Przetestuj przerwę w dzienniku, wymianę klucza, nowszy oczekujący job i inną aplikację publikującą check o tej samej nazwie. Spróbuj odczytać klucze wystawców z konta kolektora. Oczekiwany wynik to odmowa dostępu.

Publikację próbną wywołuje izolowana usługa właściciela przez `publishResult` z metodami evaluate i reassess kolektora, pr, appId, installationId oraz appJwt. Dopiero jawne `enabled: true` publikuje osobny informacyjny check `agent-merge-gate/trial`. Wykonawca `planMerge` domyślnie odmawia. Przy dodatniej decyzji i jawnej fladze zwraca tablicę argumentów wyłącznie do odczytu przez operatora.

## Atomowość i wycofanie

Ścisła aktualność main wymaga, by gałąź zawierała najnowszą bazę. Check przypięty do osobnej aplikacji chroni pochodzenie wyniku na head. Parametr match-head-commit wiąże polecenie tylko z head. Po zewnętrznym odwołaniu oceny istnieje przedział czasu, w którym GitHub nadal widzi wcześniejszy zielony check. Powtórny odczyt i późniejszy zapis czerwonego checka nie stanowią wspólnej transakcji z operacją scalenia. Próba offline nie dowodzi atomowości. Do wykazania gwarancji po stronie GitHuba obowiązuje ręczne scalanie, także po pozytywnym odbiorze adapterów.

W kontrolowanym repozytorium odbiorczym sprawdź dwa wyścigi: zmianę main po decyzji oraz cofnięcie werdyktu po decyzji przy niezmienionym head. Zachowaj historię checków i decyzję GitHuba o zablokowaniu próby. Sam pojedynczy pomyślny test wyścigu nie zastępuje gwarancji kolejności operacji. Sprawdź także, czy oczekujący wymagany check samej bramki wpływa na mergeState. Etap 2 wymaga CLEAN oraz dotychczasowej konfiguracji 20 kontroli i odmówi przy zmianie rulesetu.

Wycofanie przećwicz przez `shutdownPlan(pendingPrs, publishedRuns)`. Na instalacji operator najpierw zatrzymuje wykonawcę i nowe publikacje, pobiera pełną listę PR z oczekującym auto-merge, anuluje je, oznacza wydane wyniki jako failure i unieważnia generacje. Ponowny odczyt musi wykazać pustą kolejkę oraz brak ważnych decyzji. Zachowaj historię, odbierz zbędne poświadczenia i wróć do ręcznego scalania. W tym etapie procedura jedynie buduje plan.

## Co nadal wymaga decyzji właściciela

a. Jakie Apps i konta izolowane obsłużą kolektor, publikator i ewentualnego wykonawcę? Zalecane są trzy instalacje ograniczone do jednego repozytorium i rozdzielone magazyny kluczy.

b. Kto poświadcza autora, dostawcę i historię odwołań? Zalecany jest dziennik poza zasięgiem autora, osobne źródła najnowszych werdyktów, ochrona przed odtworzeniem i procedura odzyskania ciągłości.

c. Czy po odbiorze właściciel zatwierdzi osobny wymagany check przypięty do App ID, oprócz 20 kontekstów i CodeQL, przy strict up-to-date, zerze wymaganych zatwierdzeń i pustej liście bypass? Wymaga to osobnej zmiany polityki i próby na rzeczywistym rulesecie. Nazwy próbnej nie należy instalować jako wymaganej.

d. Czy właściciel zainstaluje proponowany workflow i zatwierdzi izolację runnerów? Zalecana jest najpierw próba odczytu z chronionego main i ręczne porównanie dowodów.

e. Czy wykazano atomowość odwołania i aktualności bazy? Do tego czasu opcja auto-merge pozostaje wyłączona. Przy pozytywnym odbiorze tylko właściciel może przyjąć ADR-019, zmienić ustawienia i wyrazić odrębną zgodę na aktywację.
