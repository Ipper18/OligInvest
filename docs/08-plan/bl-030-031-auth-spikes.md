# BL-030/031 — ciasteczka i przechowywanie poświadczeń

**Cel:** przekazać właścicielowi wyniki rzeczywistych testów Better Auth oraz decyzje przed implementacją M1.

**2026-10-02. Status: wyniki techniczne PASS; decyzje BL-030/031 zatwierdzone przez właściciela po przeglądzie PR #5.** Better Auth i `@better-auth/api-key` 1.7.5, `@node-rs/argon2` 2.2.1; przypięte devDependencies, instalacja frozen. Kod: [auth-storage.mjs](../../apps/api/spike/auth-storage.mjs). Baza pamięciowa biblioteki zawiera tylko dane syntetyczne; rzeczywisty handler HTTPS i trzy silniki przeglądarek. Test nie zastępuje integracji adaptera PostgreSQL ani bramek MFA/regulaminu w M1.

## BL-030

Test `node apps/api/spike/auth-storage.mjs` przechodzi w Chromium, Firefox i WebKit: rejestracja testowa, włączenie TOTP i weryfikacja, logowanie z drugim składnikiem, zużycie jednorazowego kodu zapasowego, wylogowanie. Każdy nagłówek `Set-Cookie`, także usuwający ciasteczko, ma `__Host-oliginvest.`, `Secure`, `HttpOnly`, `Path=/`, bez `Domain`. Po wylogowaniu przeglądarka nie przechowuje tokenu sesji.

Konfiguracja z AUTH §4.1 działa: `advanced.useSecureCookies: false` wyłącza automatyczne doklejanie `__Secure-`, a jawne `defaultCookieAttributes.secure: true` zachowuje wymaganie HTTPS. Jawnie nazwane są również `session_data`, `account_data` i `trust_device`, aby przyszłe zmiany konfiguracji nie wprowadziły drugiej konwencji. Cache sesji jest wyłączony. Spike nie włącza produkcyjnego „zaufanego urządzenia”, OAuth ani rejestracji publicznej.

**Decyzja właściciela 2026-10-02:** przyjąć tę konfigurację w BL-105; techniczny warunek O-01 potwierdzony dla 1.7.5. Formalna aktualizacja rejestru odstępstw wraz z integracją M1. Test wszystkich ciasteczek pozostaje bramką aktualizacji Better Auth.

## BL-031

| Element | Dowód testu | Wynik |
|---|---|---|
| Sekret TOTP | zapis jest różny od sekretu; odszyfrowanie przez `symmetricDecrypt` odtwarza bajty zakodowane base32 w URI TOTP | PASS |
| Kody zapasowe | `storeBackupCodes: encrypted`; odszyfrowanie daje listę wydaną użytkownikowi, zapis nie zawiera jawnych kodów; użycie usuwa kod z zaszyfrowanej listy | PASS |
| PAT | zapis różny od wydanego klucza i równy wynikowi `defaultKeyHasher`; domyślne `disableKeyHashing: false` | PASS |
| Argon2id | rzeczywista biblioteka, PHC `argon2id`, m=19456 KiB, t=2, p=1; poprawne hasło akceptowane, błędne odrzucane | PASS lokalny |

Źródła: kod zainstalowanych, przypiętych pakietów (`better-auth/dist/plugins/two-factor/index.mjs`, `crypto/index.mjs`, `plugins/two-factor/backup-codes/index.mjs`; `@better-auth/api-key/dist/index.mjs`). `twoFactor` w 1.7.5 domyślnie ustawia `storeBackupCodes: encrypted`; jawna opcja pozostaje wskazana. Historyczny opis AUTH dotyczący domyślnego plaintext w 1.6.23 nie opisuje już testowanej wersji. API key używa jednokierunkowego SHA-256, więc nie wymaga szyfrowania umożliwiającego odzyskanie klucza. ADR-004 pkt 6 wymaga dodatkowego szyfrowania wyłącznie przy przechowywaniu jawnym.

**Decyzja właściciela 2026-10-02:** jawne `storeBackupCodes: "encrypted"`, natywne szyfrowanie TOTP i haszowanie PAT (`disableKeyHashing: false`) bez drugiej warstwy szyfrowania. Opis wersji zaktualizowano w AUTH. Bez nowego ADR, bo nie zmienia to zaakceptowanego wymogu ochrony sekretów. Rotacja wersjonowanego klucza szyfrowania i adapter SQL pozostają testami BL-101/103, poza zakresem tego spiku.

## Kalibracja Argon2id przez właściciela

Pomiar z 2026-10-01 (ok. 4 ms) obejmował pełne `await hash(password, options)`, a nie samo utworzenie Promise. Kontrola 2026-10-02 na lokalnym Windows/Node 24.21.0: mediana **5,1 ms async / 5,3 ms sync** (po 10 próbek po 2 rozgrzewkach). Pomiar kończy się po otrzymaniu PHC; weryfikacja hasła jest poza mierzonym odcinkiem. Sprawdzono PHC `argon2id v=19 m=19456,t=2,p=1`, poprawne i błędne hasło oraz różne sole kolejnych hashy. Niezależna ścieżka `hashSync` potwierdza rząd wielkości. Poprawiono medianę parzystej próby: średnia dwóch środkowych pomiarów zamiast szóstego pomiaru. **To nie jest wynik serwera i nie potwierdza celu 100–250 ms.** Parametrów produkcyjnych nie zmieniono. Agent nie ma dostępu do VM.

Na docelowej VM, z przeglądniętego źródła po scaleniu, właściciel wykonuje:

```sh
docker build -f infra/docker/node.Dockerfile --target auth-benchmark -t oliginvest-auth-benchmark .
docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges --cpus 1 --memory 384m oliginvest-auth-benchmark
```

Budowanie instaluje tylko zależności z lockfile; pomiar działa bez sieci i nie drukuje hasła ani hashy. Wynik należy zapisać w tej notatce z przydziałem VM i obciążeniem Immicha. Jeśli mediana jest poza 100–250 ms, właściciel zatwierdza silniejsze parametry i powtarza pomiar dla równoczesnych logowań. Nie obniżać m/t/p poniżej minimum. Kryterium M0 nr 8 w części czasu serwerowego pozostaje otwarte do tego pomiaru.
