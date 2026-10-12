# BL-208 — stan bieżący

**Cel:** przekazać stan importu mBank eMakler (BL-208) i warunki zamknięcia [PR #13](https://github.com/Ipper18/OligInvest/pull/13).

**2026-10-12**, `feat/bl-208-mbank-import`, Claude Code. Status w backlogu: `w toku` do zielonego CI
i wspólnego DoD. Nakład/odchylenie niezmierzone.

## Zrobione

- Parser `modules/portfolio/src/import/mbank.ts`: historia transakcji i finansowa (CSV cp1250/UTF-8,
  `;`/`,`, polskie liczby i daty), kwoty `Decimal` z jawnym PLN, obliczenia przez `packages/core`.
- Ten sam potok i kontrakt API co XTB; jeden plik = jeden import (`mbank.transactions` /
  `mbank.financial`). `auto` wg `broker` rachunku; upload za flagą `module.portfolio.import.mbank`.
- Mapowanie po nazwie w obrębie MIC z kandydatami (`ImportRow.candidates`), podpowiedzi ISIN z
  rozliczeń `WYC`, zapamiętane przypisania rozstrzygają pozostałe wiersze importu.
- Idempotencja z pól znormalizowanych; uzgodnienie gotówki tylko dla historii finansowej.
- Szczegóły: [`formaty-importu.md`](../03-dane/formaty-importu.md) § 3.3.

## Weryfikacja

- Portfolio 30 testów (9 mBank), API 92, OpenAPI 25, jobs 11; `tsc`, Biome, `check:deps`,
  `check:docs`, `check:repository` OK; `openapi.mjs check` bez zmian kontraktu.
- `db:test` PASS z nowym `apps/api/integration/mbank-imports.mjs`; schemat bez różnic.
- Ograniczenie sesji: `cdn.sheetjs.com` zablokowany polityką sieci — lokalnie `xlsx@0.18.5`
  podpięty symlinkiem poza repo; PostgreSQL z `mirror.gcr.io` (ten sam digest). Dowód końcowy: CI.

## Otwarte

- CI PR #13 (pierwszy przebieg po pushu).
- Realny eksport właściciela (roadmapa M2 pkt 3): kody giełd, waluta `Wartość` dla rynków
  zagranicznych, opisy prowizji/podatków w historii finansowej — oznaczone ❓ w § 3.3.
- Do akceptacji właściciela: `415` przy wyłączonej fladze; propagacja zapamiętanego mapowania
  na inne wiersze importu (dotyczy też XTB). Brak nowych ADR i ryzyk (R-08).
- `apps/web` nietknięte (ekrany M1-4b — Codex).
