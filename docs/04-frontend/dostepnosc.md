# Dostępność (WCAG 2.1 AA)

**Cel:** przełożyć wymagania dostępności (NFR-06.01–NFR-06.03, WCAG 2.1 AA) na konkretne reguły dla OligInvest — szczególnie dla danych finansowych, wykresów, aktualizacji na żywo i uwierzytelniania — oraz ustalić, jak zgodność jest testowana automatycznie i ręcznie.

Powiązane: [`system-projektowy.md`](system-projektowy.md) (kontrasty, formatowanie), [`architektura-ui.md`](architektura-ui.md) § 10–11, [`mapa-ekranow.md`](mapa-ekranow.md), [WCAG 2.1](https://www.w3.org/TR/WCAG21/), [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/).

## 1. Zakres i poziom

- **Cel obowiązkowy:** WCAG 2.1 poziom AA dla wszystkich ekranów użytkownika i panelu admina.
- **Cel dodatkowy (tanio osiągalny):** kryteria WCAG 2.2 AA — 2.4.11 (fokus niezasłonięty), 2.5.7 (alternatywa dla przeciągania), 2.5.8 (cel ≥ 24 × 24 px), 3.3.7 (bez ponownego wpisywania tych samych danych), 3.3.8 (uwierzytelnianie bez testów poznawczych).
- **Platformy testowe:** VoiceOver (iOS Safari w zainstalowanej PWA, macOS Safari), TalkBack (Android Chrome), NVDA (Windows, Firefox lub Chrome), obsługa wyłącznie klawiaturą.

## 2. Liczby i zmiany wartości

| Reguła | Realizacja |
|---|---|
| Zysk/strata nie tylko kolorem (1.4.1, NFR-06.02) | znak `+`/`-`, ikona ▲/▼ (`aria-hidden`), kolor z tokenów `gain`/`loss`, paleta dla daltonistów |
| Czytelny odczyt przez czytnik | `<ChangeValue/>` ma tekst ukryty wizualnie: „wzrost o 280,45 zł, 0,54%” / „spadek o …”; minus nie jest czytany jako „łącznik” |
| Skróty i terminy | `P/L`, `TWR`, `XIRR`, `VaR` przy pierwszym wystąpieniu na ekranie jako `<abbr title="…">` z rozwinięciem po polsku + `<Explainer/>` z linkiem do glosariusza (FR-06.02) |
| Waluta i jednostki | zawsze w treści (nie tylko w nagłówku kolumny) dla wartości czytanych poza tabelą |
| Wartości skrócone | `1,5 mln zł` w kafelku ma pełną wartość w opisie dostępnym |
| Formatowanie | `Intl` pl-PL ([`system-projektowy.md`](system-projektowy.md) § 5); `lang="pl"` na `<html>`, `lang="en"` na nazwach i tytułach newsów w języku angielskim (3.1.2) |

## 3. Wykresy (NFR-06.01)

1. **Tabela alternatywna dla każdego wykresu** — przełącznik „Pokaż jako tabelę” w `<ChartFrame/>`; tabela z tymi samymi danymi (po decymacji) i nagłówkami `<th scope>`.
2. **Opis tekstowy** — pod tytułem jedno-dwa zdania generowane z danych, np. „Wartość portfela od 1 stycznia 2026 wzrosła o 12,3%; największe obsunięcie −8,1% w marcu.” (powiązane przez `aria-describedby`).
3. **Canvas jako grafika** — element `<canvas>` ma `role="img"` i nazwę dostępną (tytuł wykresu); interakcje (celownik, powiększanie) mają odpowiedniki klawiaturowe: strzałki przesuwają celownik po świecach, `+`/`-` powiększa, `Home`/`End` skrajne punkty; wartość pod celownikiem ogłaszana w regionie `aria-live="polite"` z opóźnieniem 300 ms.
4. **Kontrast elementów graficznych ≥ 3:1** (1.4.11) — kolory z [`system-projektowy.md`](system-projektowy.md) § 2.3–2.4; linie serii ≥ 2 px; seria benchmarku dodatkowo linią przerywaną (nie tylko kolor).
5. **Heatmapa** — kafelki są elementami HTML z tekstem (ticker, zmiana ze znakiem); nawigacja strzałkami po siatce (wzorzec `grid` z APG); alternatywa: lista sektorów posortowana wg zmiany.
6. **Wachlarz Monte Carlo** — tabela percentyli dla lat 1, 5, 10 i końca horyzontu; opis „w 5% scenariuszy wartość końcowa jest niższa niż …” (lewy ogon najpierw).
7. **Animacje** — wyłączone przy `prefers-reduced-motion: reduce` (2.3.3 jako dobra praktyka); brak migotania.

## 4. Aktualizacje na żywo

| Zdarzenie | Zachowanie dla czytnika ekranu |
|---|---|
| Nowe kursy i wycena (SSE) | **bez ogłaszania** (`aria-live` wyłączone) — ciągłe ogłoszenia uniemożliwiają pracę; wartość aktualna przy następnym odczycie |
| Zmiana stanu danych na „nieaktualne” | jednorazowe ogłoszenie `role="status"` (FR-01.15) |
| Wyzwolony alert w aplikacji | `role="status"` (grzecznie); alerty krytyczne (bezpieczeństwo) `role="alert"` |
| Postęp analizy | `role="progressbar"` z `aria-valuenow`; ogłoszenie tylko zakończenia lub błędu |
| Zakończenie importu | `role="status"` z podsumowaniem („118 nowych, 4 duplikaty, 1 do rozstrzygnięcia”) |

Użytkownik może wstrzymać automatyczne odświeżanie danych (2.2.2) — przełącznik „Wstrzymaj aktualizacje” w nagłówku ekranów z danymi na żywo.

## 5. Formularze i uwierzytelnianie

- Każde pole ma widoczną etykietę `<label>`; wskazówki formatu („np. 58,34”) w opisie powiązanym `aria-describedby`; błędy przy polu i w podsumowaniu na górze formularza z linkami do pól (3.3.1, 3.3.3); fokus przenoszony na podsumowanie po nieudanym wysłaniu.
- Atrybuty `autocomplete` (1.3.5): `email`, `username`, `current-password`, `new-password`, `one-time-code`, `name`.
- **TOTP bez barier (3.3.8):** wklejanie dozwolone, jedno pole na 6 cyfr (nie 6 osobnych pól), brak limitu czasu na wpisanie poza ważnością kodu; menedżery haseł i autouzupełnianie kodów z SMS/aplikacji systemu działają.
- **Limity czasu (2.2.1):** wygaśnięcie sesji zapowiadane 2 min wcześniej z opcją przedłużenia; step-up (15 min) nie przerywa wpisywania — kod pytany dopiero przy wysłaniu.
- Klawiatura dziesiętna na telefonie (`inputmode="decimal"`), akceptacja przecinka i kropki.
- Formularze etapowe (analizy, import) zachowują wpisane dane przy powrocie do poprzedniego kroku (3.3.7).
- Działania nieodwracalne (usunięcie rachunku, konta, operacji) wymagają potwierdzenia z nazwą obiektu (3.3.4).

## 6. Klawiatura i fokus

- Kolejność fokusu zgodna z kolejnością wizualną; link „Przejdź do treści” jako pierwszy element (2.4.1).
- Widoczny fokus: obrys 2 px `--color-focus` z odsunięciem 2 px (kontrast 5,87:1 / 7,03:1); nigdy `outline: none` bez zamiennika (2.4.7).
- Okna `<dialog>`: fokus na pierwszym polu lub tytule, `Esc` zamyka, fokus wraca do wyzwalacza; tło `inert`.
- Menu, combobox, zakładki, siatka heatmapy — wzorce WAI-ARIA APG (strzałki, `Home`/`End`, pierwsza litera).
- Skróty jednoklawiszowe (`/` — wyszukiwarka) tylko, gdy fokus nie jest w polu tekstowym, z możliwością wyłączenia (2.1.4).
- Dolny pasek nawigacji i baner offline nie zasłaniają elementu z fokusem (2.4.11) — `scroll-padding-bottom` równy wysokości paska.
- Alternatywy dla gestów: przeciąganie (kolejność watchlisty) ma przyciski „w górę/w dół”; szczypanie na wykresie ma przyciski powiększenia (2.5.1, 2.5.7).

## 7. Struktura i nawigacja

- Jeden `<h1>` na ekran, hierarchia nagłówków bez przeskoków; punkty orientacyjne `<header>`, `<nav>` (z `aria-label` dla nawigacji głównej i podsekcji), `<main>`, `<footer>`.
- Tytuł dokumentu per trasa: „Portfel — OligInvest”, „PKO BP — Rynek — OligInvest” (2.4.2); zmiana trasy klienckiej ogłaszana (Next.js App Router ogłasza zmianę trasy; weryfikacja w testach).
- Tabele danych: `<caption>`, `<th scope="col|row">`, `aria-sort` przy sortowaniu; tabele wirtualizowane zachowują `aria-rowcount` i `aria-rowindex`.
- Linki opisowe („Zobacz historię dywidend PKO”), nie „kliknij tutaj”; linki zewnętrzne z informacją „(otwiera nową kartę)”.

## 8. Wygląd i responsywność

- Kontrasty tokenów: [`system-projektowy.md`](system-projektowy.md) § 2 (tekst ≥ 4,5:1, grafika ≥ 3:1) — test w CI.
- Przepływ treści przy 320 px szerokości bez przewijania w poziomie (1.4.10) — z wyjątkiem tabel danych i wykresów, które mają własne przewijanie w kontenerze.
- Powiększenie tekstu 200 % bez utraty treści (1.4.4); odstępy tekstu użytkownika nie łamią układu (1.4.12).
- Orientacja pionowa i pozioma (1.3.4); cele dotykowe ≥ 44 × 44 px na telefonie.
- Motyw ciemny i paleta dla daltonistów w preferencjach (FR-07.08); respektowanie `prefers-color-scheme` i `prefers-reduced-motion`.

## 9. Onboarding i treści edukacyjne

- driver.js: każdy krok jest dostępny z klawiatury, `Esc` kończy, przycisk „Pomiń” zawsze widoczny; onboarding nigdy nie blokuje aplikacji (FR-06.01). Przed M5 audyt dostępności wyskakujących okien driver.js z VoiceOver — ❓ jeśli zawiodą, zastąpienie własnym `<dialog>` ze wskazaniem elementu.
- Treści edukacyjne prostym językiem (NFR-06.03): zdania do ~20 słów, wyjaśnienie terminu przy pierwszym użyciu, przykłady w złotych.
- Tryb demo wyraźnie oznaczony tekstem, nie tylko kolorem.

## 10. Testy

| Test | Narzędzie | Kiedy | Kryterium |
|---|---|---|---|
| Automatyczny audyt ekranów | `@axe-core/playwright` 4.13 w E2E (reguły WCAG 2.0/2.1 A i AA) | każdy PR | 0 naruszeń `serious` i `critical` |
| Kontrast tokenów | skrypt CI ([`system-projektowy.md`](system-projektowy.md) § 8) | każdy PR | progi z § 2 |
| Klawiatura | Playwright: przejście ścieżek krytycznych wyłącznie klawiszem Tab/Enter/strzałkami | każdy PR | każda akcja osiągalna, fokus widoczny |
| Tabele alternatywne | test komponentu `<ChartFrame/>` | każdy PR | każdy wykres ma tabelę i opis |
| Czytniki ekranu | ręcznie: VoiceOver iOS (PWA), TalkBack, NVDA | koniec każdego etapu (M1–M6) | scenariusze: logowanie z TOTP, odczyt portfela, dodanie operacji, odczyt wykresu przez tabelę, alert |
| Powiększenie i reflow | ręcznie: 200 % i 320 px | koniec etapu | brak utraty treści |

Automatyczne testy wykrywają tylko część problemów; test ręczny z czytnikiem ekranu jest kryterium wyjścia etapów w `08-plan/roadmapa.md` (Krok 6).

## 11. Znane ograniczenia

- **Canvas wykresów** nie jest dostępny sam w sobie — dostępność zapewniają opis, tabela i obsługa klawiatury (§ 3).
- **Web Push na iOS** — treść powiadomienia czyta system; akcje w powiadomieniu ograniczone przez platformę.
- **Aplikacje zewnętrzne** (Skróty iOS, HTTP Shortcuts, Scriptable) — dostępność zależy od tych aplikacji; odpowiedzi tekstowe z API są krótkie i czytelne dla VoiceOver i Siri ([`../05-mobile/ios-integracje.md`](../05-mobile/ios-integracje.md)).
