# Ustawienia repozytorium — wykonuje właściciel

**Cel:** przeprowadzić właściciela przez aktywację zabezpieczeń GitHub po scaleniu M0-1 i zapisać dowody BL-019 oraz kryterium M0 nr 7. Dodanie plików do repozytorium nie zmienia ustawień GitHub.

Powiązane: [CI/CD](ci-cd.md), [CONTRIBUTING](../../CONTRIBUTING.md), [ADR-013](../09-decyzje/ADR-013-repozytorium-publiczne.md), [raport M0-1](../08-plan/m0-1-session-report.md), [definicja rulesetu](../../.github/rulesets/main.json), [CODEOWNERS](../../.github/CODEOWNERS), [Renovate](../../renovate.json).

## 1. Stan początkowy i warunki aktywacji

Odczyt GitHub API z 2026-09-20: `main`, włączone secret scanning i push protection, konfiguracja domyślna CodeQL z językiem `python`; brak rulesetu. Jedyny współpracownik z uprawnieniami zapisu to `Ipper18`; GitHub CLI działa jako to samo konto. Ten odczyt nie potwierdza aktualnego stanu pozostałych przełączników.

**Konfiguracja przygotowana; nie uruchomiono jeszcze w CI.** Szkice workflow pozostają poza aktywnym katalogiem Actions do podłączenia poleceń i weryfikacji szkieletu. Nie aktywuj rulesetu na podstawie samych planowanych nazw zadań.

Plik rulesetu ma `enforcement: disabled` i pustą listę obejść. Import jest wyłącznie przygotowaniem; aktywacja następuje dopiero po wykonaniu punktów poniżej. Nie dodawaj właściciela do bypass i nie włączaj automatycznego scalania.

### Ograniczenie zatwierdzania własnego PR

GitHub nie pozwala autorowi zatwierdzić własnego PR ([dokumentacja](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/reviewing-proposed-changes-in-a-pull-request), sprawdzono 2026-09-20). PR utworzony przez `gh` w tej sesji ma autora `Ipper18`, a CODEOWNERS wskazuje tę samą osobę. Obecny szablon wymaga jednego zatwierdzenia i przeglądu code ownera zgodnie z literalnym wymaganiem CONTRIBUTING § 4; przy obecnych kontach nie wolno go aktywować, bo zablokuje scalenia.

Do decyzji właściciela przed aktywacją: zatwierdzanie przez właściciela PR tworzonych przez odrębną tożsamość albo jawnie udokumentowany przegląd właściciela bez wymaganego self-approval. Drugi wariant wymaga korekty CONTRIBUTING § 4 i definicji rulesetu; nie jest wprowadzany automatycznie. Agent nie tworzy kont, nie zmienia poświadczeń i nie obchodzi przeglądu.

## 2. General i Actions

1. W Settings → General → Pull Requests pozostaw wyłącznie squash merge; ustaw tytuł commita squash na tytuł PR, zgodny z Conventional Commits. Wyłącz automatyczne scalanie.
2. W Settings → Actions → General wybierz runnery hostowane przez GitHub i dozwolone akcje według CI/CD § 2. Nie podłączaj runnera z serwera domowego.
3. Ustaw domyślne uprawnienia workflow na odczyt; wyłącz uprawnienie GitHub Actions do tworzenia i zatwierdzania PR. Własne workflow M0-1 zawierają wyłącznie `permissions: { contents: read }`.
4. Akcje muszą być przypięte pełnym SHA, a checkout mieć `persist-credentials: false`. Nie konfiguruj sekretów produkcyjnych ani kluczy SSH w repozytorium.

## 3. Security i CodeQL — po scaleniu M0-1

