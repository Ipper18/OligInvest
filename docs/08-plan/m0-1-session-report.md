# M0-1 — stan bieżący

**Cel:** przekazać stan paczki i następny krok; wcześniejsze dowody w [historii](m0-1-session-history.md).

**2026-09-30**, gałąź feat/m0-1-skeleton, [PR #2](https://github.com/Ipper18/OligInvest/pull/2) nadal roboczy, bez scalania. Core bez zmian (osobny PR #3). Node 24.21.0, pnpm 12.4.2, Python 3.13.13; lokalne uv: .git/tools/uv-0.12.16/uv.exe.

## Wykonane w tej sesji

BL-017/035: repository (dokumentacja, fixtures, tytuł PR), lint/typecheck/unit oraz sześć buildów: all i bez każdego modułu funkcjonalnego. Kopie źródeł bez cache i plików pominiętego modułu, instalacje frozen. Jawne typy wyników API/dwóch stron naprawiają błąd czystego buildu. Budżety/Lighthouse pozostają w web, typy klienta w contracts. Ruleset: 17 rzeczywistych nazw, kontrola zgodności i duplikatów w modules; nadal disabled.

BL-018 M0-1: 36/36 E2E w Chromium/WebKit/Firefox z axe, klawiaturą, motywami i nagłówkami. Produkcyjny Next po HTTPS (tymczasowy certyfikat), API production z syntetycznymi *_FILE, PostgreSQL/Valkey ×2/Mailpit z izolowanego Compose i seed. CSP bez osłabienia; Firefox sprawdza zdarzenie naruszenia CSP zamiast angielskiej treści konsoli. Obrazy produkcyjne pozostają M0-2.

Deps-audit: OSV 2.6.0 + Syft 1.52.0, pobrania z przypiętym SHA-256, pokrycie 553 pakietów obu lockfile. High/critical blokują niezależnie od poprawki; wyjątki tylko OSV TOML (data decyzji, ryzyko, ≤90 dni). Błędy/nieznane licencje blokują; pełny raport i CycloneDX także po błędzie. 7 testów polityki PASS; parser uwzględnia wpisy plików w linuksowym SBOM. Next 16.3.6 po karencji usuwa critical; bez nowego wyjątku. Właściciel zatwierdził trzy licencje przechodnie, zakres i źródła w STACK §7. R-24 pozostaje pod kontrolą.

## Kontrola końca etapu — prompty-codex §5

| Kryterium M0 | Ocena i dowód |
|---|---|
| 1 | PASS techniczny: lokalnie 88/88 zadań monorepo; [CI i 6 buildów](https://github.com/Ipper18/OligInvest/actions/runs/36770589968), [granice/generator](https://github.com/Ipper18/OligInvest/actions/runs/36770589770) PASS |
| 2 | PASS: [db](https://github.com/Ipper18/OligInvest/actions/runs/36770589833), migracje, zero różnic, RLS, audyt i pule |
| 3 | PASS: [contracts](https://github.com/Ipper18/OligInvest/actions/runs/36770590162), OpenAPI/pending i typy klienta |
| 7 | NIE: pliki gotowe, ustawienia po scaleniu wykonuje właściciel. Odczyt GitHub: brak rulesetu, CodeQL tylko Python, merge/rebase nadal dostępne; [protokół](../07-wdrozenie/ustawienia-repozytorium.md#7-odczyt-kontrolny-agenta--2026-09-30) |

Na ff3f00f wszystkie kontrole PR zielone, w tym [E2E](https://github.com/Ipper18/OligInvest/actions/runs/36770589785), [audit](https://github.com/Ipper18/OligInvest/actions/runs/36770589787), [web](https://github.com/Ipper18/OligInvest/actions/runs/36770589830), [workers](https://github.com/Ipper18/OligInvest/actions/runs/36770589894) i natywny CodeQL (Python). Ostateczne kontrole po aktualizacji plików: zakładka Checks PR.

## Otwarte

BL-001–017/032–035 wykonane technicznie, statusy w toku do wspólnego DoD/przeglądu właściciela. BL-018 tylko M0-1, BL-019 tylko pliki i odczyt ustawień. M0 pozostaje otwarty: brak zielonego main, wydania/wdrożenia i infrastruktury M0-2, części spike’ów, przeglądu zagrożeń oraz ręcznych testów dostępności. JSON Schema zadań domenowych z analizami M3. OpenAPI/SQL/wzory/disclaimery bez zmian. Estymacje BL-017/018/019/035: 2/1/1/0,5 d bez zmian; nakład niezmierzony. Bez nowego ADR i nowych otwartych ryzyk.
