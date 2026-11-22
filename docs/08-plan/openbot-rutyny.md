# Rutyny agentów OpenBot

**Cel:** zdefiniować cykliczne zadania agentów OpenBot dla OligInvest — harmonogram, tryb pracy i treść do wklejenia — tak, aby właściciel dostawał krótkie, sprawdzalne raporty bez zużywania limitów na pracę, której nikt nie zlecił.

Powiązane: [`orkiestracja-agentow.md`](orkiestracja-agentow.md) § 7, [`openbot-agenci.md`](openbot-agenci.md), [`../../AGENTS.md`](../../AGENTS.md) § 6.1.

## 1. Zasady

- Rutyna to jedna instrukcja i harmonogram; wynik trafia do wątku agenta ([OpenBot 101](https://openbot.run/guides/openbot-101), sprawdzono 2026-10-24).
- **„Brak zmian.” jest poprawnym wynikiem** — bez tego agent wymyśla treść, żeby coś zgłosić.
- R1 i R4 czytają stan. R2 uzgadnia kolejkę i może przydzielić kartę, R3 komentuje PR zależności, R5 przygotowuje PR dokumentacyjny. Scalanie należy do właściciela.
- CI i PR sprawdzane jednym wywołaniem na przebieg — bez pętli odpytywania ([`AGENTS.md`](../../AGENTS.md) § 6.1).
- Wynik ≤ 10 linii; szczegóły w PR albo w `~/OpenBot/Shared/oliginvest/`.
- Godziny w czasie lokalnym stacji (Europe/Warsaw) — **NIEZWERYFIKOWANE**, czy OpenBot przyjmuje strefę systemu.

| ID | Rutyna | Agent | Harmonogram | Tryb |
|---|---|---|---|---|
| R1 | Poranny stan CI i PR | Dyspozytor | pn–pt 08:00 | odczyt |
| R2 | Kontrola scaleń | Dyspozytor | pn–pt 18:00 | uzgodnienie stanu i karty |
| R3 | Triage zależności | Weryfikator | pn 09:00 | komentarze w PR Renovate |
| R4 | Zgodność backlogu z kodem | Dyspozytor | pt 15:00 | odczyt |
| R5 | Weryfikacja znaczników i audyt skilli | Weryfikator | pierwszy pn miesiąca 10:00 | PR z `docs/` |

## 2. R1 — poranny stan CI i PR

```text
Rutyna R1 (poranny stan). Tylko odczyt.
1. W ./OligInvest: git fetch origin.
2. gh run list --branch main --limit 3 — stan ostatnich przebiegów na main.
3. gh pr list --state open — dla każdego PR jedno wywołanie gh pr checks <nr> (bez czekania i bez ponawiania).
4. Porównaj z ~/OpenBot/Shared/oliginvest/stan.md: karty w toku i PR czekające na właściciela.
Wynik (≤ 10 linii): main zielony/czerwony (nazwa nieudanego joba), PR czekające na właściciela,
PR z czerwonym CI i kto je prowadzi, karty bez ruchu > 2 dni robocze.
Jeśli od wczoraj nic się nie zmieniło i wszystko jest zielone — odpowiedz tylko: „Brak zmian.”
```

## 3. R2 — kontrola scaleń

R2 wznawia oczekującą kontrolę CI lub odtwarza przejście po scaleniu, gdy Dyspozytor nie obsłużył go wcześniej. Wspólna tożsamość GitHub wymaga sprawdzenia śladu przeglądu (R-42).

```text
Porównaj aktywną kartę w stan.md ze stanem PR i mergedAt w GitHubie, także po przerwie dłuższej niż doba. Dla MERGED sprawdź SHA ocen Recenzenta i Weryfikatora, wymagane CI oraz zapis przeglądu właściciela. Niewyjaśnione scalenie lub brak dowodu zgłoś jako STOP.
Dla otwartego PR na etapie oczekiwania na CI uzgodnij head SHA z kartą. Po zmianie SHA odrzuć stare oceny, zachowując licznik rund. Przy czynnej kolejce zleć Recenzentowi sprawdzenie CI dla bieżącego SHA tylko wtedy, gdy brak aktywnego przydziału o tym samym operationId. Zapisz przydział w stan.md. Przy pending zakończ przebieg. Wznów po zdarzeniu lub następnym R2, bez odpytywania w pętli i bez blokowania Budowniczego.
Zapisz potwierdzone zakończenie scalenia. Jeżeli kolejka jest czynna, sprawdź zależności, rezerwacje i limit WIP według orkiestracja-agentow.md § 4–5. Przydziel następną gotową kartę tylko raz. Przy istniejącej karcie wznów jej pierwszy niezakończony krok. Brak zmiany stanu nie wymaga wiadomości.
```

## 4. R3 — triage zależności

```text
Rutyna R3 (triage zależności). Możesz komentować tylko PR-y Renovate.
1. gh pr list --state open --author app/renovate
2. Dla każdego PR bez Twojego komentarza z bieżącą wersją: notatki wydania między wersjami
   (oficjalne źródło), zmiany łamiące, licencja z listy AGENTS.md § 5.8, minimumReleaseAge,
   nowe skrypty instalacyjne, wynik deps-audit w gh pr checks.
3. Komentarz w PR: „[Weryfikator · OpenBot] Ryzyko: niskie/średnie/wysokie — <powód>; zmiany łamiące:
   <tak/nie, gdzie>; licencja: <id>”. Nigdy nie scalaj i nie zamykaj PR.
Wynik w wątku: lista PR z oceną ryzyka; pilne poprawki bezpieczeństwa na górze.
Brak nowych PR Renovate — odpowiedz tylko: „Brak zmian.”
```

## 5. R4 — zgodność backlogu z kodem

Lekka, cotygodniowa wersja promptu kontroli końca etapu ([`prompty-codex.md`](prompty-codex.md) § 5).

```text
Rutyna R4 (zgodność backlogu). Tylko odczyt — niczego nie poprawiaj.
1. git fetch origin; PR scalone w ostatnich 7 dniach: gh pr list --state merged --search "merged:>=<data>".
2. Dla zadań BL-xxx wymienionych w tych PR sprawdź status w docs/08-plan/backlog.md (tylko ich wiersze).
3. Dodatkowo: zadania „w toku”, których PR jest scalony, a CI na main zielone — kandydaci do „gotowe”;
   zadania „todo”, które mają scalony PR — rozbieżność.
Wynik: tabela „zadanie | status w backlogu | stan faktyczny | proponowana zmiana”, najwyżej 15 wierszy,
reszta liczbowo. Zmiany statusów wykona Budowniczy w PR z karty Dyspozytora.
Brak rozbieżności — odpowiedz tylko: „Brak zmian.”
```

## 6. R5 — weryfikacja znaczników i audyt skilli

```text
Rutyna R5 (weryfikacja miesięczna). Wolno Ci utworzyć jeden PR wyłącznie z plikami w docs/.
1. git grep -n NIEZWERYFIKOWANE -- docs — policz znaczniki; wybierz najwyżej 10 najstarszych
   (git log -1 --format=%cs -- <plik>) i zweryfikuj je według swojej instrukcji roli.
2. git log -1 --format=%cs -- .claude/skills porównaj z datą audytu w
   docs/09-decyzje/audyt-pluginow.md; jeśli skille zmieniły się później — kontrole z CONTRIBUTING.md § 7.
3. PR docs/verify-<RRRR-MM-DD>: potwierdzone fakty z linkiem i datą; różnice wymagające decyzji
   opisane w PR jako STOP, bez zmiany wartości.
Wynik w wątku: liczba znaczników przed/po, link do PR, lista STOP.
Nic do zweryfikowania — odpowiedz tylko: „Brak zmian.”
```
