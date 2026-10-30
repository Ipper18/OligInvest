# M4-PWA — stan 2026-10-30

**Cel:** BL-401/402/411, draft PR #45, `feat/m4-pwa-push`; scalono `origin/main` ff5904f (#46), zachowując BL-413 i statusy paczki.

## Zrobione i decyzje

Manifest, publiczne `/offline`, statyczny cache, push/notificationclick i aktualizacja na gest; rejestracja po load. Web Push przez przypięte web-push 3.6.7 (MPL-2.0), VAPID przez `*_FILE`, RLS/idempotencja, TTL/Urgency, 404/410 i istniejąca polityka kanałów. Linki względne ze wspólnym safeReturnTo. [Zatwierdzone uzupełnienia kontraktu](m4-pwa-contract-proposal.md) wdrożone; bez nowego ADR.

Naprawa regresji PR #45: SW nie przechwytuje żadnego `/api` ani `/auth`; usunięto UNAUTHORIZED. Wylogowanie nie czeka na SW/PushManager. Decyzja właściciela: unsubscribe tylko przy jawnym/międzykartowym wylogowaniu, po cookies; sam 401 zachowuje subskrypcję, czyszcząc stan prywatny. Początkowy odczyt PushManager tylko przy skonfigurowanym i obsługiwanym push. Bez prywatnego cache, zmian CSP i nagłówków.

## Porównanie WebKit na tym samym Windowsie

- Czysty osobny worktree `origin/main` ff5904f: **20/20 PASS**, 42,5 s, jeden przebieg webkit-shell, bez zmian śledzonych plików. Preload testowy przekierował wyłącznie katalog tymczasowego TLS przez `git rev-parse --git-path` (worktree ma plik `.git`).
- PR po naprawie SW i warunkowego odczytu push: 19 wspólnych scenariuszy PASS; pozostał timeout logout. Trace: oba PUT 204, POST auth 200, obie karty na logowaniu; test czekał na niewywołany callback page.route. Raport main potwierdza przejście tych samych asercji (logout 1,358 s). Main nie zachował trace udanego testu (`retain-on-failure`); nie powtarzano go.
- Bramkę opóźnienia przeniesiono z page.route do API fixture. Wszystkie asercje kolejności pozostały; dodano sprawdzenie obecności cookie przed zwolnieniem odpowiedzi. **Tylko pozostały logout: PASS**, 5,9 s z trace. SW nadal włączony.
- Bilans ostatnich wyników PR: webkit-shell **21 PASS / 1 SKIP** (wyniki pełnego i selektywnych przebiegów, nie nowy pełny przebieg); chromium-shell pwa **2 PASS**; webkit-real mvp-real **1 PASS**. Bez retry i zmian timeoutów. Nowe testy jednostkowe regresji workera/logout pozostawiono CI zgodnie z ograniczeniem lokalnych przebiegów.

Timeouty zgłoszone w CI były regresją SW, **nie R-41**. Ostatni timeout wynikał z bramki testowej przy aktywnym SW. Nie potwierdzono problemu lokalnego WebKit na Windows. R-51 nadal dotyczy odbioru/deduplikacji push na urządzeniach.

## Zachowane dowody i granice

Nie powtarzano zaliczonych unit/kontraktów/PostgreSQL (ZERO DIFFERENCES, RLS), buildów ani pomiarów. Ostatnie pomiary: powłoka **29,77/30 KiB**, onboarding **188,68/190 KiB**, driver **7,12/8 KiB**; Lighthouse 4 trasy × 3: LCP 1353–1803 ms, TBT 45–50 ms, CLS 0 — PASS. Progi bez zmian. Końcowa poprawka podlega jednemu nowemu przebiegowi CI; jeden odczyt wyników w PR/rozmowie.

Upload-artifact e2e/images nadal zbiera raporty, test-results (trace/zrzuty) i dotychczasowe logi `.git/`; ścieżki Git działają także w worktree. Tymczasowych certyfikatów nie archiwizujemy.

BL-401/402/411 `w toku` do CI i wspólnego DoD; M4 otwarte. BL-412 (urządzenia), BL-565 i redesign BL-413/406/PAT/409 poza paczką. Estymata 6 dni, nakład niezmierzony. R-41 historyczne RSC; R-51 odbiór push — oba nadal otwarte.
