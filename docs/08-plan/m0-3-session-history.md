# M0-3 — historia etapów

**Cel:** zachować krótkie dowody zamkniętych etapów; stan bieżący w [raporcie](m0-3-session-report.md).

## 2026-10-02 — decyzje BL-030/031

- Zapisano zatwierdzenie `__Host-` dla BL-105, natywnego szyfrowania TOTP/kodów oraz haszowania PAT w AUTH i spikach.
- Sprawdzono pełne hashowanie Argon2id: async 5,1 ms / sync 5,3 ms lokalnie, po 10 próbek; PHC i świeże sole PASS. Poprawiono medianę parzystej próby.
- Kalibracja VM i integracja auth w M1 pozostają otwarte; bez nowego ADR, estymacje bez zmian, nakład niezmierzony.

## 2026-10-02 — poprawki BL-023 po PR #5

- Rollback odtwarza poprzednie obrazy usług danych przed aplikacjami, migracja z `--no-deps`; bez cofania danych i migracji.
- Journald zachowuje stałe nazwy kroków, także przy nieudanym rollbacku; nie zapisuje treści wyjątków/wyjść narzędzi.
- Jawne `--retry-staged`: archiwizacja nieaktywnego wydania, blokada aktywnego/symlinków, ponowna weryfikacja podpisów; runbook z kontrolą zdrowia przed ponowieniem.
- 10/10 testów na lokalnym Linux PASS, kontrola dokumentacji PASS; bez operacji na serwerach. Estymacje bez zmian, nakład niezmierzony.
