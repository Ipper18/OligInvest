# M4 — backend: stan bieżący

**Cel:** przekazać stan BL-403/404/405 i backendu BL-407/408 oraz pozostałe warunki odbioru.

**2026-10-27**, `feat/m4-backend`, osobny worktree. Lokalny checkpoint przed scaleniem; `origin/main` scalony do `3f01ea6` (#34). #36 pozostaje otwartym PR, nie ma go na `main`. Publikacja jako draft PR; CI sprawdzane jeden raz na końcu, bez oczekiwania i pętli. Statusy pozostają `w toku` do zielonego CI i wspólnego DoD.

## Zrobione

- Powiadomienia e-mail/fallback, preferencje i historia właściciela, cisza w jego strefie, łączenie odłożonych wyzwoleń reguły. Wiadomości bezpieczeństwa/resetu omijają ciszę. Limit 300 prób SMTP/dobę UTC, z rezerwą 50 dla kont/bezpieczeństwa.
- Trzy alerty cenowe, ewaluacja notowań/EOD, Decimal, histereza/cooldown, blokada stale/BLOCK, publikacja po commit i odzyskiwanie zdarzeń. Treści z czasem wyzwolenia i źródłem/czasem danych, bez kwot portfela i zaleceń.
- PAT: CSPRNG, tylko hash w bazie, step-up, zakresy, limity, odwołanie, nowa sieć i przypomnienie o wygaśnięciu. Replay 24 h odtwarza metadane z `tokenShown:false`, bez sekretu i duplikatu; test awarii kolejki i odzyskiwania przypomnienia.
- Pięć `/quick/*`, JSON/text pl-PL, pieniądze jako tekst z przecinkiem/kropką, duplikaty i niejednoznaczny ticker. Niepełna wycena: 200, kwoty null, `incomplete` i powody; bez zer zastępczych. Walidacja zapisu bez utraty precyzji. Kontrakty, klient i instrukcje aktualne.
- Build i import API/jobs przy fizycznym braku kolejno `alerts` i `quick-actions`: PASS; opcjonalne zależności i rejestry modułów.

## Dowody lokalne i ograniczenia

- Zmienione pakiety i zależne: lint/typecheck/test 84/84 PASS; core 99,58% linii i 100% funkcji, wektor alertu. API/jobs build 18/18 PASS.
- `pnpm db:test`: PASS, PostgreSQL 18.6, migracje/RLS/izolacja, integracja M4, zero różnic schematu. Kontrole repozytorium, dokumentów, zależności i języka, Redocly, OpenAPI 92 operacje/93 pending oraz klient: PASS.
- Wcześniej przez brak `uv` pomijano Ruff, mypy, pytest i pełną macierz buildów. Obecnie `uv 0.12.16` działa: frozen sync, build Python, Ruff, mypy `--platform linux` PASS; pytest 151 PASS, 1 SKIP (`test_node_to_python_real_valkey`, wymaga runnera Compose). **Aktualnie brak pominięć z powodu braku uv.** Natywny mypy Windows zgłasza istniejące `os.killpg` w M3; wersja docelowa Linux przechodzi.
- Pełne obrazy, E2E, macierz całego monorepo i integracja kolejek pozostają w CI. Pomiar quick <300 ms dotyczy syntetycznej integracji, nie odbioru obciążeniowego serwera.

## Dalszy zakres i decyzje

M4 nie jest zamknięte: PWA, Web Push, ekrany (także PAT), Skróty/HTTP Shortcuts i testy urządzeń są w kolejnej paczce. Zależność od BL-402 odłożona przez właściciela. Jedna paczka pięciu zadań na jego życzenie; estymata 11,5 dnia obejmuje odłożony ekran PAT, rzeczywisty nakład niezmierzony. Zatwierdzone korekty kontraktów zapisane w AUTH/API/OBL; bez nowego ADR i nowych bibliotek zewnętrznych. Nowe ryzyko: **R-45**, możliwe powtórzenie SMTP po awarii między wysłaniem a zapisem potwierdzenia. Nie zmieniano wyjątków deps-audit ani obrazów.
