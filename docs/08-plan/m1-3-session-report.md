# M1-3 — stan bieżący

**Cel:** przekazać stan BL-144/145/146/149 i pozostałe warunki PR #10.

**2026-10-10**, `feat/m1-3-portfolio`, [PR #10](https://github.com/Ipper18/OligInvest/pull/10).
Implementacje pozostają `w toku` do zielonego CI i wspólnego DoD; spełniają
zależności zgodnie z AGENTS.md § 6.1. Nakład/odchylenie niezmierzone.

## Zrobione

- BL-144/145/146: rachunki i operacje, parser obu szablonów XTB, atomowy import,
  uzgodnienie, przeliczenie FIFO/gotówki/wycen i SSE; dowody bazowe w opisie PR.
- BL-149: syntetyczne fixtures oraz lokalny anonimizator. Poprawka przeglądu:
  niezależne ceny z losową bazą i przebiegiem per instrument, losowe ilości,
  opłaty i kursy; kwoty z ilość × cena × kurs oraz osobne opłaty. Wpłaty pokrywają
  przyszłe deficyty z zapasem. Sprzedaże nie przekraczają syntetycznych zakupów.
  Nie ma globalnego mnożnika ani kopiowania rzeczywistych odstępów dat/godzin.
  Dni pon.–pt., kolejność w pliku, powiązania i formaty komentarzy zachowane.
  Historia bez wymaganych operacji początkowych jest odrzucana bez dodania
  wierszy. README i regresje zaktualizowane; realnych danych nie używano.
- Za zgodą właściciela anonimizator wykonano podczas karencji Caddy; osobny
  commit/push. Zmiana Caddy pozostaje projektem lokalnym, poza commitem.

## Weryfikacja

- Lint/typecheck/test portfela i zależnych API/jobs: 22 zadania PASS;
  portfolio 21 testów, API 92, jobs 11. Regresje anonimizacji: 7 PASS.
- Przy tej samej losowości zmiana cen, ilości, kwot i odstępów dat wejścia nie
  zmienia wyniku (trzy ziarna wyłącznie w testach). Próbka 480 zakupów: |r| < 0,25,
  ponad 400 różnych stosunków kwot. Oba szablony, chronologia odwrotna, pary
  sprzedaży/prowizji, dni robocze, gotówka, pozycje i ochrona plików PASS.
- Dotychczasowe PostgreSQL/RLS, migracje/schema, import/recompute i Valkey PASS
  udokumentowano w PR; ta poprawka nie zmienia kontraktów API/bazy ani kolejek.
- Ostatni odczyt CI przed poprawką: `images` FAIL (Caddy); pozostałe merytoryczne
  kontrole PASS. `matrix.name`/`matrix.check` pochodziły z anulowanego przebiegu
  38039086812 bez kroków. Nowy push wymaga weryfikacji CI; nie deklarujemy PASS.

## Caddy — następny krok

Obraz Caddy 2.11.7 nadal ma Go 1.26.8 (potwierdzone `build-info`). Poprawione
Go 1.26.9 / 1.27.2 wydano 8.10. Przypięty manifest Go 1.26.9 Alpine linux/amd64
opublikowano 8.10 o 18:04:50.073999262 UTC. Karencja kończy się
**11.10 o 20:04:51 Europe/Warsaw**. Projekt z digestami:
`.git/m1-3-caddy.Dockerfile.pending` — bez budowy/pusha przed tym terminem.
Potem: zastosować, uzupełnić INF/STACK, zbudować, sprawdzić Caddyfile i OSV bez
nowych wyjątków; po PASS osobny commit/push. Raport źródłowy CI pobrano do
`.git/m1-3-images-original/`; stary `reports/images/summary.md` był nieaktualny.

## Pozostałe warunki

Bramy M1 A/B otwarte: realny eksport właściciela, test telefonu i wdrożenie.
BL-147/148 (UI) to M1-4; mBank poza paczką. Przegląd właściciela przed publikacją
zanonimizowanego pliku nadal wymagany (ADR-013): sama struktura może identyfikować
szczególną historię. Nie ma nowego ADR; R-28 obejmuje blokadę obrazu, R-07/R-10
nadal wymagają pomiarów docelowych. Decyzje `null`, brutto dywidendy oraz fixture
AAPL −1083,91 PLN są wdrożone i nie wymagają ponownej zgody.
