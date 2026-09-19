# Prywatność i RODO

**Cel:** ustalić, na jakiej podstawie prawnej OligInvest przetwarza dane osobowe, jakie dokumenty i zgody zbiera przy rejestracji i jak je wersjonuje, jak długo przechowuje dane, jak realizuje prawa użytkowników, komu dane przekazuje i jak postępuje przy naruszeniu — tak, aby prywatna aplikacja dla kilku osób działała legalnie od pierwszego dnia (FR-07.09, FR-07.12, NFR-11.01–NFR-11.03).

Powiązane: [`kontrole-bezpieczenstwa.md`](kontrole-bezpieczenstwa.md), [`plan-reagowania.md`](plan-reagowania.md) § 7, [`model-zagrozen.md`](model-zagrozen.md), [`../03-dane/model-danych.md`](../03-dane/model-danych.md) § 4, [`../03-dane/schema.sql`](../03-dane/schema.sql) (`identity.consent_events`, `platform.erasure_log`), [`../02-api/openapi.yaml`](../02-api/openapi.yaml) (`/me/legal*`, `/me/exports`, `/me/deletion-request`), [`../07-wdrozenie/backup-dr.md`](../07-wdrozenie/backup-dr.md), `11-zgodnosc-prawna.md` (Krok 6: MiFID II, licencje danych).

> Dokument jest projektem technicznym i organizacyjnym przygotowanym bez udziału prawnika — nie jest opinią prawną. Przed udostępnieniem aplikacji innym osobom właściciel powinien przeczytać szablony z § 11 i w razie wątpliwości skonsultować je z prawnikiem.

