# Informacja o przetwarzaniu danych osobowych

**Cel:** podać pełną treść informacji z art. 13 RODO (wersja `2026-09`), którą użytkownik potwierdza przy rejestracji, a aplikacja publikuje pod `/prywatnosc` — zgodnie z rejestrem czynności i decyzjami z [`../06-bezpieczenstwo/prywatnosc-rodo.md`](../06-bezpieczenstwo/prywatnosc-rodo.md).

> **Dla wdrażającego:** treść poniżej linii jest źródłem pliku MDX strony `/prywatnosc`; wersja `2026-09` w `packages/contracts`. Pola `{…}` wypełnia konfiguracja (`LEGAL_CONTROLLER_NAME`, `LEGAL_CONTACT_EMAIL`). Każda zmiana celów, odbiorców lub okresów przechowywania wymaga nowej wersji, e-maila do użytkowników i aktualizacji rejestru w `prywatnosc-rodo.md` § 4. Tekst nie jest opinią prawną.

---

**Informacja o przetwarzaniu danych osobowych w OligInvest** · wersja 2026-09

## 1. Kto przetwarza Twoje dane

Administratorem Twoich danych osobowych jest {ADMINISTRATOR}, kontakt: {KONTAKT_EMAIL}. OligInvest to prywatna aplikacja działająca na serwerze administratora w Polsce. Administrator nie wyznaczył inspektora ochrony danych — we wszystkich sprawach dotyczących danych pisz na adres powyżej.

**Ważne:** administrator jest także operatorem serwera i technicznie ma dostęp do bazy danych. Aplikacja ogranicza to organizacyjnie i technicznie: panel administratora nie pokazuje danych finansowych użytkowników, nie ma funkcji logowania się jako inny użytkownik, a działania administracyjne są zapisywane w dzienniku audytu. Administrator nie przegląda Twoich danych finansowych, chyba że jest to niezbędne do usunięcia awarii albo sam o to poprosisz.

## 2. Jakie dane, w jakim celu i na jakiej podstawie

| Cel | Dane | Podstawa prawna (RODO) | Jak długo |
|---|---|---|---|
| Prowadzenie konta i logowanie | imię lub nazwa, e-mail, skrót hasła (hasła nie znamy), zaszyfrowany sekret kodów jednorazowych, zaszyfrowane kody zapasowe, sesje (adres IP, przeglądarka), tokeny dostępu (tylko skrót) | art. 6 ust. 1 lit. b — umowa (regulamin) | do usunięcia konta; sesje do wygaśnięcia (maks. 30 dni) |
| Funkcje portfela i analiz | nazwy rachunków (bez numerów), operacje, pliki importu, wyceny, dziennik, analizy, alerty, preferencje | art. 6 ust. 1 lit. b | do usunięcia konta; pliki importu 90 dni |
| Powiadomienia | adres usługi powiadomień przeglądarki i klucze subskrypcji, e-mail, dziennik doręczeń | art. 6 ust. 1 lit. b | do wyłączenia lub usunięcia konta; dziennik 180 dni |
| Bezpieczeństwo aplikacji i kont | adresy IP, identyfikator przeglądarki, zdarzenia bezpieczeństwa (np. nieudane logowania) | art. 6 ust. 1 lit. f — prawnie uzasadniony interes: ochrona usługi i kont | logi 14–30 dni; dziennik audytu 2 lata (po usunięciu konta — tylko pseudonim) |
| Diagnostyka wydajności (tylko jeśli się zgodzisz) | czasy wczytania i reakcji stron, rodzaj trasy i klasa urządzenia — bez identyfikatora konta i bez danych finansowych | art. 6 ust. 1 lit. a — zgoda | 90 dni |
| Dokumenty i zgody | wersje zaakceptowanych dokumentów, historia zgód z datami | art. 6 ust. 1 lit. b oraz lit. c w związku z art. 7 ust. 1 (wykazanie zgody) | do usunięcia konta |
| Realizacja Twoich praw | dane potrzebne do eksportu lub usunięcia; identyfikator usuniętego konta | art. 6 ust. 1 lit. c w związku z art. 15–20 | eksport 24 h; identyfikator 40 dni |
| Kopie zapasowe | wszystkie powyższe, w postaci zaszyfrowanej | jak dla danych źródłowych oraz art. 6 ust. 1 lit. f (ciągłość działania) | 35 dni |

Jeśli otrzymałeś zaproszenie, a nie założyłeś konta, Twój adres e-mail był przetwarzany wyłącznie do wysłania zaproszenia (art. 6 ust. 1 lit. f) i jest usuwany 30 dni po wygaśnięciu zaproszenia.

## 3. Czy musisz podać dane

Adres e-mail, hasło i konfiguracja kodów jednorazowych są niezbędne do założenia konta — bez nich nie możemy świadczyć usługi. Dane portfela wprowadzasz dobrowolnie; bez nich funkcje portfela nie działają. Zgoda na diagnostykę jest dobrowolna i nie wpływa na dostęp do aplikacji.

