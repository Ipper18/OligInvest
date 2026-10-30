# M4-PWA — uzupełnienie kontraktu subskrypcji

**Cel:** przedstawić właścicielowi rozbieżność API–SQL i brakujący odczyt klucza publicznego przed implementacją BL-402.

Stan: zatwierdzone przez właściciela w rozmowie, 2026-10-28.

1. `PushSubscriptionCreate` w `docs/02-api/openapi.yaml` przyjmuje `deviceLabel` i `expirationTime`; `PushSubscription` zwraca `deviceLabel`. Tabela `notifications.push_subscriptions` w `docs/03-dane/schema.sql` nie ma kolumn dla tych danych. Propozycja: dodać nullable `device_label text` i `expires_at timestamptz`, zgodną migrację i odwzorowanie Drizzle. `expirationTime` to liczba milisekund Unix z Push API; `null`/brak oznacza brak znanej daty. Wygasła data wyklucza subskrypcję z wysyłki; 404/410 nadal usuwa ją automatycznie. Istniejące RLS pozostaje bez zmian; testy obejmą izolację nowych pól.
2. API ma cztery operacje subskrypcji, ale nie określa sposobu przekazania przeglądarce publicznego klucza VAPID potrzebnego przed `subscribe`. Propozycja: `GET /api/v1/notifications/push-config` (`getPushConfiguration`), sesja/MFA/regulamin, `Cache-Control: no-store`, odpowiedź `200 { publicKey: string | null }`, błędy 401/403. `null` oznacza brak konfiguracji. Tylko publiczny klucz z konfiguracji API; prywatny pozostaje w jobs. Oba klucze wdrażane przez `*_FILE`, puste wpisy w `.env.example`.

Nie wymaga to zmiany ADR-010 ani nowej usługi. Po zatwierdzeniu zmieniono źródła kontraktu przed testami i kodem; migracja `0009` i testy PostgreSQL potwierdzają zgodność schematu oraz izolację właścicieli.
