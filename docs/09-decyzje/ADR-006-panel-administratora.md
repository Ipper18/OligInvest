# ADR-006: Panel administratora w aplikacji (leniwa trasa `/admin`), moduły dokładają własne panele

- **Status:** zaakceptowana
- **Data:** 2026-09-18
- **Decydent:** właściciel projektu
- **Powiązane wymagania:** FR-08.01–FR-08.10, NFR-01.02, NFR-01.03, NFR-02.02

## Kontekst

Specyfikacja: panel admina (użytkownicy, sesje, limity API, flagi, audyt, status integracji, kolejki, health-checki) i zakaz pisania go od zera — do oceny Refine, React-Admin, AdminJS, Directus. Jednocześnie obowiązuje budżet initial JS < 200 KB i architektura modułowa. Użytkowników jest kilku; admin to właściciel.

## Rozważane opcje

| Opcja | Zalety | Wady |
|---|---|---|
| **Minimalny panel w aplikacji** z gotowych klocków: TanStack Table, formularze, endpointy Better Auth `admin`, API platformy (flagi, audyt), metryki BullMQ | Wspólne uwierzytelnianie i 2FA; ładowany leniwie tylko na `/admin`; moduły dokładają panele przez punkt rozszerzeń | Ekrany trzeba złożyć samemu (ale z gotowych komponentów) |
| Refine (headless, `@refinedev/core` 5.0) w `/admin` | Gotowe wzorce CRUD, dostawcy danych | Kolejna warstwa abstrakcji; ~40 KB+ w chunku admina |
| react-admin 5 | Dojrzały | Z MUI 250–400 KB; styl odmienny od aplikacji |
| AdminJS / Directus | Kompletne panele | Osobna aplikacja i serwer (duplikacja auth, RAM), Directus na licencji BSL |
| Bull Board (UI kolejek) | Gotowy podgląd BullMQ | Osobny UI z własnym uwierzytelnianiem — tylko jako narzędzie awaryjne przez tunel SSH |

## Decyzja

**Minimalny panel w aplikacji** na trasie `/admin`, ładowany leniwie (osobny chunk, NFR-01.03), dostępny wyłącznie dla roli `admin` z aktywnym step-up TOTP dla zmian. Powłoka (`modules/admin`) zawiera: użytkowników i zaproszenia (API Better Auth `admin`), sesje, flagi, audit log, kolejki (liczniki i ponawianie przez API BullMQ), health i wersje usług, limity ról. Pozostałe moduły **dokładają własne panele** przez `adminPanels` w `UiModuleDefinition` i własne trasy `/api/v1/admin/<moduł>` (np. `market`: status dostawców i kwoty, ręczny import notowań). **Refine headless** pozostaje w rezerwie — przyjmiemy go (ADR-zmiana), jeśli liczba ekranów CRUD admina przekroczy ~10. Panel nie daje wglądu w dane finansowe użytkowników (FR-08.01).

## Konsekwencje

- Pozytywne: zero wpływu na bundle zwykłych użytkowników; jedna ścieżka bezpieczeństwa; zgodność z modułowością (moduł usunięty = jego panel znika).
- Negatywne: kilka ekranów do złożenia; brak „magii” CRUD.
- Zadania: powłoka admina + zaproszenia i role (M1, minimalnie), reszta ekranów (M5a).

## Weryfikacja

Analiza buildu: chunk `/admin` nie jest ładowany na trasach użytkownika; każda trasa `/api/v1/admin/*` zapisuje audyt (test).
