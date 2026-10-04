# M1-1 — stan bieżący

**Cel:** krótki stan implementacji API/CLI uwierzytelniania i następne kroki; dowody zamkniętych etapów w [historii](m1-1-session-history.md).

**2026-10-04**, `feat/m1-1-auth` z `origin/main` (`52b3120`), [roboczy PR #7](https://github.com/Ipper18/OligInvest/pull/7). Zakres: BL-101/102/103/105/106/107/108/109/111/117. Ekrany pozostają w M1-4. Zależności M0 wykonane lokalnie; kalibracja Argon2id na VM wymaga właściciela.

## Wykonane etapy

- Adapter Better Auth 1.7.5/Drizzle na roli `oliginvest_auth`, Argon2id, lista 10k i HIBP z fallbackiem, ciasteczka `__Host-`, szyfrowanie TOTP/kodów i rotacja klucza.
- Fasada: zaproszenie/adres/rola/zgody, bramka MFA i regulaminu, TOTP z ochroną powtórek, jednorazowe backupy, blokada 5/15 min, sesje, step-up, reset hasła. Trasy **jeszcze niezamontowane**; pending nie zmniejszano przed implementacją HTTP.
- `pnpm admin:create-owner`: tylko pusta baza, ukryte hasło TTY, jawne potwierdzenia, brak sesji, zgody, audyt. Równoczesne uruchomienia tworzą jedno konto; awaria audytu blokuje utworzenie.
- Fundament RBAC wg MOD §6 oraz ewaluacja flag (30 s, role/użytkownicy, nadrzędny moduł, unieważnianie). Podłączenie do API/jobs/pub-sub pozostaje otwarte.
- Naprawione contracts (regeneracja klienta) i produkcyjny graf zależności. Źródłem odmowy images były stare binaria esbuild/Go dołączone przez opcjonalne peers Better Auth; `.pnpmfile.cjs` usuwa nieużywane powiązania, test obrazu wykrywa regresję. Glibc CVE-2019-1010022 nie ma `fixed` w Debian/OSV, aktualny tag Node ma dotychczasowy digest. Bez fikcyjnej aktualizacji ani wyjątków skanera.

## Zatwierdzone decyzje

2026-10-03: osobny bootstrap właściciela oraz weryfikacja e-maila zaproszeniem; dokumenty poprawione.

2026-10-04: `auth.sessions.mfa_method` rozróżnia TOTP i backup. Backup + hasło pozwala **raz, przez 10 min**, tylko rozpocząć wymianę TOTP. Pozostałe operacje wrażliwe i admin wymagają TOTP. Po nowym TOTP: rotacja, usunięcie innych sesji, nowe zaszyfrowane backupy. Audyt i zdarzenia odzyskania, e-mail w BL-110. AUTH §6 i §9 (faktyczna sekcja odzyskania) oraz OpenAPI ujednolicone, migracja 0003.

## Weryfikacja i dalsza praca

`pnpm db:test` PASS: pusty bootstrap/wyścig, role/RLS, adapter, fasada, odzyskanie 2FA, odmowa backupowi zmiany hasła/eksportu/PAT/admina, wygaśnięcie 10 min, jednorazowość, brak obejścia samym hasłem, nowe kody, audyt/zdarzenia. Schemat: ZERO DIFFERENCES. API/platform lint/typecheck/test/build oraz klient i kontrakty sprawdzane przed commitem; [CI głowy PR](https://github.com/Ipper18/OligInvest/pull/7/checks) trzeba doprowadzić do zielonego.

Następnie: pełne HTTP/OpenAPI i testy 403 każdej trasy, powiadomienia resetu, pozostałe CLI/admin, podłączenie RBAC/flag i Valkey, testy przeglądarek. Nie zamknięto zadań ani bram M1. Estymacje bez zmian, nakład niezmierzony; [R-30](ryzyka.md) ma test bootstrapu. DoD paczki pozostaje otwarte.
