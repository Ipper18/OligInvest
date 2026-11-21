# BL-406 i BL-563 — alerty i cele alokacji

**Cel:** udostępnić reguły cenowe i portfelowe, podgląd komunikatu oraz historię doręczeń w UI PL/EN.

Cztery operacje celów używają kontekstu użytkownika i RLS. Wagi i tolerancja są ciągami dziesiętnymi. API wymaga sumy dokładnie 1. Alert odchylenia wskazuje cel przez identyfikator. Zmiana lub usunięcie celu wyłącza regułę w transakcji i zapisuje przyczynę dla UI. BL-315 obejmuje dalsze prace nad kalkulatorem.

Test bazy na PostgreSQL 18 przeszedł razem z RLS, izolacją celów, zmianą i usunięciem celu oraz porównaniem migracji ze schematem (zero różnic). Kontrola OpenAPI: 113 wdrożonych operacji i 74 oczekujące. Testy progów, histerezy, deduplikacji, cooldownu i braku danych przeszły lokalnie.

Status roboczy do zakończenia weryfikacji przeglądarek i CI. Estymaty 2 i 1,5 dnia, nakład niezmierzony. M4 pozostaje otwarty.
