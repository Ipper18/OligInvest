# Regulamin OligInvest

**Cel:** podać pełną treść regulaminu usługi OligInvest (wersja `2026-09`), którą użytkownik akceptuje przy rejestracji, a aplikacja publikuje pod `/regulamin` — zgodnie z art. 8 ustawy o świadczeniu usług drogą elektroniczną i zasadami z [`../11-zgodnosc-prawna.md`](../11-zgodnosc-prawna.md).

> **Dla wdrażającego:** treść poniżej linii jest źródłem pliku MDX w `apps/web` (strona `/regulamin`); wersja w `packages/contracts` = `2026-09`. Pola `{…}` wypełnia konfiguracja instancji (`LEGAL_CONTROLLER_NAME`, `LEGAL_CONTACT_EMAIL`, data wejścia w życie). Istotna zmiana treści = nowa wersja, e-mail do użytkowników co najmniej 14 dni wcześniej i bramka ponownej akceptacji ([`../06-bezpieczenstwo/prywatnosc-rodo.md`](../06-bezpieczenstwo/prywatnosc-rodo.md) § 5.1). Tekst nie jest opinią prawną ([`../10-ograniczenia.md`](../10-ograniczenia.md), L-42).

---

**Regulamin usługi OligInvest** · wersja 2026-09 · obowiązuje od {DATA_WEJSCIA_W_ZYCIE}

## § 1. Postanowienia ogólne

1. Regulamin określa zasady korzystania z aplikacji internetowej OligInvest dostępnej pod adresem `https://invest.oligi.pl` („Aplikacja”).
2. Usługodawcą jest {ADMINISTRATOR}, kontakt: {KONTAKT_EMAIL} („Usługodawca”). Usługodawca udostępnia Aplikację prywatnie i nieodpłatnie, poza działalnością gospodarczą.
3. Z Aplikacji może korzystać wyłącznie osoba pełnoletnia, która otrzymała od Usługodawcy zaproszenie i założyła konto („Użytkownik”).
4. Informacja o przetwarzaniu danych osobowych jest dostępna pod adresem `/prywatnosc`.

## § 2. Zakres usług

1. Aplikacja umożliwia w szczególności:
   1. prowadzenie ewidencji rachunków inwestycyjnych i operacji — ręcznie albo przez import plików wyeksportowanych od brokera;
   2. wycenę portfela na podstawie notowań opóźnionych lub z zamknięcia sesji oraz kursów walut;
   3. obliczanie wyników historycznych, w tym zysku lub straty w widoku ekonomicznym i informacyjnym widoku podatkowym;
   4. przeglądanie notowań, wykresów i wskaźników technicznych;
   5. analizy scenariuszowe i symulacje prezentowane jako rozkłady wyników przy jawnych założeniach;
   6. alerty o spełnieniu warunków ustawionych przez Użytkownika, materiały edukacyjne i tryb demonstracyjny.
2. **Aplikacja ma charakter wyłącznie informacyjny i edukacyjny.** Nie świadczy doradztwa inwestycyjnego ani podatkowego, nie formułuje rekomendacji inwestycyjnych, nie przyjmuje ani nie przekazuje zleceń i nie łączy się z rachunkami maklerskimi w trybie umożliwiającym zawieranie transakcji. Wyniki analiz nie są prognozą ani zaleceniem. Decyzje inwestycyjne Użytkownik podejmuje samodzielnie i na własne ryzyko.
3. Notowania i inne dane rynkowe pochodzą od podmiotów trzecich, mogą być opóźnione, niepełne lub błędne. Aplikacja pokazuje źródło i czas danych przy każdej wartości; lista źródeł i ich warunków jest dostępna pod adresem `/zrodla-danych`.
4. Widok podatkowy jest pomocniczy i może różnić się od informacji od brokera (np. PIT-8C) i od zeznania podatkowego.

## § 3. Wymagania techniczne

1. Do korzystania z Aplikacji potrzebne są: urządzenie z dostępem do internetu, aktualna przeglądarka (Safari lub Chrome na iOS 17 i nowszym, Chrome na Androidzie, Chrome, Edge, Firefox lub Safari na komputerze) z włączoną obsługą JavaScript i plików cookie niezbędnych do logowania, adres e-mail oraz aplikacja generująca kody jednorazowe (TOTP).
2. Niektóre funkcje (powiadomienia push na iPhonie, instalacja na ekranie początkowym, Skróty) wymagają dodatkowych kroków opisanych w instrukcji użytkownika.

## § 4. Konto

