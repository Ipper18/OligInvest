# ADR-011: Topologia — VM na Proxmoxie, VPS jako niezaufany przekaźnik z TLS passthrough

- **Status:** zaakceptowana (szczegóły konfiguracji do potwierdzenia w Kroku 5 — Q-02)
- **Data:** 2026-09-18
- **Decydent:** właściciel projektu (VM na Proxmoxie + VPS jako edge — Krok 0)
- **Powiązane wymagania:** NFR-01.01, NFR-01.08, NFR-03.06, NFR-03.11, NFR-05.03, NFR-09.01, Z-07, Z-18

## Kontekst

Serwer domowy (Dell 7020, i5-4590 4C/4T, 16 GB RAM, SSD 240 GB + HDD 1 TB) z Proxmox VE obsługuje już Immich; ruch z internetu trafia do domu przez mały VPS w OVH połączony tunelem WireGuard. Właściciel wybrał: aplikacja w VM na Proxmoxie, VPS wyłącznie jako edge. Otwarte pytanie: gdzie kończy się TLS. Jeśli na VPS, to dane finansowe użytkowników są na nim odszyfrowywane (VPS u zewnętrznego dostawcy); jeśli w domu — VPS przekazuje zaszyfrowany strumień i nie widzi treści.

## Rozważane opcje

| Opcja | Zalety | Wady |
|---|---|---|
| **A. TLS passthrough na VPS (nginx `stream` + SNI) → WireGuard → Caddy w VM (terminacja TLS)** | VPS nie widzi danych w postaci jawnej; certyfikat i klucz prywatny tylko w domu; prosta rola VPS | Brak cache HTTP i reguł L7 na VPS; CrowdSec analizuje logi Caddy w domu |
| B. Terminacja TLS na VPS, HTTP (lub ponowny TLS) do domu | Możliwy cache statyków i WAF na VPS | Odszyfrowane dane finansowe na maszynie zewnętrznego dostawcy; klucz TLS na VPS |
| C. Aplikacja na VPS | Wyższa dostępność | Rozmiar VPS nieznany; dane poza domem; sprzeczne z wyborem właściciela |
| D. LXC zamiast VM | Mniejszy narzut RAM | Wspólne jądro z hostem — słabsza izolacja danych finansowych |

## Decyzja

Wariant **A** i **VM** (nie LXC):

- **VM `oliginvest`**: Debian 13, Docker Engine + Compose, **6 GB RAM, 3 vCPU**, dysk systemowy na SSD (~60 GB), kopie zapasowe na HDD 1 TB (szczegóły w `07-wdrozenie/backup-dr.md`); limity zasobów kontenerów wg [`../01-architektura/przeglad-architektury.md`](../01-architektura/przeglad-architektury.md) § 4; priorytet CPU VM niższy niż Immich w godzinach nocnych (zadania ciężkie) — do dostrojenia.
- **Edge (VPS)**: nginx `stream` z `ssl_preread` kieruje ruch dla nazwy aplikacji (❓ `invest.oligi.pl`, Q-01) przez WireGuard do VM; firewall (tylko 80/443 i port WireGuard), limity połączeń per IP. VPS nie przechowuje danych ani kluczy TLS aplikacji.
- **Caddy w VM**: TLS 1.3, certyfikaty ACME (wyzwanie HTTP-01 przez przekierowany port 80 lub DNS-01 — decyzja w Kroku 5), HSTS, routing ścieżek; CrowdSec czyta logi Caddy w domu.
- **Integracja z istniejącym nginx w domu** (obsługującym Immich): do ustalenia w Kroku 5 — preferowane rozdzielenie ruchu po SNI już na VPS, bez zmian w konfiguracji Immicha.
- **Wydajność (Z-18):** jeśli pomiary RUM pokażą przekroczenie LCP z powodu łącza domowego, opcją jest osobna subdomena zasobów statycznych (bez danych użytkowników) z cache na VPS — nowy ADR przed wdrożeniem.

## Konsekwencje

- Pozytywne: poufność end-to-end między urządzeniem użytkownika a domem; izolacja od Immicha; 0 zł.
- Negatywne: awaria domu (prąd, łącze, sprzęt) = niedostępność aplikacji (Z-07, akceptowalne dla aplikacji prywatnej — `10-ograniczenia.md`); brak cache na edge; zależność od przepustowości uploadu łącza domowego.
- Zadania: konfiguracja VM i Compose (M0), edge SNI passthrough (M0), CrowdSec w VM (M6), pomiar RUM (M1+).

## Weryfikacja

Przechwycenie ruchu na VPS (tcpdump na interfejsie WireGuard) pokazuje wyłącznie TLS; test SSL Labs dla domeny aplikacji: TLS 1.3, HSTS; zużycie zasobów VM w teście obciążeniowym ≤ 6 GB RAM (NFR-01.08).
