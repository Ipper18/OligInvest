# Audyt pluginów, skilli i serwerów MCP

**Cel:** udokumentować, co zostało zainstalowane w środowisku Claude Code projektu OligInvest, co odrzucono i dlaczego — tak, aby każdy element pochodzący spoza Anthropic był przejrzany przed użyciem.

Data audytu: 2026-09-18. Metoda: klon każdego repozytorium do katalogu tymczasowego, przegląd `SKILL.md`, wszystkich skryptów (`.py/.sh/.js`), manifestów, licencji, daty ostatniego commita (`git log -1`), hostów w wywołaniach sieciowych (`grep https?://`), odczytów zmiennych środowiskowych (`os.getenv`, `process.env`) i pinowania zależności.

Kryteria odrzucenia (z zadania): wywołania sieciowe do nieudokumentowanych hostów, odczyt env spoza własnego zakresu, instalacja zależności bez pinowania, brak utrzymania > 6 miesięcy.

---

## 1. Pluginy oficjalne (marketplace `claude-plugins-official`)

| Plugin | Status | Sposób instalacji | Uwagi |
|--------|--------|-------------------|-------|
| `feature-dev` | ✅ zainstalowany (scope: user) | `npx -y @anthropic-ai/claude-code@2.1.277 plugin install feature-dev@claude-plugins-official` | Lokalny CLI `~/.local/bin/claude.exe` (v2.1.74) nie widział pluginów w marketplace — użyto najnowszego CLI przez `npx`. Zalecane: `claude update`. |
| `frontend-design` | ✅ zainstalowany (scope: user) | j.w. | Dodatkowo dostępny jako skill bundlowany w aplikacji desktop (`anthropic-skills:frontend-design`). |
| `code-review` | ✅ zainstalowany (scope: user) | j.w. | |
| `security-guidance` | ✅ aktywny w sesji | włączony z katalogu claude.ai (`knowledge-work-plugins`, autor David Dworken, hooki PostToolUse/Stop/UserPromptSubmit) | Nie instalowano drugiej kopii z GitHub, aby nie dublować hooków. |
| `playwright` | ➡️ jako serwer MCP w `.mcp.json` | — | Plugin to wrapper na `npx @playwright/mcp`; w projekcie serwer jest wersjonowany bezpośrednio w `.mcp.json` (pin `0.0.81`), więc plugin byłby duplikatem. |
| `github` | ➡️ jako serwer MCP w `.mcp.json` | — | j.w. — `https://api.githubcopilot.com/mcp/`, token z `GITHUB_PERSONAL_ACCESS_TOKEN`. |
| `context7` | ➡️ jako serwer MCP w `.mcp.json` | — | j.w. — `https://mcp.context7.com/mcp`, klucz opcjonalny. |
| `supabase` | ⛔ pominięty | — | Stos to self-host Postgres + Better Auth (decyzja z Kroku 0). Plugin nieadekwatny. |
| `vercel` | ⛔ pominięty | — | Hosting we własnej VM (Proxmox), nie Vercel. |
| `sentry` | ⛔ pominięty — decyzja w [`../07-wdrozenie/monitoring.md`](../07-wdrozenie/monitoring.md) § 5: bez Sentry i GlitchTip (pamięć RAM, dane błędów poza domem) | — | Błędy w ustrukturyzowanych logach z identyfikatorem żądania i alertach progowych. |

Stan po instalacji (`plugin list`): `code-review`, `feature-dev`, `frontend-design` — ✔ enabled. Uwaga poboczna: wcześniej zainstalowane `document-skills@anthropic-agent-skills` i `example-skills@anthropic-agent-skills` raportują „failed to load: conflicting manifests” — problem po stronie marketplace `anthropics/skills`, nie tego projektu; skille i tak są dostępne w aplikacji desktop.

---

## 2. Repozytoria społecznościowe — werdykty

