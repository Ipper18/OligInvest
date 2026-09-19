# Polityka bezpieczeństwa

**Cel:** wyjaśnić, jak zgłaszać podatności w OligInvest, jakie wersje są wspierane i czego oczekujemy od osób zgłaszających — zgodnie z decyzją o publicznym repozytorium ([ADR-013](docs/09-decyzje/ADR-013-repozytorium-publiczne.md)).

## Zgłaszanie podatności

- **Nie zakładaj publicznego issue** ani dyskusji z opisem podatności.
- Zgłoś ją prywatnie przez GitHub: zakładka **Security → Report a vulnerability** (prywatne zgłaszanie podatności w tym repozytorium).
- W zgłoszeniu podaj: opis i wpływ, wersję lub commit, kroki odtworzenia (najlepiej na lokalnej instancji), ewentualny dowód koncepcji i propozycję poprawki.
- Dotyczy także przypadkowo opublikowanych sekretów lub danych — zgłoś je tą samą drogą.

## Czego się spodziewać

OligInvest to prywatny projekt jednej osoby, bez programu nagród.

| Etap | Termin |
|---|---|
| Potwierdzenie otrzymania | do 7 dni |
| Wstępna ocena i plan | do 14 dni |
| Poprawka | według powagi: krytyczna do 72 h, wysoka do 7 dni, średnia do 30 dni, niska do 90 dni od potwierdzenia ([`docs/06-bezpieczenstwo/kontrole-bezpieczenstwa.md`](docs/06-bezpieczenstwo/kontrole-bezpieczenstwa.md) § 4.2) |
| Ujawnienie | po wdrożeniu poprawki, w uzgodnieniu ze zgłaszającym (GitHub Security Advisory) |

## Zasady dla badaczy

- Testuj na **własnej, lokalnej** instancji zbudowanej z tego repozytorium. Instancja produkcyjna służy kilku prywatnym użytkownikom — nie wykonuj na niej skanów, testów obciążeniowych, prób logowania ani ataków socjotechnicznych.
- Nie uzyskuj dostępu do cudzych danych, nie modyfikuj ich i nie zatrzymuj usług. Jeśli przypadkiem zobaczysz dane innej osoby — przerwij i zgłoś.
- Działając w dobrej wierze i zgodnie z tymi zasadami, możesz liczyć na współpracę przy wyjaśnieniu i poprawce.

## Wspierane wersje

Poprawki bezpieczeństwa trafiają do najnowszego wydania z gałęzi `main`. Starsze wersje nie są wspierane.

## Jak dbamy o bezpieczeństwo

Model zagrożeń, mapowanie OWASP ASVS 5.0 L1+L2, plan reagowania i zasady łańcucha dostaw: [`docs/06-bezpieczenstwo/`](docs/06-bezpieczenstwo/kontrole-bezpieczenstwa.md). W repozytorium włączone są skanowanie sekretów z blokadą wypchnięcia, CodeQL, alerty Dependabot, Renovate i prywatne zgłaszanie podatności; obrazy kontenerów są podpisywane (cosign) i mają SBOM.
