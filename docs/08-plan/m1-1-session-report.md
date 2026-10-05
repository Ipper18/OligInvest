# M1-1 — stan bieżący

**Cel:** przekazać stan API/CLI uwierzytelniania; dowody etapów w [historii](m1-1-session-history.md).

**2026-10-05**, `feat/m1-1-auth`, [roboczy PR #7](https://github.com/Ipper18/OligInvest/pull/7). Zakres BL-101/102/103/105/106/107/108/109/111/117; UI w M1-4.

## Implementacja

- Better Auth 1.7.5/Drizzle, osobna rola auth, Argon2id, lista 10k/HIBP z fallbackiem, limity i opóźnienia; zamknięta lista tras, Origin, obowiązkowe MFA, blokada powtórek TOTP i 5/15 min. Bramka regulaminu na dostępie do danych.
- Bootstrap właściciela tylko w pustej bazie: ukryte hasło, zgody i audyt. Zaproszenia API/CLI z hashem tokenu, e-mailem i fragmentem URL; preview i `/me`. Zatwierdzona weryfikacja e-maila zaproszeniem.
- Sesje `__Host-`, 7 dni bezczynności/30 dni absolutnie, rotacja, lista z przybliżonym IP, zdalne odwołanie, Clear-Site-Data; step-up TOTP 15 min.
- Zatwierdzone odzyskanie: `mfa_method=backup` + hasło daje jednorazową wymianę TOTP przez 10 min. Bez eksportu, zmiany hasła, PAT ani admina. Nowy TOTP usuwa inne sesje i wydaje nowe backupy; audyt i zdarzenia. E-mail odzyskania pozostaje w BL-110.
- RBAC wg MOD §6, audyt admina i CLI (pseudonim, wynik, powód CLI, identyfikator żądania HTTP). CLI: invite, reset-2fa, revoke-sessions/all, revoke-pats/all, queues, flag. Hostowy maintenance i oli-admin: audyt przed zmianą, rollback Caddy po błędzie reload.
- Flagi w API/jobs: cache 30 s, role/użytkownicy, 404, pomijanie zadań, pub/sub flags.changed. Fundamenty niewyłączalne.
- SMTP: reset hasła, zaproszenie, reset 2FA przez jobs; STARTTLS Brevo, walidacja, wygaszanie i usuwanie zadań z tokenami. Test SMTP syntetyczny; konfiguracja DNS i doręczenie na instancji należą do właściciela.

## Dowody i dalsze kroki

21 operacji HTTP / 164 pending (lista zmalała z 182); klient wygenerowany. PostgreSQL: migracje, normatywny RLS, adapter, bootstrap, odzyskanie, sesje/RBAC/audyt/CLI — PASS; schemat ZERO DIFFERENCES. Lint/typecheck/test/build API/jobs i zależności PASS. Valkey: unieważnienie cache dwóch procesów i izolacja ról PASS; skrypt maintenance 4 testy Linux PASS. Ostatni wypchnięty commit 9a0fd75 miał wszystkie kontrole zielone, także images/contracts. Nowe zmiany wymagają końcowego CI głowy PR.

Następnie: końcowy przegląd kryteriów i testów, kontrakty oraz CI, aktualizacja opisu PR i statusów. Nie zamknięto bram całego M1. Kalibracja Argon2id, DNS/doręczenia SMTP i instalacja skryptów na VM pozostają czynnościami właściciela. Brak nowych ADR/usług/kosztów; estymacje bez zmian, nakład niezmierzony. Digest Node jest aktualny; CVE glibc nie ma poprawki w Debian/OSV, bez wyjątków skanera; images naprawione usunięciem nieużywanych opcjonalnych peers Better Auth z grafu produkcyjnego.
