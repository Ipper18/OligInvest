# Przegląd skryptów instalacyjnych M0-1

**Cel:** uzasadnić każdą decyzję `allowBuilds` dla pierwszego lockfile BL-001, bez osłabiania karencji ani automatycznej zgody na przyszłe wersje.

Sprawdzono 2026-09-21: metadane rejestru, archiwa npm po porównaniu SHA-512 z lockfile, `package.json` i wskazane skrypty. [Porównanie grafu](audits/m0-1-lockfile-comparison.json) zapisuje wersje, sumy, publikacje i polecenia. Konfiguracja pozostawia `strictDepBuilds: true`, `minimumReleaseAge: 4320`, `trustPolicy: no-downgrade` i `blockExoticSubdeps: true`.

| Pakiet | Decyzja | Uzasadnienie |
|---|---|---|
| `pnpm@12.4.2` | zezwolenie | `install.js` łączy lokalne binarium właściwej platformy z wrapperem; ponowne tworzenie globalnych shimów dotyczy wyłącznie globalnej instalacji przez npm, której nie wykonujemy. |
| `esbuild@0.18.20`, `0.25.12`, `0.28.2` | zezwolenie | `install.js` wybiera opcjonalne binarium platformowe i sprawdza jego wersję, potrzebne narzędziom build/test i Drizzle Kit. Binaria są w lockfile i przeszły karencję. Nie pomijać optional dependencies: brak binarium uruchamia zapasowe pobieranie przez npm/rejestr; taki przypadek wymaga zatrzymania i wyjaśnienia. |
| `fsevents@2.3.3` | odmowa | Opcjonalna optymalizacja obserwowania plików na macOS; budowanie przez `node-gyp` zbędne dla szkieletu Windows/Linux. |
| `msgpackr-extract@3.0.4` | odmowa | Opcjonalny akcelerator ma osobno przypięte binaria platformowe i fallback JS w msgpackr. Skrypt może uruchomić lokalną kompilację; nie jest potrzebna do testów szkieletu. |

Zgody dotyczą dokładnych wersji. Aktualizacja wymaga ponownego przeglądu, zgodnie z [dokumentacją `allowBuilds`](https://github.com/pnpm/pnpm.io/blob/main/versioned_docs/version-10.x/settings.md#allowbuilds). Nie użyto `ignore-scripts`, `dangerouslyAllowAllBuilds`, wyjątków karencji ani overrides dla parsera. Wycofane zależności `@esbuild-kit/*` pozostają ryzykiem R-24; ta decyzja nie zastępuje audytu podatności.
