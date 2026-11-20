# BL-614b — stan sesji

**Cel:** zapisać wynik rozszerzenia ZAP baseline API o zalogowaną sesję po TOTP oraz otwarte warunki odbioru.

2026-11-20; gałąź `feat/bl-614b-zap-auth`, baza `origin/main` `66a3e39`; osobny worktree wskazany przez właściciela; PR — w opisie zmiany.

## Zrobione

- `zap-baseline.mjs --api` ma po niezmienionym przebiegu `api-public` drugi przebieg `api-authenticated`: syntetyczne zaproszenie (`seedScanInvitation`), rejestracja, TOTP, wylogowanie, logowanie z TOTP, chronione trasy i odmowa admina — wszystko przez ZAP.
- Asercje kroków (statusy, kody, `no-store`, wysłane/wydane/usunięte ciasteczka, stan MFA i sesji) oraz atrybutów każdego `Set-Cookie` w historii ZAP (`__Host-`, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, brak `Domain`, wygaśnięcie jak relay po #81).
- Wartości wrażliwe tylko w tymczasowym katalogu poza artefaktem; skan artefaktów pod kątem wycieku. Testy jednostkowe planu, weryfikacji przepływu, kontraktu ciasteczek i wykrywania wycieków.
- Bez nowych zależności, zmian obrazu, reguł, progów, timeoutów, retry i rulesetu; krok CI `dast` tylko przemianowany. Uaktualnione SEC § 9.1, CI/CD, R-56, backlog.

## Dowody

- Lokalnie `--api` 47 s: anonimowy bez zmian (34 URL-e, 3 WARN), uwierzytelniony 26 kroków, 31 wymian HTTP, 10 `Set-Cookie` zgodnych, 0 FAIL, brak wycieku.
- Próba negatywna (`httpOnly: false` tylko w `dist`, przywrócone bajtowo): 10010 FAIL i asercja skryptu, kod 1.
- Regresja web: 30 / 154 URL-e, 0 FAIL, 34 s.

## Otwarte

- Nowy informacyjny WARN 10112 (Session Management Response Identified) — do decyzji właściciela; pozostaje `WARN` bez wyjątku.
- Obserwacja: API usuwa ciasteczka `Max-Age=0`, relay web `Expires` w przeszłości (#81); UI nie używa bezpośredniego `sign-out` API — zmiana tylko po decyzji.
- Limit auth 5 / 60 s na IP wspólny dla obu przebiegów — hook czeka na nowe okno (≤ 62 s), limit bez zmian.
- CI i przegląd właściciela przed DoD; estymata 1 d bez zmian, nakład niezmierzony; brak nowego ADR i nowego ryzyka (R-56 zaktualizowane). M6 nie jest kończony.
