# M0-2 — historia etapów

**Cel:** zachować krótkie dowody zakończonych etapów; stan bieżący w [raporcie](m0-2-session-report.md).

## 2026-10-01 — przygotowanie i wykrycie blokady

- Gałąź `feat/m0-2-release` z `main` na `25e8762`; zależności M0-1 scalone.
- Przegląd INF ujawnił konflikt root/0600 z procesami non-root i plikowymi sekretami Compose.
- Lokalny Compose: oryginał 0:0/600 nieczytelny, kopia 10001:10001/400 czytelna i niezapisywalna; PASS.
- Dokumentacja Docker potwierdza ignorowanie `uid/gid/mode` dla źródła `file`.
- [Propozycja korekty](m0-2-secret-permissions.md) oczekuje na właściciela według AGENTS §2.5; R-27.
- Bez implementacji obrazów, wydania i wdrożenia; bez zmian ustawień GitHub i serwerów.
