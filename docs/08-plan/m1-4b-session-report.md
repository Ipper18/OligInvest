# M1-4b — stan bieżący

**Cel:** przekazać stan BL-147/148/157/158/154/155 oraz części aplikacyjnej BL-152
i rozdzielić dowody automatyczne od odbioru bramy A przez właściciela.

**2026-10-13**, `feat/m1-4b-mvp-screens`, baza `origin/main` = `a8b17b0`.
Korekta kontraktu zatwierdzona przez właściciela 2026-10-13; implementacja wznowiona.
Zadania pozostają `todo`; nakład i odchylenie niezmierzone. Brama A otwarta.

## Zrobione i ustalenia

- Pobrano aktualny main; drzewo było czyste. Utworzono żądaną gałąź.
- M1-4a i import mBank są na main. Raporty zależności potwierdzają wykonanie
  lokalne; status `w toku` nie blokuje zależności według AGENTS.md § 6.1.
- Sprawdzono zakres paczki, roadmapę, dokumenty UI, monitoring oraz wybrane
  operacje i schematy OpenAPI. Nie zmieniono kodu, kontraktów ani zależności.
- Odczyty `getPortfolioSummary`, `getDayChange`, `listPositions`, `listLots`,
  `getCashBalances`, `getRealizedPl` są nadal w `apps/api/openapi-pending.json`.
  `modules/portfolio/src/server/routes.ts` obsługuje rachunki, operacje i importy;
  `livePortfolioValuation` zwraca zdarzenie SSE, nie pełne odpowiedzi REST.
  Ekrany BL-147 wymagają również implementacji tych odczytów z testami RLS
  i kontraktowymi, na istniejącym rdzeniu finansowym.

## Rozbieżność źródłowa — decyzja właściciela

`docs/02-api/openapi.yaml`, schema `Position` (wiersze 5165–5170):
`accountId` znajduje się w `required`, ale opis brzmi
„Brak przy groupBy=instrument.”. Operacja `listPositions` dopuszcza oba grupowania.
Odpowiedź dla agregacji instrumentu nie może spełnić obu zapisów jednocześnie.

Zatwierdzona i zastosowana korekta (osobny commit `docs:`):

```diff
-      required: [accountId, instrument, quantity, costBasis, marketValue, marketValueBase, weight, unrealizedPl, meta]
+      required: [instrument, quantity, costBasis, marketValue, marketValueBase, weight, unrealizedPl, meta]
```

Opis `accountId` wymaga pola przy `groupBy=account_instrument` i zabrania go
przy `groupBy=instrument`; agregacja nie wskazuje żadnego rachunku. Testy obu wariantów muszą egzekwować
warunek; następnie regeneracja klienta API i zgodność Zod/OpenAPI.
To korekta kontraktu, bez zmiany ADR. Koszt nieznany nadal oznacza `null`, nigdy 0.

## Brama A — stan dowodów

Nie uruchomiono nowych testów funkcjonalnych; nie potwierdzono zielonego CI
M1-4b. Wcześniejsze raporty są wskazówką, nie dowodem CI tej paczki.

| Kryterium | Dowód automatyczny do zebrania | Odbiór właściciela |
|---|---|---|
| 1. Uzgodnienie XTB | fixtures importu i FIFO w CI | realny plik poza repo; salda/ilości i P/L do 0,01 PLN lub wyjaśnienie |
| 2. Import → portfel < 2 min | E2E z rzeczywistym API w 3 przeglądarkach | pomiar na telefonie |
| 3. SSE i degradacja | aktualizacja ≤ 5 s, awaria adaptera, świeżość | harmonogram GPW/NBP na serwerze |
| 4. Wydajność | JS/Lighthouse 4 tras MVP, wykres ≤ 3000 punktów | płynność telefonu |
| 5. Bezpieczeństwo | MFA, step-up, sesje, RLS, audyt CLI | polecenia awaryjne na serwerze |
| 6. Dostępność | axe, klawiatura, tabela wykresu | protokół VoiceOver |
| 7. ADR-001 | brak pomiaru nakładu w raportach | porównanie kosztu core/importu z estymacją |

## Pozostałe prace i ryzyka

Implementacja paczki pozostaje do wykonania; rozbieżność kontraktu rozstrzygnięta.
BL-152 obejmie health-checki, metryki i raport błędów; sondy Kuma wykonuje
właściciel. Dodatkowy nakład na brakujące odczyty REST może zwiększyć estymację
BL-147. Nie wprowadzono nowej usługi, kosztu ani zmiany ADR.
Kontrole dokumentacji oraz jednorazowy końcowy odczyt CI: wynik w odpowiedzi sesji.
