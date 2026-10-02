# M0-3 — stan bieżący

**Cel:** przekazać stan konfiguracji i instrukcji BL-024–029 oraz poprawek po PR #5. Szczegóły zamkniętych etapów: [historia](m0-3-session-history.md).

**2026-10-02**, gałąź `feat/m0-3-infra` z aktualnego `main` (`47fb336`). Wykonanie na serwerach należy wyłącznie do właściciela.

- BL-030/031: zapisano zatwierdzenie właściciela w notatce spików i AUTH. O-01 technicznie potwierdzone dla 1.7.5; formalna integracja w BL-105. TOTP i kody szyfrowane, PAT haszowane, bez nowego ADR.
- Argon2id: pełne hashowanie potwierdzone przez `await`, PHC, poprawne/błędne hasło i świeże sole; mediana lokalna async 5,1 ms / sync 5,3 ms. Cel 100–250 ms wymaga pomiaru i kalibracji przez właściciela na VM.
- Dalej: rollback usług danych, journald z nazwą kroku, bezpieczne ponowienie; następnie BL-024–029.

M0 pozostaje otwarty; brak dowodów docelowych kryteriów 4–6 oraz kalibracji/CAA z kryterium 8. Kontrole PR oczekują utworzenia PR. Estymacje bez zmian, nakład niezmierzony. Bez nowych usług, kosztów ani zmian kontraktów domenowych.