1. W Settings → Code security / Secret protection potwierdź secret scanning i push protection, Dependency graph, alerty Dependabot oraz private vulnerability reporting. Zapisz wynik, bez treści sekretów i identyfikatorów infrastruktury.
2. **Dopiero po scaleniu M0-1**, gdy na `main` znajdują się pliki TypeScript, Python oraz aktywne workflow, włącz albo ponownie skonfiguruj CodeQL w trybie **Default setup**. Obecna lista „tylko Python” pochodzi z etapu bez TypeScript i workflow; nie jest listą docelową.
3. W panelu sprawdź `javascript-typescript` i `python`, a następnie **sprawdź dostępność `actions`**. Zapisz dla każdego języka osobno: dostępny, wybrany, wynik analizy, data. Nie zakładaj, że `actions` można wybrać.
4. Jeśli `actions` nie występuje, wpisz „niedostępny” i opisz lukę w tabeli dowodów; nie oznaczaj pełnego pokrycia. Nie dodawaj advanced setup, własnego workflow CodeQL, tokenu z `security-events: write` ani ręcznej analizy SARIF. Zmiana przyjętego sposobu skanowania wymaga osobnej decyzji/ADR.
5. Uruchom analizę konfiguracji domyślnej i zapisz link do zakończonego przebiegu dla scalonego kodu. Sprawdź, że reguła blokuje błędy oraz alerty bezpieczeństwa high/critical. Dostępność przycisków należy sprawdzić w aktualnym panelu; [opis konfiguracji domyślnej](https://docs.github.com/en/code-security/code-scanning/enabling-code-scanning/configuring-default-setup-for-code-scanning).

## 4. Renovate

1. Właściciel instaluje aplikację Renovate wyłącznie dla tego repozytorium i przegląda jej uprawnienia. Plik `renovate.json` sam nie instaluje aplikacji.
2. Sprawdź wynik walidacji konfiguracji w PR onboardingowym. Aktualizacje zwykłe mają opóźnienie 3 dni i poniedziałkowy harmonogram; brak automerge, większe aktualizacje wymagają akceptacji w dashboardzie.
3. Zgodnie z CI/CD § 7 alerty podatności mogą utworzyć propozycję bez czekania na harmonogram. **Nie wyłącza to `minimumReleaseAge: 4320` podczas instalacji pnpm**, `trustPolicy`, kontroli skryptów ani przeglądu. Przygotowanie wcześniejszego PR nie jest wyjątkiem od karencji instalacji M0-1.
4. Reguła niestandardowa dla tarballa SheetJS będzie dodana przy pierwszym wprowadzeniu tego pakietu; szkielet M0-1 nie implementuje importów.

## 5. Ruleset main

1. Najpierw rozstrzygnij ograniczenie self-approval z § 1, potwierdź scalony M0-1 i zielone rzeczywiste przebiegi CI/CodeQL.
2. W Settings → Rules → Rulesets zaimportuj definicję JSON w stanie Disabled albo odwzoruj ją w panelu. Nie wykonuj tego za pomocą agenta. Zachowaj zakres `refs/heads/main`, brak bypass, blokadę usuwania/force-push, historię liniową, wymagany PR i rozwiązanie wątków.
3. Dla wymaganych status checks zastąp planowane nazwy dokładnymi nazwami z udanego przebiegu i wybierz GitHub Actions jako źródło tam, gdzie panel to umożliwia. Potwierdź wszystkie warianty build, także bez `education`. Włącz wymóg aktualności gałęzi.
4. Dodaj wymóg wyników skanowania CodeQL z progiem błędów i bezpieczeństwa `high_or_higher`. Plik używa natywnej reguły `code_scanning`, nie wymyślonego zadania `codeql` we własnym workflow. W razie różnic z panelem zapisz je i pozostaw ruleset nieaktywny do rozstrzygnięcia. [Kontrakt GitHub REST](https://docs.github.com/en/rest/repos/rules), sprawdzono 2026-09-20.
5. Lighthouse w M0 raportuje; nie jest jeszcze wymaganą bramką. Od M1 dodać ją do wymaganych kontroli zgodnie z dokumentacją wydajności.
6. Po sprawdzeniu wszystkich warunków ustaw Active. W kontrolnym PR potwierdź blokadę czerwonego CI oraz brak możliwości force-push/obejścia przez właściciela; nie testuj destrukcyjnego push na `main`.

## 6. Protokół właściciela

Wypełnić po scaleniu M0-1; brak potwierdzenia oznacza otwarty BL-019 i niespełnione kryterium M0 nr 7. Wynik pozytywny wymaga dowodu, nie samego odhaczenia pliku konfiguracyjnego.

| Kontrola | Wynik / data / dowód |
|---|---|
| Przegląd właściciela i rozwiązanie self-approval | do wykonania |
| Squash merge i Actions tylko do odczytu | do wykonania |
| Secret scanning i push protection | do potwierdzenia po scaleniu |
| Dependency graph i alerty Dependabot | do wykonania |
| Private vulnerability reporting | do wykonania |
| CodeQL default setup: `javascript-typescript` | do sprawdzenia po scaleniu |
| CodeQL default setup: `python` | do sprawdzenia po scaleniu |
| CodeQL default setup: dostępność `actions` | do sprawdzenia w panelu; nie zakładamy dostępności |
| Udany przebieg CodeQL i blokada high/critical | do wykonania |
| Renovate: aplikacja i poprawna konfiguracja | do wykonania |
| CODEOWNERS na `main` | do wykonania |
| Ruleset aktywny, właściwe kontrole, brak bypass | do wykonania |
