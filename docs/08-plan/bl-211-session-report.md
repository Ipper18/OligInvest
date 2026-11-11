# BL-211 — raport sesji

**Cel:** zapisać zakres, decyzje właściciela, przegląd zgodności i wyniki weryfikacji paczki BL-211 (preferencje
i pełne PL/EN), w tym odchylenie od pierwotnej estymaty.

**2026-11-10**, gałąź `feat/bl-211-preferences`, baza `origin/main` `797fd4a`. Implementację (commit `1db8ef9`)
wykonał Codex; zatrzymany przed weryfikacją końcową. Dokończył Claude Code nowymi commitami, bez przepisywania
historii (bez amend/rebase/force push). Niezacommitowane logi `bl-211-*.log` usunięto z drzewa. Hook sesji blokował
edycję folderu Codexa, więc commity powstały w istniejącym worktree sesji Claude Code ustawionym na `1db8ef9`
i trafiły na `feat/bl-211-preferences` jako fast-forward (bez nowego worktree).

## Decyzje właściciela

- **Zakres (2026-11-08):** preferencje z BL-211 — średni koszt jawnie jako *widok analityczny* (FIFO podatkowe bez
  zmian), dzień przychodu podatkowego, marża przewalutowania w koszcie podatkowym, strefa czasowa, język
  synchronizowany w koncie — **oraz pełne przełączanie PL/EN całej aplikacji**.
- **Odchylenie od estymaty:** backlog szacował BL-211 na 1 dzień (same preferencje). Rozszerzenie o pełne PL/EN
  (≈ 180 plików, słowniki EN dla wszystkich przestrzeni, dokumenty prawne, edukacja, onboarding, e-maile, push,
  Skróty, ekran offline) to świadoma decyzja właściciela; nakład nie był mierzony, więc odchylenia nie podajemy
  liczbowo.
- **BL-104 pozostaje otwarte:** audyt w BL-211 potwierdził bramkę regulaminu oraz `GET /me/legal`
  i `POST /me/legal/acceptances` z testami; `updateConsent` (zgoda na diagnostykę) i wycofanie zgody w UI nadal
  brakują. BL-211 tego nie domyka.
- **Do akceptacji właściciela:** angielskie brzmienie disclaimerów (`docs/11-zgodnosc-prawna.md` § 4.5), tłumaczenia
  dokumentów prawnych (`packages/i18n/src/en/legal.json`) oraz otwarte pytanie, czy dokumenty EN mają wskazywać
  wersję polską jako rozstrzygającą (❓).

## Zakres (commit Codex `1db8ef9`)

- `packages/contracts/src/preferences.ts`: wspólny Zod preferencji, częściowej zmiany (≥ 1 pole, strefa 1–64 znaki,
  sprawdzana przez `Intl`) i `costBasisContext`; API używa tych schematów.
- Średnia: `buildAverageCostView` w `packages/core` rozdziela pulę marży FX proporcjonalnie (Decimal); portfel
  liczy średnią przy odczycie tylko w widoku ekonomicznym. Widok podatkowy i partie zawsze FIFO (test równości
  odpowiedzi podatkowych z i bez średniej). Odpowiedzi pozycji, podsumowania, zrealizowanych i Skrótów mają
  addytywne, opcjonalne `costBasisContext { method, analytical }`.
- Zmiana `taxDateBasis`/`taxIncludeFxFee` publikuje przeliczenie; zmiana metody kosztu już nie (to widok przy odczycie).
- PL/EN: formatery `Intl` tworzone per locale i strefa (wejście nadal tylko string/Decimal), słowniki EN z testem
  kluczy i parametrów, cookie `oi-locale` (niesensytywne) dla stron publicznych, e-maile/alerty/push/Skróty
  w języku odbiorcy, zapisane powiadomienia historyczne bez zmian.

## Przegląd (Claude Code)

| Obszar | Wynik |
|---|---|
| CLAUDE.md (bez float, waluta jawna, mniej zależności) | OK — brak nowej zależności (`Intl` + istniejące słowniki); kwoty w JSON jako ciągi; średnia na `Decimal`; formatery odrzucają `number`. |
| MiFID / `docs/11` § 4 | Brakowało listy zakazanych zwrotów EN i powiązania disclaimerów EN z dokumentacją — **uzupełnione** (niżej). Nowe teksty EN bez trybu rozkazującego wobec instrumentów; „should” tylko w proceduralnych zdaniach regulaminu. |
| ADR-014 | OK — waluta zawsze w `Money`; marża FX w walucie puli; widok podatkowy bez zmian semantyki. |
| RLS | OK — nowe odczyty `identity.user_preferences` (`userLocale`, alerty, Skróty, odczyt portfela) w transakcjach z kontekstem użytkownika, bez `WHERE user_id` po stronie aplikacji; `mailLocale` szuka użytkownika w puli auth, a preferencje czyta przez pulę app z RLS. |
| Kontrakty addytywne | OK — `costBasisContext` opcjonalne i niewymagane w OpenAPI; `locale` w zadaniach e-mail opcjonalne (stare zadania = PL); `timezone` w PATCH zaostrzone do `minLength: 1` (pusta strefa była i tak odrzucana przez `Intl`). |
| Dokumentacja | Poprawiono numerację sekcji BL-211 w `docs/02-api/konwencje-api.md` (`### 4.4` po § 13 → `## 14.`). |

## Uzupełnienia zgodności EN

