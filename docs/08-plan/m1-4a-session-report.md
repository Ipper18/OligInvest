# M1-4a — stan bieżący

**Cel:** przekazać stan BL-121/122/113/116 i pozostałe warunki PR #11.

**2026-10-12**, `feat/m1-4a-ui-shell`, [PR #11](https://github.com/Ipper18/OligInvest/pull/11), roboczy.
Implementacja lokalnie wykonana; statusy `w toku` do zielonego CI i wspólnego DoD.
Nakład i odchylenie niezmierzone. Szczegóły testów i zależności w opisie PR.

## Zrobione

- Powłoka mobilna/desktopowa, nawigacja z definicji modułów, bramki proxy/RSC,
  QueryClient per użytkownik, SSE fetch/ReadableStream: wznowienie, backoff/jitter,
  terminalne 401/403, wylogowanie, jedno połączenie na kartę, pauza po 5 min w tle.
- Logowanie, TOTP i kody zapasowe, zaproszenie/reset z tokenem we fragmencie,
  konfiguracja QR i akceptacja dokumentów. API wywoływane przez serwer web.
- Preferencje dark/light/system i paleta; SSR i zapis bez przeładowania dokumentu.
  Domyślny dark w migracji/API; zapisane wybory zachowane. PLN zgodnie z ADR-014.
- Trzy strony prawne MDX, pełne teksty w i18n, test zgodności ze źródłem, LEGAL_*,
  pobieranie/druk i disclaimer general. CSS kompilowany i osadzany z nonce CSP.
- Wypchnięte osobne commity UI, rejestru modułów, wydajności i testów shell-auth.
  Korekty zatwierdzone przez właściciela zapisano wcześniej w osobnym `docs:`.

## Weryfikacja

- Zmienione pakiety JS/TS i zależne: 84 zadania PASS; po poprawkach CI cztery
  pakiety web/ui/i18n/contracts: 18/18 PASS. API: 92 testy. Lokalnie brak `uv`;
  niezmieniony Python sprawdza CI. Produkcyjny build i granica server-only PASS.
- PostgreSQL 18, rzeczywiste MFA, endpointy preferencji/akceptacji i RLS PASS;
  migracje kontra schema.sql: **ZERO DIFFERENCES**. Drizzle snapshot odtworzony
  po błędzie loadera ESM generatora; porównanie bazy potwierdza zgodność.
- Chromium: 19 PASS, 1 test prawdziwego API pozostawiony CI. Axe: 0 naruszeń
  dark/light przy 360/1280 px oraz na publicznych/auth (zawsze dark). UI fixtures
  nie zastępują pełnego E2E z bazą i importem. Testy narzędzi wydajności: 13 PASS.
- Powłoka **21,98/30 KiB**, Start 148,89/190, ustawienia 149,62/185,
  logowanie 138,40/160; wszystkie wdrożone trasy PASS, twarde budżety w CI.
- Lighthouse (TLS/HTTP2 jak Caddy, mediana 3): LCP logowanie **1586 ms**,
  Start **1654 ms**; TBT 30/38 ms, CLS 0. Progi 2000/200/0,1 bez zmian.

## CI i pozostałe warunki

CI odczytano **jeden raz**. Buildu bez modułów dotyczył typ PrintButton;
CodeQL wskazał SSRF i wyłączenie walidacji TLS w lokalnym proxy pomiarowym.
Commit `826daf4` usuwa przyczyny: jawny ReactElement, stały host upstream,
walidacja TLS z własnym certyfikatem fixture; regresje PASS. Typecheck był
anulowany przez nowszy push. Pozostałe kontrole PASS lub w toku w chwili odczytu.
**Nowego przebiegu po poprawkach nie odpytywano; brak potwierdzenia zielonego CI.**

BL-147/148/152/154/155/157/158 pozostają M1-4b; reszta BL-104 w bramie B.
Bramy M1 A/B otwarte: przegląd właściciela, pełne E2E/VoiceOver i telefon,
realny import, wdrożenie i uzupełnienie LEGAL_* przez właściciela.
Nie ma nowego ADR: dopisek ADR-007/realtime i dwie operacje BL-104 zatwierdzone.
R-35 rozwiązane lokalnie; końcowe potwierdzenie przy DoD. Brak nowych ryzyk
wymagających zmiany decyzji lub osłabienia kontroli bezpieczeństwa.
