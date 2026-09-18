# ADR-001: Baza projektu — fork istniejącej aplikacji OSS czy budowa własna

- **Status:** zaakceptowana
- **Data:** 2026-09-18
- **Decydent:** właściciel projektu
- **Powiązane wymagania:** FR-01…FR-06 (funkcje rdzeniowe), NFR-01 (wydajność), NFR-02 (modularność), NFR-05 (budżet 0 zł)

## Kontekst

Zadanie wymaga, by przed budową czegokolwiek sprawdzić istniejące, darmowe rozwiązania open source. Przejrzano aplikacje do śledzenia portfela i finansów osobistych pod kątem: licencji, stosu, aktywności, możliwości użycia jako bazy lub zapożyczenia modułu. Kryteria twarde: stos zgodny z decyzjami Kroku 0 (TypeScript + Python worker, Next.js PWA, Postgres z RLS), budżet wydajnościowy (initial JS < 200 KB gzip), prywatny self-hosting na współdzielonym i5-4590, rynek GPW + PLN jako waluta bazowa.

## Rozważane opcje (dane z GitHub REST API, 2026-09-18)

| Projekt | Licencja | Stos | Aktywność | Da się użyć jako baza? | Co zapożyczyć (projekt, nie kod) |
|---|---|---|---|---|---|
| [Ghostfolio](https://github.com/ghostfolio/ghostfolio) | AGPL-3.0 | Angular + NestJS + Prisma + Nx (TS) | 9,3 tys. ★, push 2026-09-18 | ❌ Angular (nie React/Next), NestJS zamiast cienkiego Hono, brak RLS, bundle Angulara przekracza budżet; AGPL wymusza udostępnianie źródeł użytkownikom sieciowym | ✅ model `Activity` (BUY/SELL/DIVIDEND/FEE/INTEREST), warstwa `DataProvider` (Yahoo/CoinGecko/EODHD/FMP/Alpha Vantage jako adaptery z tą samą sygnaturą), format importu CSV, liczenie ROAI/TWR |
| [Maybe Finance](https://github.com/maybe-finance/maybe) | AGPL-3.0 | Ruby on Rails | **archiwum od 2025-07-24** | ❌ martwy projekt | — |
| [Firefly III](https://github.com/firefly-iii/firefly-iii) | AGPL-3.0 | PHP (Laravel) | 24,7 tys. ★, aktywny | ❌ budżet domowy, nie inwestycje; PHP | reguły importu i kategoryzacji transakcji (UX) |
| [OpenBB](https://github.com/OpenBB-finance/OpenBB) | AGPL-3.0 wg README (GitHub: NOASSERTION — **NIEZWERYFIKOWANE** w pełni) | Python (platforma danych) | 73 tys. ★, aktywny | ❌ ciężka platforma Pythona; nie jest aplikacją portfelową | ✅ standaryzowane modele danych dostawców (`EquityHistorical`, `EquityQuote`) jako wzorzec dla `packages/data-providers`; ewentualnie użycie w workerze do jednorazowych pobrań — odrzucone przez rozmiar zależności |
| [Wealthfolio](https://github.com/wealthfolio/wealthfolio) | AGPL-3.0 | Rust + Tauri (desktop, local-first) | 9 tys. ★, aktywny | ❌ aplikacja desktopowa, nie web | ✅ UX importu CSV z mapowaniem kolumn, model kont/aktywności, obsługa wielu walut |
| [Portfolio Performance](https://github.com/portfolio-performance/portfolio) | EPL-1.0 | Java (desktop) | 4 tys. ★, aktywny | ❌ Java desktop | ✅ dokumentacja metodologii TWR/IRR i raportów; lista źródeł notowań (w tym europejskich) |
| [rotki](https://github.com/rotki/rotki) | AGPL-3.0 | Python + Vue (desktop/self-host) | 4 tys. ★, aktywny | ❌ krypto-centryczny, Vue | ✅ rozliczenia cost basis per jurysdykcja (FIFO/LIFO/ACB) — wzorzec dla polskiego FIFO |
| [Investbrain](https://github.com/investbrainapp/investbrain) | NOASSERTION (**NIEZWERYFIKOWANE**) | PHP (Laravel) | 0,9 tys. ★ | ❌ mały, PHP | pomysł: LLM-owe podsumowania newsów (poza MVP) |

## Decyzja

**Budujemy własną aplikację na wybranym stosie; nie forkujemy żadnego projektu.** Uzasadnienie w jednym akapicie: żaden z kandydatów nie łączy React/Next.js PWA, cienkiego API w TypeScript i Postgresa z RLS — trzy wymagania, które bezpośrednio wynikają z budżetu wydajnościowego (NFR-01) i z wymogu, by dane finansowe były chronione na poziomie bazy (NFR-03); adaptacja Ghostfolio (najbliższy funkcjonalnie) oznaczałaby przepisanie frontendu z Angulara i wymianę NestJS/Prisma, czyli więcej pracy niż budowa od zera przy jednoczesnym dziedziczeniu AGPL i cudzych decyzji; pozostałe projekty to aplikacje desktopowe, budżetowe lub krypto. Zapożyczamy natomiast **projekty** (nie kod): model aktywności i interfejs dostawców z Ghostfolio, standard modeli danych z OpenBB, UX importu z Wealthfolio, metodologię wyników z Portfolio Performance i podejście do cost basis z rotki — każde zapożyczenie odnotowane w odpowiednim dokumencie `docs/`.

## Konsekwencje

- Pozytywne: pełna kontrola nad wydajnością, RLS, modelem domenowym pod GPW/PLN i polskie podatki; brak zobowiązań AGPL; stos spójny z `packages/core` współdzielonym przez PWA i worker.
- Negatywne / dług: więcej kodu własnego w M1–M3 (import, wycena, TWR/XIRR) — mitygacja: testy referencyjne vs empyrical/TA-Lib i skille `backtest-review`/`risk-report`; brak gotowego ekosystemu wtyczek (Ghostfolio) — mitygacja: własny rejestr modułów (`01-architektura/moduly.md`).
- Zadania: przenieść do `03-dane/model-danych.md` model aktywności wzorowany na Ghostfolio; zdefiniować interfejs `DataProvider` w `03-dane/strategia-cache.md`; opisać mapowanie CSV w `12-dla-uzytkownika/instrukcja.md`.

## Weryfikacja

Po etapie M1 (MVP): import XTB + wycena + P/L działają na realnym wyciągu właściciela; jeśli koszt implementacji `core` przekroczy 2× estymację z backlogu, wrócić do tej decyzji i rozważyć osadzenie Ghostfolio API jako usługi pomocniczej.