- `packages/i18n/src/compliance/forbidden-phrases.en.json`: kategorie z § 4.1 (prognozy punktowe, tryb
  rozkazujący, sygnały, rankingi, obietnice, personalizacja), m.in. „buy”, „sell”, „hold”, „price target”,
  „will reach”, „guaranteed”, „we recommend”, „you should”, „recommendation”; dopasowanie całych słów.
- `scripts/check-ui-text.mjs`: słowniki `packages/i18n/src/en/` sprawdzane listą EN **i** PL; komponenty i MDX
  bez zmian (bez literałów EN; techniczne `BUY`/`SELL` nie są tekstem UI). Hasła glosariusza adresowane kluczem
  hasła (`bb.pitfalls`), nie indeksem — wyjątek nie „przeskoczy” na inne hasło po zmianie kolejności.
- Wyjątki EN: 12 disclaimerów oraz „Pułapki” haseł `akcja`, `bb`, `cena` (objaśniają, że coś *nie jest*
  gwarantowane). Testy pilnują, że każdy wyjątek wskazuje istniejący klucz, ma uzasadnienie i dotyczy wyłącznie
  disclaimerów lub glosariusza.
- Dwa zdania EN dokumentów prawnych przeredagowano bez zmiany znaczenia, by nie wymagały wyjątku:
  „Data is never sold…” (było „We do not sell data…”), „availability is not assured” (było „…not guaranteed”).
- Liczba mnoga „recommendations” nie jest na liście — symetrycznie do PL (`rekomendacja` tylko w liczbie
  pojedynczej); występuje wyłącznie w zaprzeczeniach regulaminu i opisu kalkulatora celu.
- Disclaimery EN: dwie korekty wierności względem PL (`analysis`: „the assumptions adopted”; `data_delay`:
  „The data source and time…”); § 4.5 w `docs/11` i test równości `en/disclaimers.json` z dokumentacją.

## Weryfikacja

Lokalnie (Windows 11, Node 24.21, Docker), 2026-11-10, na `3961c56`. Bez podnoszenia progów, bez retry i bez
wydłużania timeoutów. Draft [PR #63](https://github.com/Ipper18/OligInvest/pull/63); CI Linux pozostaje warunkiem DoD.

| Kontrola | Wynik |
|---|---|
| Lint (`ci:lint`, w tym `check-ui-text` PL+EN) | PASS |
| Typecheck (`turbo typecheck --continue`) | 40/41 PASS; jedyny błąd `apps/analytics` `os.killpg` (mypy na Windows; kod z `main`, gałąź `posix`) |
| Unit (`turbo test --continue`) | 44/44 PASS. Wcześniejszy przebieg `ci:unit`: `apps/api` `server.test` readiness 3550 > 3500 ms przy pełnym równoległym obciążeniu; osobno 2/2 PASS; kod readiness nietknięty przez BL-211 — wynik zapisany, próg bez zmian |
| Skrypty, dokumentacja, repozytorium | PASS (`test:scripts`, `check:docs` 125 dok., `check:repository`) |
| Kontrakty | PASS — Redocly, 25 testów OpenAPI, implementacja vs `openapi.yaml`, typy klienta i `analytics-jobs.schema.json` aktualne; **0 różnic po regeneracji** |
| PostgreSQL + RLS (`db:test`) | 18/18 PASS; porównanie schematu: ZERO DIFFERENCES (właściciele, ACL, RLS, funkcje, wyzwalacze) |
| E2E (chromium, webkit, firefox + axe + produkcyjne API/Compose) | 205 PASS / 2 SKIP / 0 FAIL (7,1 min) |
| Budżety tras | 37/37 PASS; powłoka 29,80/30 KiB; `/portfel` 168,47/195 KiB; `/` 158,73/190 KiB |
| Lighthouse (mobile, mediana z 3) | PASS — LCP `/` **1802 ms** (zapas 198 ms; R-53 ≈ 190 ms), `/portfel` **1503 ms**, `/logowanie` 1738 ms, `/rynek/[id]` 1503 ms; TBT ≤ 39 ms; CLS 0 |
| Secret grep (CLAUDE.md) | 0 trafień w liniach dodanych przez gałąź; 4 trafienia w całym repo to istniejące syntetyczne fixture'y testów |

**Lighthouse — przyczyna i poprawka.** Pierwszy pomiar kończył się `LH_NAVIGATION_MISMATCH`: `/`, `/portfel`
i `/rynek/[id]` lądowały na `/logowanie`. Diagnoza (Playwright + CDP): gdy słoik cookies ma jakiekolwiek cookie
dla originu, Chrome zastępuje nagłówek `Cookie` podany przez CDP `extraHeaders` nagłówkiem ze słoika. BL-211 ustawia
niesensytywne `oi-locale` przy pierwszej prywatnej odpowiedzi, więc kolejne przebiegi traciły sesję fixture'a.
Użytkownicy i e2e nie są dotknięci (sesja jest w słoiku obok `oi-locale`). Poprawka w harnessie: słoik czyszczony
per trasa, a cookies fixture'a wpisywane do słoika (`Storage.setCookies`); test jednostkowy parsera cookies.
Progi, liczba przebiegów i timeouty bez zmian (`docs/04-frontend/wydajnosc.md` § Lighthouse).

## Otwarte

- Akceptacja właściciela: tłumaczenia prawne i disclaimery EN (§ 4.5), rozstrzygająca wersja językowa (❓).
- BL-104: `updateConsent` i wycofanie zgody w UI (brama B).
- Bez nowego ADR, zależności ani ryzyka; R-11/R-16 doprecyzowane przez Codex w `ryzyka.md`, oceny bez zmian.