1. Umowa o świadczenie usługi zostaje zawarta z chwilą założenia konta: rejestracji z ważnego zaproszenia, akceptacji Regulaminu i potwierdzenia zapoznania się z informacją o przetwarzaniu danych.
2. Logowanie wymaga hasła i kodu jednorazowego (weryfikacja dwuetapowa jest obowiązkowa). Użytkownik zapisuje kody zapasowe w bezpiecznym miejscu.
3. Użytkownik zobowiązuje się:
   1. chronić hasło, kody zapasowe, urządzenie z aplikacją TOTP i tokeny dostępu (np. używane w Skrótach) przed dostępem osób trzecich i nie udostępniać konta innym osobom;
   2. niezwłocznie powiadomić Usługodawcę o podejrzeniu nieuprawnionego dostępu do konta;
   3. nie podejmować działań, które mogą zakłócić działanie Aplikacji lub naruszyć jej zabezpieczenia, w tym prób dostępu do danych innych Użytkowników;
   4. nie dostarczać treści o charakterze bezprawnym i importować wyłącznie własne dane albo dane, do których ma prawo;
   5. nie publikować ani nie udostępniać dalej danych rynkowych pozyskanych z Aplikacji — dostawcy danych udzielają licencji wyłącznie na użytek osobisty.
4. Usługodawca może zablokować konto, jeżeli Użytkownik narusza ust. 3 albo gdy wymaga tego bezpieczeństwo Aplikacji lub innych Użytkowników, informując o tym Użytkownika e-mailem.

## § 5. Dostępność Aplikacji

1. Aplikacja działa na prywatnym serwerze Usługodawcy. Usługodawca dokłada starań, aby była dostępna, ale nie gwarantuje ciągłości działania. Przerwy mogą wynikać z prac serwisowych, awarii zasilania, łącza lub sprzętu.
2. Usługodawca wykonuje kopie zapasowe, ale Użytkownik powinien przechowywać oryginalne pliki od brokera i może w każdej chwili wyeksportować swoje dane.
3. Usługodawca może rozwijać Aplikację, zmieniać i wyłączać jej funkcje.

## § 6. Odpowiedzialność

1. Usługodawca nie odpowiada za decyzje inwestycyjne i ich skutki, za treść i opóźnienia danych dostarczanych przez podmioty trzecie ani za szkody wynikłe z udostępnienia danych logowania przez Użytkownika.
2. Ograniczenia z ust. 1 nie dotyczą szkód wyrządzonych umyślnie ani przypadków, w których prawo nie pozwala wyłączyć lub ograniczyć odpowiedzialności. Regulamin nie wyłącza praw, których nie można wyłączyć w drodze umowy.

## § 7. Reklamacje i kontakt

1. Reklamacje i pytania należy kierować na adres {KONTAKT_EMAIL}. Reklamacja powinna zawierać opis problemu i adres e-mail konta.
2. Usługodawca odpowiada na reklamację e-mailem w terminie 14 dni od jej otrzymania.

## § 8. Rozwiązanie umowy

1. Użytkownik może w każdej chwili rozwiązać umowę, składając w ustawieniach konta wniosek o usunięcie konta. Konto i dane zostają usunięte po 14 dniach, w których wniosek można anulować; przed złożeniem wniosku Użytkownik może wyeksportować swoje dane.
2. Usługodawca może rozwiązać umowę z zachowaniem 30-dniowego okresu wypowiedzenia, przekazanego e-mailem, a w przypadku rażącego naruszenia § 4 ust. 3 — ze skutkiem natychmiastowym.
3. Po rozwiązaniu umowy dane są usuwane zgodnie z informacją o przetwarzaniu danych; kopie zapasowe wygasają najpóźniej po 35 dniach.

## § 9. Zmiany Regulaminu

1. Usługodawca może zmienić Regulamin z ważnych przyczyn, w szczególności zmiany przepisów, zakresu usług lub wymogów bezpieczeństwa.
2. O zmianie Usługodawca informuje e-mailem co najmniej 14 dni przed jej wejściem w życie, chyba że zmianę wymusza prawo lub bezpieczeństwo. Po wejściu zmiany w życie Aplikacja prosi o akceptację nowej wersji przy logowaniu; brak akceptacji oznacza możliwość korzystania wyłącznie z wylogowania, eksportu danych i usunięcia konta.
3. Aktualna i poprzednie wersje Regulaminu są dostępne w Aplikacji; Regulamin można pobrać i wydrukować.

## § 10. Postanowienia końcowe

1. W sprawach nieuregulowanych stosuje się prawo polskie.
2. Spory rozstrzyga sąd właściwy według przepisów ogólnych.
