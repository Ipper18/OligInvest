# ADR-019: Niezależna bramka jakości i auto-merge niskiego ryzyka

**Cel:** dopuścić w przyszłości automatyczne scalanie pojedynczego PR z aktualnymi i niezależnymi dowodami.

- **Status:** proponowana
- **Data:** 2026-11-22
- **Decydent:** właściciel projektu
- **Zakres:** MERGEGATE-1, ryzyka R-11, R-23 i R-42.

## Kontekst i wybór

Agenci korzystają ze wspólnego konta GitHub. Prefiks roli, komentarz, etykieta ani nazwa zielonego checka nie potwierdzają nadawcy. Obecnie każdy PR scala właściciel zgodnie z [ADR-018](ADR-018-autonomia-zespolu.md). Scalenie projektu ADR zatwierdza przygotowanie mechanizmu. Dopiero udokumentowana aktywacja zastąpi akapit ADR-018 o ręcznym scalaniu, wyłącznie dla LOW.

Proponujemy oddzielić zbieranie faktów, podpisywanie ocen, obliczenie decyzji i wykonanie scalenia. Komentarze odrzucono jako źródło dowodów. Workflow z samym GITHUB_TOKEN nie odróżnia dwóch agentów ani dowolnych zadań tej samej aplikacji. Preferowany jest izolowany proces poza środowiskiem autora z osobną tożsamością publikującą wynik. Właściciel wybiera sposób wdrożenia.

## Warunki i konsekwencje

Pierwsza lista LOW obejmuje tylko zwykłe modyfikacje instrukcji użytkownika i samouczków. Rozszerzenie listy, zmiana testów, ADR, bramki lub jej zależności wymaga właściciela. Treść obu dokumentów nadal oceniają obie role. Przy braku dostępu do niezależnych źródeł obowiązuje ręczne scalanie.

[Procedura wdrożenia i prób odbiorczych](../07-wdrozenie/agent-merge-gate.md) określa granice zaufania, wymagane uprawnienia, unieważnianie oraz wycofanie. Do czasu odbioru wynik pozytywny służy wyłącznie próbie lokalnej.

Aktywacja wymaga, aby po odbiorze właściciel zmienił status ADR-019 na „przyjęta”. Dopóki odwołanie oceny może wyprzedzić unieważnienie wyniku w GitHubie, scalenie pozostaje ręczne.