## 4. Komu przekazujemy dane

| Odbiorca | Rola | Zakres | Miejsce |
|---|---|---|---|
| Brevo (Sendinblue SAS, Francja) | wysyłka e-maili (zaproszenia, reset hasła, alerty) | adres e-mail i treść wiadomości — bez kwot portfela; logi wysyłki przechowywane 1 miesiąc | UE |
| OVHcloud | serwer pośredniczący (VPS) | metadane połączeń (adres IP, czas, nazwa usługi); ruch jest zaszyfrowany end-to-end; zaszyfrowane kopie zapasowe bez kluczy | UE |
| Usługi powiadomień Twojej przeglądarki (np. Apple, Google, Mozilla) | doręczanie powiadomień push | identyfikator subskrypcji i czas; treść zaszyfrowana i bez kwot portfela | mogą znajdować się poza Europejskim Obszarem Gospodarczym (np. w USA); przekazanie może opierać się na decyzji Komisji (UE) 2023/1795 (EU-US Data Privacy Framework) dla certyfikowanych podmiotów |

Nie sprzedajemy danych, nie używamy zewnętrznej analityki, reklam ani skryptów stron trzecich. Dostawcy danych rynkowych otrzymują wyłącznie zapytania o instrumenty, bez informacji o użytkownikach. Sprawdzanie, czy hasło nie wyciekło, wysyła tylko pierwsze 5 znaków skrótu hasła (metoda k-anonimowości) — nie jest to Twoja dana osobowa.

## 5. Pamięć urządzenia i pliki cookie

Aplikacja zapisuje w Twoim urządzeniu tylko to, co niezbędne do działania usługi, o którą prosisz, albo to, na co się zgodzisz:

| Co | Po co | Jak długo |
|---|---|---|
| ciasteczka sesji i logowania (`__Host-oliginvest.*`) | utrzymanie zalogowania i drugi etap logowania | do wylogowania lub wygaśnięcia sesji (maks. 30 dni) |
| ustawienia interfejsu w pamięci przeglądarki | np. ostatnio wybrany rachunek, zamknięte podpowiedzi — bez danych finansowych | do usunięcia |
| pamięć podręczna aplikacji zainstalowanej | szybkie uruchamianie i ekran „brak połączenia” | do aktualizacji aplikacji |
| migawka portfela offline (tylko jeśli ją włączysz w zainstalowanej aplikacji) | podgląd portfela bez sieci | maks. 30 dni; kasowana przy wylogowaniu |
| subskrypcja powiadomień (jeśli je włączysz) | alerty | do wyłączenia |

Pomiary wydajności odczytywane z przeglądarki wysyłamy wyłącznie za Twoją zgodą. Dlatego aplikacja nie potrzebuje banera cookies.

## 6. Twoje prawa

Masz prawo do: dostępu do danych i ich kopii, przeniesienia danych, sprostowania, usunięcia, ograniczenia przetwarzania, sprzeciwu wobec przetwarzania opartego na prawnie uzasadnionym interesie oraz do wycofania zgody w dowolnym momencie (bez wpływu na zgodność z prawem przetwarzania przed wycofaniem).

- **Eksport danych:** Ustawienia → Dane → „Eksportuj moje dane” (plik ZIP z danymi w formatach JSON i CSV, do pobrania przez 24 godziny).
- **Usunięcie konta:** Ustawienia → Dane → „Usuń konto”; przez 14 dni możesz anulować wniosek. Po usunięciu dane znikają z kopii zapasowych najpóźniej po 35 dniach, a dziennik audytu zachowuje tylko pseudonim.
- **Zgoda na diagnostykę:** Ustawienia → Prywatność — wycofanie działa od razu.
- **Inne prawa:** napisz na {KONTAKT_EMAIL} z adresu przypisanego do konta. Odpowiemy bez zbędnej zwłoki, najpóźniej w ciągu miesiąca.

Masz też prawo wnieść skargę do Prezesa Urzędu Ochrony Danych Osobowych (ul. Stawki 2, 00-193 Warszawa).

## 7. Decyzje automatyczne i bezpieczeństwo

Nie podejmujemy wobec Ciebie decyzji opartych wyłącznie na zautomatyzowanym przetwarzaniu ani nie profilujemy Cię. Analizy (np. symulacje) liczone są na Twoje żądanie i mają charakter informacyjny.

Dane chronimy m.in. szyfrowaniem połączeń kończonym na serwerze w Polsce, obowiązkową weryfikacją dwuetapową, izolacją danych każdego użytkownika na poziomie bazy danych, szyfrowanymi kopiami zapasowymi i dziennikiem audytu. Aplikacja nie przechowuje haseł do Twoich rachunków maklerskich.

## 8. Zmiany informacji

O zmianach tej informacji poinformujemy e-mailem i komunikatem w aplikacji. Poprzednie wersje są dostępne w Ustawienia → Prywatność.
