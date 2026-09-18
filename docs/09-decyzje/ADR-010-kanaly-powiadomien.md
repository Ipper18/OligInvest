# ADR-010: Kanały powiadomień — Web Push + e-mail przez SMTP (Brevo, darmowy plan)

- **Status:** zaakceptowana
- **Data:** 2026-09-18
- **Decydent:** właściciel projektu
- **Powiązane wymagania:** FR-05.06, FR-05.07, FR-07.01, FR-07.10, FR-09.03, NFR-05.01, NFR-11.03, Z-08, Z-09

## Kontekst

Alerty mają trafiać „push + e-mail” (§3.1.5); e-mail jest też potrzebny do zaproszeń, weryfikacji adresu i resetu hasła. Budżet 0 zł. Własny serwer SMTP z domowego IP lub VPS bez reputacji trafia do spamu lub jest blokowany (port 25). Web Push na iOS działa tylko w zainstalowanej PWA i bez gwarancji czasu doręczenia (Z-08).

Weryfikacja planów darmowych (2026-09-18): **Brevo** — 300 e-maili/dzień (transakcyjne i marketingowe łącznie), SMTP i API, logo Brevo w stopce, bez karty, firma z UE (Francja); **Resend** — 3 000 e-maili/mies., 100/dzień, SMTP w cenie, 3 domeny, retencja 30 dni, firma z USA.

## Rozważane opcje

| Opcja | Zalety | Wady |
|---|---|---|
| **Web Push + e-mail przez SMTP z Brevo** | 0 zł; 300/dzień wystarcza z zapasem (kilku użytkowników); podmiot z UE (RODO); SMTP = brak uzależnienia od SDK | Logo Brevo w stopce |
| Web Push + Resend | Nowoczesne API, dobre dostarczanie | Podmiot z USA (transfer danych poza EOG), 100/dzień |
| Własny Postfix | Pełna kontrola | Reputacja IP, blokady portu 25, SPF/DKIM/DMARC i monitoring — duży koszt utrzymania |
| Telegram bot / ntfy | Darmowe, niezawodne powiadomienia | Dodatkowa aplikacja u użytkownika; nie zastępuje e-maila dla kont (reset hasła) |

## Decyzja

- **Web Push** (biblioteka `web-push`, klucze VAPID w sekretach) jako kanał podstawowy dla alertów.
- **E-mail przez SMTP (nodemailer) z Brevo** jako kanał dla kont (zaproszenia, weryfikacja, reset hasła) i zapasowy dla alertów (brak subskrypcji push, alert oznaczony jako krytyczny). Dostawca wymienny zmianą danych SMTP (Resend jako zamiennik).
- DNS domeny: rekordy SPF, DKIM i DMARC (`p=quarantine` po okresie obserwacji) dla subdomeny nadawczej.
- Zasady: ciche godziny, deduplikacja i cooldown, limit dzienny e-maili pilnowany kolejką `notify` (≤ 300/dobę), dziennik doręczeń per kanał, usuwanie wygasłych subskrypcji push (404/410).
- Telegram/ntfy: poza zakresem MVP; możliwe jako dodatkowy kanał w przyszłości (nowy adapter kanału, bez zmian w module alertów).

## Konsekwencje

- Pozytywne: 0 zł; brak utrzymania serwera pocztowego; dane w UE.
- Negatywne: logo Brevo w stopce; zależność od zewnętrznego dostawcy (łagodzona SMTP — wymiana w minutę); Web Push na iOS wymaga instalacji PWA.
- Zadania: konfiguracja SMTP + DNS (M1, potrzebne do zaproszeń i resetu hasła), Web Push (M4), preferencje kanałów (M4).

## Weryfikacja

Testowe wiadomości trafiają do skrzynki odbiorczej Gmail i iCloud (nie do spamu); nagłówki potwierdzają `dkim=pass`, `spf=pass`, `dmarc=pass`; powiadomienie push dociera na iPhone’a z zainstalowaną PWA.