| Repozytorium | Ostatni commit | Commity | Licencja | Wywołania sieciowe | Odczyt env | Zależności | Werdykt |
|---|---|---|---|---|---|---|---|
| [tradermonty/claude-trading-skills](https://github.com/tradermonty/claude-trading-skills) | 2026-09-18 (`15347d6`) | 817 | MIT (`LICENSE`) | financialmodelingprep.com (121×), cmegroup.com, finviz.com, alpaca.markets, sec.gov, fxmacrodata.com | `FMP_API_KEY`, `FINVIZ_API_KEY`, `ALPACA_*`, `FXMACRODATA_API_KEY` | `pyproject.toml` z `>=` (niepinowane); większość skilli stdlib-only; `drawdown-circuit-breaker` pinuje `pandas-market-calendars==5.2.2` | ✅ **częściowo** — 6 skilli bez API skopiowano; 46 wymagających FMP/FINVIZ/Alpaca/innych hostów **wyłączono** |
| [shakeebshaan/claude-code-quant-skills](https://github.com/shakeebshaan/claude-code-quant-skills) | 2026-04-17 (`6b39f8f`) | 2 | MIT | brak (tylko linki w README) | brak | brak skryptów — czysty Markdown | ✅ **przyjęty w całości** (6 skilli). Młode repo (1★), ale zawartość to wyłącznie instrukcje — zero ryzyka wykonania |
| [marketcalls/vectorbt-backtesting-skills](https://github.com/marketcalls/vectorbt-backtesting-skills) | 2026-07-12 (`05d9e8b`) | 15 | MIT (deklaracja w README, **brak pliku LICENSE**) | `127.0.0.1:5000` (OpenAlgo), `paper-api.alpaca.markets`, `prdownloads.sourceforge.net` (TA-Lib) | `OPENALGO_API_KEY/HOST`, `ALPACA_*`, `TWELVEDATA_API_KEY`, `CRYPTO_*`, `CUSTOM_API_*` | `requirements.txt` w pełni pinowane (`==`), ale skill `setup` instruuje `pip install ta-lib` bez wersji | ⚠️ **częściowo** — skopiowano 13 ogólnych plików reguł jako `vectorbt-reference` z własnym `SKILL.md`; pominięto skille `setup/backtest/optimize/quick-stats/strategy-compare` (zależne od OpenAlgo — broker indyjski) oraz szablony `assets/*` |
| [Trade-With-Claude/cbt-framework](https://github.com/Trade-With-Claude/cbt-framework) | 2026-02-20 (`47a8cc8`) | 4 | MIT | alphavantage.co, mcp.alphavantage.co, fred.stlouisfed.org, api.twilio.com, api.telegram.org, giełdy krypto (Bybit/Binance/Kraken/Hyperliquid) | `EXCHANGE_API_KEY/SECRET`, `TRADE_API_*`, `TWILIO_*`, `TELEGRAM_*`, `EMAIL_*`, `DISCORD_WEBHOOK_URL`, `HYPERLIQUID_WALLET` | pakiet npm + `requirements.txt` | ⛔ **odrzucony** — (1) brak utrzymania ~7 miesięcy (> 6 mies.), (2) duplikuje `backtest-review`/`strategy-critique`/`vectorbt-reference`, (3) profil krypto-giełdowy z kluczami handlowymi i kanałami powiadomień poza zakresem projektu, (4) hooki i własny silnik — zbyt duży ślad jak na warstwę krytyki |
| [agiprolabs/claude-trading-skills](https://github.com/agiprolabs/claude-trading-skills) | 2026-09-02 (`981e1d7`) | 20 | MIT | Solana RPC, Birdeye, DexScreener, CoinGecko, Helius, Jupiter, Jito, DeFiLlama, Binance (tylko w skillach krypto) | `BIRDEYE_API_KEY`, `HELIUS_API_KEY`, `SOLANATRACKER_API_KEY`, `COINGECKO_API_KEY`, `PRIVATE_KEY` (!), `WALLET_ADDRESS` — tylko w skillach krypto | brak `requirements.txt`; `pip install pandas` itp. bez wersji w SKILL.md | ✅ **częściowo** — 6 modułów przekrojowych bez sieci i bez kluczy; 55 modułów crypto/DeFi/prediction-markets pominięto |

### 2.1 tradermonty — klasyfikacja 74 skilli

Legenda: FMP = Financial Modeling Prep (free tier 250 zapytań/dobę, ale kluczowe endpointy płatne), FINVIZ = FINVIZ Elite (płatne), ALPACA = konto brokerskie Alpaca, NET = własne wywołania HTTP do hostów publicznych bez klucza.

- **Skopiowane do `.claude/skills/` (bez API, stdlib lub pinowane zależności):** `backtest-expert`, `us-stock-analysis`, `position-sizer`, `drawdown-circuit-breaker`, `trade-performance-coach`, `weekly-performance-digest`.
- **Działają bez płatnego klucza, ale nieużyte (poza zakresem lub duplikat):** `contrarian-setup-gate`, `edge-candidate-agent`, `edge-concept-synthesizer`, `edge-hint-extractor`, `edge-pipeline-orchestrator`, `edge-signal-aggregator`, `edge-strategy-designer`, `edge-strategy-reviewer`, `futures-position-sizer`, `kanchi-dividend-review-monitor`, `kanchi-dividend-us-tax-accounting`, `manifoldbt-backtester`, `market-environment-analysis`, `market-news-analyst`, `mt5-robot-tester`, `pre-trade-discipline-gate`, `residual-edge-analyzer`, `scenario-analyzer`, `skill-designer`, `stanley-druckenmiller-investment`, `strategy-pivot-designer`, `trade-hypothesis-ideator` (22). Można dodać później bez ponownego audytu sieciowego.
- **Wyłączone — wymagają FMP (34):** `canslim-screener`, `cot-contrarian-detector`, `dividend-growth-pullback-screener`, `downtrend-duration-analyzer`, `dual-axis-skill-reviewer`, `earnings-calendar`, `earnings-trade-analyzer`, `economic-calendar-fetcher`, `exposure-coach`, `ftd-detector`, `ibd-distribution-day-monitor`, `institutional-flow-tracker`, `kanchi-dividend-sop`, `macro-regime-detector`, `market-top-detector`, `news-reaction-failure-analyzer`, `options-strategy-advisor`, `pair-trade-screener`, `parabolic-short-trade-planner`, `pead-screener`, `signal-postmortem`, `skill-integration-tester`, `stockbee-20pct-study`, `stockbee-episodic-pivot-analyzer`, `stockbee-exhaustion-hammer-screener`, `stockbee-momentum-burst-screener`, `stockbee-setup-fluency-trainer`, `technical-analyst`, `theme-detector`, `trader-memory-core`, `trading-skills-navigator`, `us-undervalued-growth-screener`, `value-dividend-screener`, `vcp-screener`.
- **Wyłączone — wymagają FINVIZ Elite (5):** `data-quality-checker`, `finviz-screener`, `skill-idea-miner`, `uptrend-analyzer`, `us-market-bubble-detector`.
- **Wyłączone — wymagają konta Alpaca (2):** `breakout-trade-planner`, `portfolio-manager`.
- **Wyłączone — własne wywołania HTTP bez klucza (5):** `breadth-chart-analyst`, `crypto-regime-analyzer`, `market-breadth-analyzer`, `sector-analyst` (hosty: cmegroup.com, sec.gov, dataroma.com, whalewisdom.com — publiczne, ale nieudokumentowane w naszym zakresie), `fxmacrodata-calendar` (własny klucz `FXMACRODATA_API_KEY`).

Uwaga do `technical-analyst`: metodologia w `SKILL.md` jest wartościowa, ale skrypt `check_weekly_price_action.py` wymaga `FMP_API_KEY` — nie kopiowano; wzorce analizy technicznej zostaną opisane w `docs/03-dane/obliczenia-finansowe.md` z własnym źródłem danych.

### 2.2 agiprolabs — skopiowane moduły przekrojowe

`cost-basis-engine` (FIFO/LIFO/HIFO/średnia, stdlib), `portfolio-analytics` (Sharpe/Sortino/Calmar, `quantstats` opcjonalnie), `risk-management`, `position-sizing`, `kelly-criterion`, `trade-accounting`. Wszystkie: zero hostów sieciowych, env tylko parametry lokalne (`ACCOUNT_SIZE`, `WIN_RATE`, `TRADES`, `DEMO_*`). Pominięto `tax-loss-harvesting` i `tax-liability-tracking` — logika amerykańska (wash sale 61 dni), myląca dla podatku Belki (19 %, FIFO obowiązkowe, brak reguły wash sale).

### 2.3 Skille wymagające dodatkowego traktowania

- Skrypty `.py` w skopiowanych skillach są uruchamiane wyłącznie na żądanie (nie ładują się do kontekstu). Żaden nie wykonuje wywołań sieciowych — zweryfikowano `grep` po kopiowaniu.
- Pliki licencji: `.claude/skills/THIRD_PARTY_NOTICES.md` (zbiorczo) + kopie licencji przy pierwszym skillu z danego repo.
- Rozmiar katalogu `.claude/skills/`: ~1,1 MB, 19 skilli.

---

## 3. Serwery MCP (`.mcp.json`, wersjonowany; klucze wyłącznie z env)

Składnia zweryfikowana w dokumentacji: <https://code.claude.com/docs/en/mcp> (obsługa `${VAR}` i `${VAR:-default}` w `url/headers/env/args`).

| Serwer | Typ | Źródło konfiguracji | Klucz | Wynik `claude mcp list` (2026-09-18) |
|---|---|---|---|---|
| `context7` | http `https://mcp.context7.com/mcp` | oficjalny plugin Upstash (`external_plugins/context7/.mcp.json`) | `CONTEXT7_API_KEY` opcjonalny | ✓ Connected |
| `playwright` | stdio `npx -y @playwright/mcp@0.0.81` | oficjalny plugin Microsoft; wersja przypięta do bieżącej (`npm view`) | — | ✓ Connected |
| `github` | http `https://api.githubcopilot.com/mcp/` | oficjalny plugin GitHub | `GITHUB_PERSONAL_ACCESS_TOKEN` (fine-grained PAT) | ✗ do czasu ustawienia tokena — oczekiwane |
| `alphavantage` | http `https://mcp.alphavantage.co/mcp?apikey=…` | [alphavantage/alpha_vantage_mcp](https://github.com/alphavantage/alpha_vantage_mcp) (MIT). Parametr `apikey` w URL jest oznaczony jako deprecated na rzecz logowania OAuth — działa; alternatywa: usunąć `?apikey` i zalogować się przez `/mcp` | `ALPHAVANTAGE_API_KEY` (darmowy) | ✓ Connected (bez klucza narzędzia zwrócą błąd) |
| `twelvedata` | http `https://mcp.twelvedata.com/mcp` | [twelvedata/mcp](https://github.com/twelvedata/mcp) | logowanie OAuth w przeglądarce | ! Needs authentication — `/mcp` w sesji interaktywnej |

Odrzucone/odłożone: lokalne serwery yfinance (`uvx yfinance-market-mcp`) — wymagają `uv`, którego nie ma na maszynie; do rozważenia w Fazie 1, jeśli zdalne serwery okażą się niewystarczające.

---

## 4. Przegląd katalogów zewnętrznych

| Katalog | Co to jest | Wynik dla naszych potrzeb |
|---|---|---|
| <https://claudemarketplaces.com/> | niezależna wyszukiwarka/indeks skilli, marketplace'ów i MCP (23,6 tys. skilli wg strony) | Brak istotnych pozycji finansowych poza krypto (1inch). Wskazane MCP: Supabase, Linear, GitHub — GitHub już mamy. |
| <https://buildwithclaude.com/> | kuratorowany katalog pluginów/skilli/subagentów | `agents-business-finance`, `agents-crypto-trading` (poza zakresem); subagenty `api-documenter` (OpenAPI) i `api-security-audit` — ewentualnie do Kroku 4/5, niezainstalowane (brak audytu). |
| <https://www.aitmpl.com/plugins/> | agregator 34 kolekcji pluginów z GitHuba | Strona ładuje listę dynamicznie; bez pozycji finansowych w treści statycznej. Nic do dodania. |

Wniosek: katalogi nie zawierają lepszej alternatywy dla warstwy krytyki metodologicznej niż `claude-code-quant-skills`; oficjalne pluginy Anthropic pokrywają resztę (frontend, review, security, feature-dev).

---

## 5. Zastrzeżenia i zalecenia

1. **Lokalny CLI jest przestarzały** (`2.1.74` vs `2.1.277` w npm). Instalacje wykonano przez `npx @anthropic-ai/claude-code@2.1.277`. Zalecane jednorazowo: `claude update`.
2. `security-guidance` działa z katalogu claude.ai; jeśli sesje będą uruchamiane poza aplikacją desktop, zainstalować: `claude plugin install security-guidance@claude-plugins-official`.
3. Repo `marketcalls/vectorbt-backtesting-skills` nie ma pliku `LICENSE` (tylko wpis „MIT” w README) — traktujemy jako MIT, ale odnotowano.
4. Skille społecznościowe traktować jako **doradców**, nie źródło prawdy: wzory finansowe obowiązują wg `docs/03-dane/obliczenia-finansowe.md`, a każdy skill z tradermonty jest pisany pod rynek USA (np. godziny sesji, kalendarz NYSE).
5. Ponowny audyt przy każdej aktualizacji skilli (`git log -1` + ten sam `grep` hostów/env); procedura powtarzalna — komendy w [`CONTRIBUTING.md`](../../CONTRIBUTING.md) § 7.