Podstawy prawne: [RODO — rozporządzenie (UE) 2016/679](https://eur-lex.europa.eu/eli/reg/2016/679/oj), ustawa z 12 lipca 2024 r. — Prawo komunikacji elektronicznej (art. 399: przechowywanie informacji i dostęp do nich w urządzeniu końcowym), ustawa z 18 lipca 2002 r. o świadczeniu usług drogą elektroniczną (art. 8: regulamin), [wytyczne EROD 2/2023 dot. zakresu art. 5 ust. 3 dyrektywy ePrivacy](https://www.edpb.europa.eu/system/files/2024-10/edpb_guidelines_202302_technical_scope_art_53_eprivacydirective_v2_en_0.pdf) (wersja 2.0 z 7.10.2024). Stan sprawdzony 2026-09-19.

## 1. Decyzja właściciela

Właściciel zaakceptował w Kroku 4 (2026-09-19): eksport danych RODO bez hasła do archiwum (jednorazowe pobranie w ciągu 24 h po step-upie), powiadomienia bez kwot na ekranie blokady oraz zasadę, że aplikacja ma działać legalnie, a zgody zbierane są przy rejestracji. Ten dokument realizuje tę zasadę: **regulamin i informacja o przetwarzaniu danych przy rejestracji, zgody tylko tam, gdzie prawo ich wymaga, i żadnych banerów cookies, bo aplikacja ich nie potrzebuje** (§ 5).

## 2. Czy RODO ma zastosowanie

- Art. 2 ust. 2 lit. c RODO wyłącza przetwarzanie przez osobę fizyczną w ramach czynności o czysto osobistym lub domowym charakterze.
- Motyw 18 RODO dodaje jednak, że rozporządzenie stosuje się do administratorów lub podmiotów przetwarzających, którzy **zapewniają środki** przetwarzania danych osobowych do takich osobistych lub domowych celów.
- Właściciel udostępnia aplikację innym osobom i przetwarza ich dane (e-maile, dane finansowe), więc powołanie się na wyłączenie domowe byłoby wątpliwe.

**Decyzja:** OligInvest stosuje RODO w całości, tak jakby wyłączenie nie działało. Koszt jest niewielki (dokumenty, kilka funkcji już zaprojektowanych), a znika ryzyko sporu o zakres wyłączenia.

## 3. Role

| Rola | Kto | Uwagi |
|---|---|---|
| Administrator danych | właściciel instancji (osoba fizyczna) | nazwa i adres kontaktowy wstawiane z konfiguracji (`LEGAL_CONTROLLER_NAME`, `LEGAL_CONTACT_EMAIL`), **nie w repozytorium publicznym** |
| Inspektor ochrony danych | nie jest wymagany (brak przetwarzania na dużą skalę i monitorowania osób) | kontakt w sprawach danych — adres administratora |
| Podmioty przetwarzające | Brevo (e-mail), OVHcloud (VPS: przekazywanie zaszyfrowanego ruchu, zaszyfrowane kopie) | § 8 |
| Osoby, których dane dotyczą | użytkownicy (właściciel i zaproszone osoby), osoby zapraszane | usługa dla dorosłych; zaproszenia tylko dla pełnoletnich |

**Przejrzystość wobec użytkowników:** administrator jest też operatorem serwera i technicznie ma dostęp do bazy danych. Aplikacja ogranicza to organizacyjnie i technicznie (panel admina bez danych finansowych, brak impersonacji, audyt — [`model-zagrozen.md`](model-zagrozen.md) T-AD-02), a informacja o przetwarzaniu mówi o tym wprost (§ 11.1). Zaproszone osoby powinny o tym wiedzieć, zanim wprowadzą swoje dane.

## 4. Czynności przetwarzania (art. 30 RODO)

Rejestr prowadzimy dobrowolnie — zwolnienie z art. 30 ust. 5 nie obejmuje przetwarzania stałego, a rejestr i tak porządkuje decyzje.

| Czynność | Cel | Dane | Podstawa prawna | Odbiorcy | Retencja |
|---|---|---|---|---|---|
| Konto i logowanie | świadczenie usługi, bezpieczeństwo kont | nazwa, e-mail, skrót hasła, sekret TOTP (zaszyfrowany), sesje (IP, przeglądarka), tokeny PAT (skróty) | art. 6 ust. 1 lit. b (umowa — regulamin) | Brevo (e-maile systemowe) | do usunięcia konta; sesje do wygaśnięcia |
| Zaproszenia | umożliwienie rejestracji osobie, która o nią prosiła | e-mail, rola, autor zaproszenia | art. 6 ust. 1 lit. f (prawnie uzasadniony interes); informacja z art. 14 w e-mailu | Brevo | 72 h ważności; niewykorzystane usuwane 30 dni po wygaśnięciu |
| Funkcje portfela i analiz | świadczenie usługi | rachunki (etykiety), operacje, pliki importu, wyceny, dziennik, analizy, alerty, preferencje | art. 6 ust. 1 lit. b | brak (powiadomienia bez kwot) | do usunięcia konta; pliki importu 90 dni |
| Powiadomienia | alerty wybrane przez użytkownika | subskrypcje push (adres usługi, klucze), e-mail, dziennik doręczeń | art. 6 ust. 1 lit. b | Brevo, usługi Web Push | do wyłączenia lub usunięcia konta; dziennik 180 dni |
| Bezpieczeństwo i audyt | ochrona usługi i kont, rozliczalność | adresy IP, identyfikator przeglądarki, zdarzenia bezpieczeństwa, pseudonim | art. 6 ust. 1 lit. f (bezpieczeństwo sieci — motyw 49) | OVHcloud (metadane połączeń na VPS) | logi 14–30 dni; audyt 2 lata |
| Diagnostyka wydajności (RUM) | poprawa szybkości aplikacji | metryki wydajności, wzorzec trasy, klasa urządzenia (zapis bez identyfikatora osoby) | **zgoda** — art. 6 ust. 1 lit. a RODO i art. 399 Prawa komunikacji elektronicznej | brak | 90 dni |
| Dokumenty i zgody | zawarcie umowy, wykazanie zgody | wersje dokumentów, zdarzenia akceptacji i zgód, czas | art. 6 ust. 1 lit. b (regulamin), lit. c w zw. z art. 7 ust. 1 i art. 5 ust. 2 (wykazanie zgody) | brak | do usunięcia konta |
| Realizacja praw | eksport, usunięcie, sprostowanie | dane konta; archiwum eksportu; UUID usuniętego konta | art. 6 ust. 1 lit. c w zw. z art. 15–20 | brak | eksport 24 h; `erasure_log` 40 dni |
| Kopie zapasowe | ciągłość działania, odtworzenie po awarii | wszystkie powyższe (zaszyfrowane) | jak dla danych źródłowych + art. 6 ust. 1 lit. f | OVHcloud (zaszyfrowane kopie, bez kluczy) | 35 dni |

**Profilowanie i decyzje automatyczne (art. 22):** brak. Analizy (Monte Carlo, optymalizacja, backtest) liczy się na żądanie użytkownika i są materiałem informacyjnym — nie wywołują skutków prawnych ani podobnie istotnych.

## 5. Dokumenty, zgody i przechowywanie w urządzeniu (FR-07.12)

### 5.1 Co użytkownik akceptuje i kiedy

| Dokument | Charakter | Kiedy | Zapis |
|---|---|---|---|
| **Regulamin** (art. 8 ustawy o świadczeniu usług drogą elektroniczną) | warunek zawarcia umowy o świadczenie usługi | rejestracja — pole wymagane; po istotnej zmianie — bramka `TERMS_ACCEPTANCE_REQUIRED` | `consent_events`: `terms`, `accepted` |
| **Informacja o przetwarzaniu danych** (art. 13 RODO) | obowiązek informacyjny — potwierdzenie zapoznania się, **nie zgoda** | rejestracja; po zmianie — baner i e-mail (bez blokowania) | `privacy_notice`, `acknowledged` |
| **Zgoda na diagnostykę** (art. 6 ust. 1 lit. a RODO, art. 399 PKE) | dobrowolna, osobna, pole domyślnie niezaznaczone | rejestracja lub w dowolnym momencie w ustawieniach; wycofanie jednym przełącznikiem | `diagnostics`, `granted` / `withdrawn` |

Zasady (art. 7 RODO): zgoda nie jest warunkiem korzystania z aplikacji; jest oddzielona od regulaminu; jej wycofanie jest tak samo proste jak udzielenie i działa od następnego żądania; każda zgoda ma wersję treści, a zmiana treści oznacza ponowne pytanie (do czasu odpowiedzi — brak zgody). Historia zdarzeń jest append-only (dowód z art. 7 ust. 1) i trafia do eksportu RODO.

**Wersje dokumentów:** stałe w `packages/contracts` (np. `2026-09`), treści w `apps/web` (MDX) pod `/regulamin` i `/prywatnosc` — publiczne, z datą obowiązywania, do wydruku i zapisu (wymóg udostępnienia regulaminu przed zawarciem umowy w formie umożliwiającej jego pozyskanie, odtwarzanie i utrwalanie). Zmiana regulaminu: e-mail do użytkowników co najmniej 14 dni przed wejściem w życie (chyba że zmianę wymusza prawo lub bezpieczeństwo); brak akceptacji = możliwość usunięcia konta.

### 5.2 Ciasteczka i pamięć urządzenia — inwentarz

| Element | Rodzaj | Cel | Czas | Podstawa |
|---|---|---|---|---|
| `__Host-oliginvest.session_token` | ciasteczko | utrzymanie sesji po zalogowaniu | 7 dni (przedłużane) lub do zamknięcia przeglądarki | niezbędne do świadczenia usługi żądanej przez użytkownika |
| `__Host-oliginvest.dont_remember`, `__Host-oliginvest.two_factor` | ciasteczka | stan logowania i drugiego czynnika | do końca logowania lub sesji | niezbędne |
| `localStorage` z kluczami `oliginvest.ui.*` | pamięć lokalna | ustawienia interfejsu wybrane przez użytkownika (np. ostatni rachunek, zamknięte podpowiedzi) — bez danych finansowych | do usunięcia | niezbędne — personalizacja na żądanie |
| Cache service workera | Cache Storage | zasoby statyczne i strona offline aplikacji zainstalowanej | do aktualizacji wersji | niezbędne do działania PWA |
| IndexedDB `oliginvest-offline` | baza w przeglądarce | migawka portfela do podglądu bez sieci (FR-09.02) | ≤ 30 dni, kasowana przy wylogowaniu | wyraźne żądanie użytkownika (pytanie w zainstalowanej aplikacji) |
| Subskrypcja powiadomień | PushManager przeglądarki | alerty | do wyłączenia | żądanie użytkownika + zgoda przeglądarki |
| Pomiary wydajności (RUM) | odczyt metryk przez skrypt, bez zapisu w urządzeniu | diagnostyka | — | **zgoda** (EROD 2/2023: art. 5 ust. 3 obejmuje także pobieranie informacji z urządzenia skryptem) |

**Dlaczego bez banera cookies:** strony publiczne (logowanie, regulamin, informacja o danych) używają wyłącznie mechanizmów niezbędnych; jedyna zgoda (diagnostyka) jest zbierana przy rejestracji i w ustawieniach. Brak analityki zewnętrznej, reklam, pikseli i skryptów stron trzecich (NFR-11.01, CSP blokuje domeny trzecie).

## 6. Retencja (NFR-11.02)

| Dane | Okres | Mechanizm |
|---|---|---|
| Konto, portfel, dziennik, analizy, alerty, preferencje, zgody | do usunięcia konta (14 dni karencji po wniosku) | usunięcie kaskadowe |
| Pliki importu | 90 dni | zadanie codzienne |
| Wiersze importu | 1 rok po zatwierdzeniu | zadanie codzienne |
| Archiwa eksportu RODO | 24 h lub do pierwszego pobrania | zadanie codzienne |
| Sesje | do wygaśnięcia (maks. 30 dni) lub wylogowania | Better Auth + zadanie czyszczące |
| Zaproszenia niewykorzystane | 30 dni po wygaśnięciu | zadanie codzienne |
| Dziennik doręczeń powiadomień | 180 dni | zadanie codzienne |
| Pomiary RUM | 90 dni | zadanie codzienne |
| Logi aplikacji, Caddy, PostgreSQL | 14 dni | rotacja logów |
| Logi VPS (nginx `stream`) | 14 dni | logrotate |
| Logi SSH i systemu, alerty CrowdSec | 30 dni | journald, konfiguracja CrowdSec |
| **Audyt (`platform.audit_log`)** | **2 lata** — rozliczalność działań administracyjnych i wyjaśnianie incydentów; po usunięciu konta tylko pseudonim (Z-21) | partycjonowanie i usuwanie najstarszych miesięcy |
| `platform.erasure_log` | 40 dni (dłużej niż najdłuższa retencja kopii) | zadanie po `purge_after` |
| Kopie zapasowe | 35 dni (lokalnie i poza domem) | [`../07-wdrozenie/backup-dr.md`](../07-wdrozenie/backup-dr.md) |
| Dane u Brevo (logi wysyłki) | wg zasad Brevo (NIEZWERYFIKOWANE — sprawdzić w panelu i DPA przed M1) | — |

## 7. Prawa użytkowników (art. 12–22)

| Prawo | Realizacja | Termin |
|---|---|---|
| Dostęp i przenoszenie (art. 15, 20) | eksport wszystkich danych (JSON + CSV w ZIP) z ustawień — obejmuje każdą tabelę z `user_id`, w tym historię zgód; jednorazowe pobranie w ciągu 24 h po step-upie | natychmiast (w tle, minuty) |
| Sprostowanie (art. 16) | edycja danych w aplikacji; adres e-mail zmienia administrator na prośbę | do 7 dni |
| Usunięcie (art. 17) | wniosek w ustawieniach (step-up) → 14 dni na anulowanie → usunięcie kaskadowe, tokeny i sesje unieważnione; UUID trafia do `erasure_log` i do pliku poza bazą, a po każdym odtworzeniu kopii procedura ponownie usuwa konto ([`../07-wdrozenie/backup-dr.md`](../07-wdrozenie/backup-dr.md) § 7); kopie wygasają po 35 dniach; audyt zachowuje tylko pseudonim | do 14 dni (w granicach miesiąca z art. 12 ust. 3) |
| Ograniczenie i sprzeciw (art. 18, 21) | wniosek e-mailem do administratora; sprzeciw wobec przetwarzania w celach bezpieczeństwa rozpatrywany indywidualnie | do miesiąca |
| Wycofanie zgody (art. 7 ust. 3) | przełącznik w `/ustawienia/prywatnosc` | natychmiast |
| Skarga | do Prezesa Urzędu Ochrony Danych Osobowych | — |

Tożsamość wnioskodawcy: wnioski z aplikacji — sesja z 2FA i step-up; wnioski e-mailem — tylko z adresu konta, z potwierdzeniem w aplikacji. Każdy wniosek i jego realizacja trafia do audytu.

## 8. Odbiorcy i przekazywanie poza EOG (NFR-11.03)

| Odbiorca | Rola | Dane | Lokalizacja | Podstawa i umowa |
|---|---|---|---|---|
| Brevo (Sendinblue SAS, Francja) | podmiot przetwarzający | adresy e-mail, treść e-maili (bez kwot portfela) | UE | umowa powierzenia (DPA) jako część warunków Brevo — do akceptacji w panelu przed M1 |
| OVHcloud (VPS) | podmiot przetwarzający | metadane połączeń (adres IP, czas, nazwa SNI); zaszyfrowany ruch; zaszyfrowane kopie zapasowe bez kluczy | UE (region VPS do potwierdzenia przez właściciela) | umowa powierzenia w warunkach OVHcloud — NIEZWERYFIKOWANE, do potwierdzenia w panelu przed M1 |
| Usługi Web Push (Apple, Google, Mozilla — zależnie od przeglądarki) | operatorzy infrastruktury wybranej przez przeglądarkę | identyfikator subskrypcji, czas wysyłki; treść zaszyfrowana end-to-end (RFC 8291) i bez kwot | mogą być poza EOG (USA) | decyzja Komisji (UE) 2023/1795 w sprawie EU-US Data Privacy Framework dla certyfikowanych podmiotów — NIEZWERYFIKOWANE dla każdego operatora; minimalizacja treści |
| Pwned Passwords | — | 5 znaków skrótu SHA-1 hasła (k-anonimowość) — nie są danymi osobowymi | — | — |
| Dostawcy danych rynkowych | — | zapytania o instrumenty bez identyfikatorów użytkowników | — | — |
| Google, GitHub (OAuth, P2) | niezależni administratorzy | fakt logowania przez dostawcę | poza EOG | informacja w klauzuli po włączeniu flagi `auth.oauth` |

GitHub nie otrzymuje danych użytkowników aplikacji (repozytorium zawiera wyłącznie kod, dokumentację i dane syntetyczne — ADR-013).

## 9. Bezpieczeństwo przetwarzania (art. 32)

Środki techniczne i organizacyjne opisują: [`kontrole-bezpieczenstwa.md`](kontrole-bezpieczenstwa.md) (szyfrowanie, nagłówki, walidacja, łańcuch dostaw, logi), [`uwierzytelnianie-autoryzacja.md`](uwierzytelnianie-autoryzacja.md) (2FA, sesje, RLS), [`../07-wdrozenie/infrastruktura.md`](../07-wdrozenie/infrastruktura.md) (hardening) i [`../07-wdrozenie/backup-dr.md`](../07-wdrozenie/backup-dr.md) (kopie i test odtwarzania). Najważniejsze dla prywatności: dane w Polsce (serwer domowy), TLS kończony w domu, RLS na każdej tabeli z danymi użytkownika, brak trackerów, powiadomienia bez kwot, minimalny zakres danych (brak numerów rachunków i haseł do brokerów).

## 10. Naruszenia i ocena skutków

- **Naruszenie ochrony danych:** ocena i zgłoszenie do Prezesa UODO w ciągu 72 godzin od stwierdzenia (art. 33), chyba że naruszenie nie powoduje ryzyka; zawiadomienie użytkowników bez zbędnej zwłoki przy wysokim ryzyku (art. 34); wpis do wewnętrznego rejestru naruszeń zawsze — procedura w [`plan-reagowania.md`](plan-reagowania.md) § 7.
- **Ocena skutków (art. 35):** nie jest wymagana. Z kryteriów EROD występuje jedno (dane o charakterze osobistym — finanse); brak dużej skali, systematycznego monitorowania, łączenia zbiorów i decyzji automatycznych. Funkcję analizy ryzyka pełni [`model-zagrozen.md`](model-zagrozen.md). Ocenę powtarzamy, jeśli liczba użytkowników lub zakres danych istotnie wzrośnie.

## 11. Szablony tekstów

Pola w nawiasach klamrowych wypełnia konfiguracja instancji. Ostateczne brzmienie i regulamin — Krok 6 (`docs/12-dla-uzytkownika/`), przed M1.

### 11.1 Informacja o przetwarzaniu danych (skrót na ekranie rejestracji)

> **Kto przetwarza Twoje dane:** {ADMINISTRATOR}, kontakt: {KONTAKT_EMAIL}. OligInvest to prywatna aplikacja na serwerze administratora w Polsce.
> **Po co:** żeby prowadzić Twoje konto i funkcje aplikacji (podstawa: umowa — regulamin), chronić konta i usługę (prawnie uzasadniony interes) oraz — tylko jeśli się zgodzisz — mierzyć wydajność aplikacji (zgoda).
> **Komu przekazujemy:** Brevo (wysyłka e-maili, UE), OVHcloud (serwer pośredniczący, tylko zaszyfrowany ruch i zaszyfrowane kopie), usługi powiadomień Twojej przeglądarki (treść zaszyfrowana, bez kwot).
> **Jak długo:** dane konta i portfela do usunięcia konta; logi 14–30 dni; kopie zapasowe 35 dni; szczegóły w pełnej informacji.
> **Twoje prawa:** dostęp i eksport danych, sprostowanie, usunięcie konta, ograniczenie, sprzeciw, wycofanie zgody w każdej chwili, skarga do Prezesa UODO.
> **Ważne:** administrator jako operator serwera ma techniczną możliwość dostępu do bazy danych. Nie przegląda Twoich danych finansowych, chyba że jest to niezbędne do naprawy usługi albo sam o to poprosisz. Aplikacja nie jest doradztwem inwestycyjnym.
> Pełna informacja o przetwarzaniu danych: `/prywatnosc` · Regulamin: `/regulamin`

### 11.2 Informacja w e-mailu z zaproszeniem (art. 14)

> {AUTOR_ZAPROSZENIA} zaprasza Cię do OligInvest. Twój adres e-mail przetwarza {ADMINISTRATOR} wyłącznie po to, żeby wysłać to zaproszenie i umożliwić rejestrację (prawnie uzasadniony interes). Jeśli nie założysz konta, adres zostanie usunięty w ciągu {30 DNI} od wygaśnięcia zaproszenia. Kontakt i Twoje prawa: {LINK_PRYWATNOSC}.

### 11.3 Zgoda na diagnostykę

> ☐ Zgadzam się na wysyłanie z mojej przeglądarki anonimowych pomiarów szybkości działania aplikacji (czas wczytania, reakcji i stabilność układu strony). Pomiary nie zawierają danych finansowych ani identyfikatora mojego konta. Zgodę mogę wycofać w każdej chwili w Ustawienia → Prywatność.

### 11.4 Regulamin — wymagane elementy

Art. 8 ust. 3 ustawy o świadczeniu usług drogą elektroniczną: rodzaje i zakres usług; warunki świadczenia (w tym wymagania techniczne i zakaz dostarczania treści o charakterze bezprawnym); warunki zawierania i rozwiązywania umów; tryb postępowania reklamacyjnego. Dodatkowo: usługa nieodpłatna i prywatna (dostęp z zaproszenia), brak gwarancji dostępności, charakter informacyjno-edukacyjny analiz (nie są rekomendacją ani doradztwem inwestycyjnym — `11-zgodnosc-prawna.md`), zasady zmiany regulaminu (§ 5.1), rozwiązanie umowy przez usunięcie konta, reklamacje e-mailem z odpowiedzią w 14 dni.

## 12. Lista kontrolna przed udostępnieniem aplikacji innym osobom (M1)

- [ ] Uzupełnione pola konfiguracji: `LEGAL_CONTROLLER_NAME`, `LEGAL_CONTACT_EMAIL`, wersje dokumentów.
- [ ] Opublikowane `/regulamin` i `/prywatnosc` w wersji `2026-09` (Krok 6), sprawdzone przez właściciela.
- [ ] Zaakceptowana umowa powierzenia w panelu Brevo i sprawdzona w warunkach OVHcloud; zapisane daty i wersje.
- [ ] Rejestracja zapisuje akceptację i potwierdzenie; bramka regulaminu działa (test e2e).
- [ ] Bez zgody przeglądarka nie wysyła pomiarów RUM (test e2e).
- [ ] Eksport obejmuje wszystkie tabele z `user_id` (test porównujący z bazą).
- [ ] Usunięcie konta: kaskada, `erasure_log`, ponowne usunięcie po odtworzeniu kopii (test w ramach testu odtwarzania).
- [ ] Rejestr naruszeń i procedura z [`plan-reagowania.md`](plan-reagowania.md) znane właścicielowi.
