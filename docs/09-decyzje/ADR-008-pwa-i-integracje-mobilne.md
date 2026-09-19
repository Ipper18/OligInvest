# ADR-008: PWA z własnym service workerem; integracje iOS przez Skróty i Android przez HTTP Shortcuts, na API z tokenami PAT

- **Status:** zaakceptowana
- **Data:** 2026-09-18
- **Decydent:** właściciel projektu (iPhone bez konta Apple Developer — Krok 0)
- **Powiązane wymagania:** FR-09.01–FR-09.08, FR-05.06, FR-07.07, NFR-04.01–NFR-04.03, Z-06, Z-07, Z-08

## Kontekst

Specyfikacja (§4.4): PWA (instalowalna, offline shell, push) oraz analiza PWA vs Capacitor vs React Native/Expo przy kryteriach: koszt 0, push, widżety, czas wdrożenia, konto Apple Developer (99 USD/rok). Na iOS oczekiwane są akcje w Skrótach (App Intents / URL scheme / x-callback-url) spinane z Back Tap, automatyzacjami, Siri i widżetami ekranu blokady; na Androidzie widżety, kafelek Szybkich ustawień, deep linki i Tasker. Właściciel używa głównie iPhone’a i nie ma konta Apple Developer.

Ustalenia (2026-09-18):
- Web Push działa w PWA dodanej do ekranu początkowego od iOS 16.4 (WebKit). W UE Apple w lutym 2024 r. zapowiedział usunięcie aplikacji webowych z ekranu początkowego (DMA), a 1 marca 2024 r. wycofał się — PWA i push działają w Polsce, ale polityka może się zmienić (Z-08).
- App Intents, własny schemat URL i x-callback-url wymagają aplikacji natywnej; PWA na iOS nie rejestruje schematu URL, a linki otwierane ze Skrótów trafiają do Safari.
- Skróty iOS mają akcję „Pobierz zawartość URL” (metoda, nagłówki, JSON) — można nią wywołać nasze API z tokenem; skróty uruchamia Stuknięcie w tył, Siri, automatyzacje i widżet Skrótów.
- Scriptable (darmowa) buduje widżety ekranu głównego i blokady z danych JSON, ale ostatnia wersja pochodzi z 2024-09 (ryzyko porzucenia).
- HTTP Shortcuts (Android, MIT, Google Play i F-Droid) obsługuje widżety, kafelki Szybkich ustawień, uwierzytelnianie Bearer i wyświetlanie odpowiedzi. Tasker jest płatny (jednorazowo ok. 3,5–4,5 USD).
- Next.js 16 ma oficjalny przewodnik PWA: `app/manifest.ts`, własny `public/sw.js` (push, `notificationclick`), `web-push` po stronie serwera — bez dodatkowych bibliotek.

## Rozważane opcje

| Kryterium | **PWA + Skróty/HTTP Shortcuts** | Capacitor | React Native / Expo |
|---|---|---|---|
| Koszt | **0 zł** | iOS: konto Apple Developer 99 USD/rok (bez niego podpis darmowy na 7 dni — niepraktyczne) | jak Capacitor |
| Push | Web Push (iOS ≥ 16.4 po instalacji; Android; desktop) | natywny APNs/FCM | natywny |
| Widżety z danymi | pośrednio: Scriptable (iOS), HTTP Shortcuts (Android) | natywne (WidgetKit wymaga kodu Swift) | natywne (moduły natywne) |
| Skróty / Siri / Back Tap | przez „Pobierz zawartość URL” + PAT | App Intents (natywnie) | App Intents (natywnie) |
| Czas wdrożenia | najkrótszy — ta sama aplikacja webowa | + projekt natywny, podpisywanie, dystrybucja | nowy frontend |
| Współdzielenie `packages/core` | pełne | pełne (web view) | częściowe (RN bez DOM) |

## Decyzja

1. **PWA** jako jedyna aplikacja mobilna i desktopowa: manifest z Next.js, **własny service worker** (push, kliknięcie powiadomienia, cache powłoki offline: zasoby `/_next/static/*` cache-first, nawigacje network-first z zapasową stroną offline, ostatni stan dashboardu w IndexedDB dla FR-09.02). Bez Serwist/Workbox.
2. **API szybkich akcji** (`/api/v1/quick/*`, moduł `quick-actions`, oraz `/api/v1/quick/alerts` z modułu `alerts`) z odpowiedziami `text/plain` lub JSON, uwierzytelniane **PAT** (ADR-004).
3. **iOS:** gotowe Skróty (udostępniane linkiem iCloud) — „Pokaż mój portfel”, „Ile dziś zarobiłem”, „Dodaj transakcję”, „Moje alerty” — plus instrukcja podpięcia pod Stuknięcie w tył, Siri, automatyzacje i widżet Skrótów ([`../05-mobile/ios-integracje.md`](../05-mobile/ios-integracje.md), [`../12-dla-uzytkownika/instrukcja.md`](../12-dla-uzytkownika/instrukcja.md) § 9). Widżety z danymi: opcjonalny skrypt Scriptable (P3).
4. **Android:** skróty aplikacji w manifeście (`shortcuts`), zainstalowana PWA obsługuje linki w swoim zakresie, konfiguracje HTTP Shortcuts (widżet, kafelek) do zaimportowania; Tasker opisany jako opcja płatna.
5. **Ryzyka iOS** (zmiana polityki PWA w UE, brak gwarancji doręczenia push) mitygujemy dublowaniem alertów krytycznych e-mailem (ADR-010) i monitorowaniem w rejestrze ryzyk.

## Konsekwencje

- Pozytywne: 0 zł, jeden kod, najkrótsza droga do telefonu; Skróty działają bez otwierania aplikacji (odpowiedź tekstowa).
- Negatywne: brak natywnych App Intents i widżetów WidgetKit; UX instalacji PWA na iOS wymaga instrukcji; zależność od aplikacji firm trzecich dla widżetów.
- Koszt ścieżki natywnej i co tracimy bez niej — w [`../10-ograniczenia.md`](../10-ograniczenia.md) (L-20).
- Zadania: manifest + service worker + push (M4), API szybkich akcji + PAT (M4), Skróty iOS i konfiguracje HTTP Shortcuts (M4), powłoka offline (M4), migawka portfela offline (M5b).

## Weryfikacja

Na fizycznym iPhonie (aktualny iOS) i Androidzie: instalacja PWA, doręczenie testowego powiadomienia, uruchomienie każdego skrótu przez Stuknięcie w tył i Siri, odpowiedź < 300 ms po stronie serwera (FR-09.04).
