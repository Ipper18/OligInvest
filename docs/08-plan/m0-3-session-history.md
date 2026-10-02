# M0-3 — historia etapów

**Cel:** zachować krótkie dowody zamkniętych etapów; stan bieżący w [raporcie](m0-3-session-report.md).

## 2026-10-02 — decyzje BL-030/031

- Zapisano zatwierdzenie `__Host-` dla BL-105, natywnego szyfrowania TOTP/kodów oraz haszowania PAT w AUTH i spikach.
- Sprawdzono pełne hashowanie Argon2id: async 5,1 ms / sync 5,3 ms lokalnie, po 10 próbek; PHC i świeże sole PASS. Poprawiono medianę parzystej próby.
- Kalibracja VM i integracja auth w M1 pozostają otwarte; bez nowego ADR, estymacje bez zmian, nakład niezmierzony.
