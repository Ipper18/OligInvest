# M0-3 — stan bieżący

**Cel:** przekazać stan konfiguracji i instrukcji BL-024–029 oraz poprawek po PR #5. Szczegóły zamkniętych etapów: [historia](m0-3-session-history.md).

**2026-10-02**, gałąź `feat/m0-3-infra` z aktualnego `main` (`47fb336`), [roboczy PR #6](https://github.com/Ipper18/OligInvest/pull/6). Wykonanie na serwerach należy wyłącznie do właściciela.

- BL-030/031: zapisano zatwierdzenie właściciela w notatce spików i AUTH. O-01 technicznie potwierdzone dla 1.7.5; formalna integracja w BL-105. TOTP i kody szyfrowane, PAT haszowane, bez nowego ADR.
- Argon2id: pełne hashowanie potwierdzone przez `await`, PHC, poprawne/błędne hasło i świeże sole; mediana lokalna async 5,1 ms / sync 5,3 ms. Cel 100–250 ms wymaga pomiaru i kalibracji przez właściciela na VM.
- BL-023 po PR #5: rollback przywraca najpierw postgres i oba Valkey, potem aplikacje; migrator `--no-deps`. Journald zapisuje nazwę kroku i ewentualny krok błędu rollbacku, bez wyjść narzędzi. `--retry-staged` zachowuje nieaktywną próbę w `failed` i powtarza pełną weryfikację. 10 testów Linux PASS, w tym awaria każdej usługi i ochrona aktywnego wydania; instrukcja właściciela uzupełniona.
- BL-024–027: szablony nginx SNI/HTTP, nftables VPS/VM (także Docker FORWARD), NTS, DoT, SSH i daemon.json; instrukcje tuneli, MTU, hardeningu, DNS/CAA i wszystkich faz migracji Immicha. 5 testów na Debianie 13 PASS, w tym rzeczywiste parsery nginx/nft/chrony i regresje P-08/P-09. Wynik panelu home.pl oraz fazy migracji są do wykonania przez właściciela; fallback CAA wymaga ADR, bez samodzielnej zmiany dostawcy.
- Dalej: BL-028/029 — kopie, timery, Kuma i próby alarmów.

M0 pozostaje otwarty; brak dowodów docelowych kryteriów 4–6 oraz kalibracji/CAA z kryterium 8. Kontrole PR oczekują utworzenia PR. Estymacje bez zmian, nakład niezmierzony. Bez nowych usług, kosztów ani zmian kontraktów domenowych.
