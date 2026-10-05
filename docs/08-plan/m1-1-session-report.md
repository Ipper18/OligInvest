# M1-1 — stan bieżący

**Cel:** przekazać stan API/CLI uwierzytelniania; dowody etapów w [historii](m1-1-session-history.md).

**2026-10-05**, `feat/m1-1-auth`, [PR #7](https://github.com/Ipper18/OligInvest/pull/7). Zakres agentowy M1-1 i cztery poprawki bezpieczeństwa wdrożone. BL-101/102/103/105/106/108/109/111/117 gotowe; BL-107 w toku wyłącznie do dowodów produkcyjnych właściciela. Bieżące CI: [kontrole PR](https://github.com/Ipper18/OligInvest/pull/7/checks). Przegląd właściciela pozostaje otwarty.

## Poprawki bezpieczeństwa — osobne commity

- `a866964` (BL-105): lista sesji ma `id` i obowiązkowe `current`, bez tokenów. Odwołanie przyjmuje `id`, wyszukuje token wewnętrznie z kontrolą `user_id`. Zatwierdzony OpenAPI i klient uaktualnione. Testy odpowiedzi bez żadnego tokenu, cudzej/nieistniejącej sesji i starego wejścia `token` PASS.
- `607f649` (BL-103): każdy kod zapasowy porównywany przez `timingSafeEqual` na skrótach SHA-256 stałej długości, bez wczesnego wyjścia. Test liczy wszystkie wywołania dla dopasowań na początku/środku/końcu, braku dopasowania i różnych długości UTF-8.
- `9f768b9` (BL-105): ciasteczka sesji, wyzwania 2FA i dont_remember akceptują każdą zachowaną wersję sekretu; nowe podpisuje pierwszy, najnowszy klucz. Testy usuniętych kluczy/manipulacji i sesji SQL po rotacji bez logowania PASS.
- `f247936` (BL-102): zaproszenia czekają na blokadę globalną oraz blokadę idempotencji per administrator/klucz. Zajęcie auth przez inne żądanie nie daje 409. Testy współbieżności: identyczne treści → jedna odpowiedź/wiadomość, inne treści tego samego klucza → `IDEMPOTENCY_CONFLICT`.

## Weryfikacja i ograniczenia

Lokalnie po poprawkach: pełne `lint typecheck test build` **88/88 zadań PASS** (74 z cache), API **92 testy PASS**, `db:test` PASS (bootstrap, fasada auth, odzyskanie, sesje, RBAC/audyt/CLI, RLS); schemat **ZERO DIFFERENCES**. OpenAPI 21 operacji / 164 pending, klient aktualny, granice modułów i dokumentacja PASS. Pełny przebieg wymagał dodania istniejącego uv z `.git/tools/uv-0.12.16` do PATH i normalizacji lokalnego pliku generowanego Next.js. CI sprawdza dodatkowo workers/Mailpit, web/e2e, obrazy, zależności i CodeQL; wyniki przypisane do końcowego commita są w kontrolach PR.

**R-31 otwarte:** pozostawiona decyzją właściciela blokada `730101` szereguje auth/admin/CLI, także podczas Argon2/Better Auth; może opóźniać inne konta i wyczerpać pulę. Blokada per klucz nie usuwa tego ograniczenia. Pomiar i przegląd przed bramą B. R-30 pozostaje zamknięte.

Pominięte zgodnie z zakresem: ekrany M1-4, e-maile zdarzeń BL-110; kalibracja Argon2id na VM, instalacja skryptów, SPF/DKIM/DMARC i doręczenia Gmail/iCloud wymagają właściciela. Bramy M1 A/B pozostają otwarte. Estymacje bez zmian, nakład niezmierzony; bez nowych ADR, usług i kosztów. Zmiana kontraktu sesji zatwierdzona przez właściciela.
