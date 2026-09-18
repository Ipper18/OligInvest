# Third-party skills — provenance

All skills below are copied verbatim (unless noted) from MIT-licensed repositories after the audit documented in `docs/09-decyzje/audyt-pluginow.md`. Audit date: 2026-09-18.

| Skill directory | Source repository | Commit | License |
|---|---|---|---|
| `backtest-review`, `strategy-critique`, `risk-report`, `data-scrub`, `indicator-design`, `hedge-lab` | https://github.com/shakeebshaan/claude-code-quant-skills | `6b39f8f` (2026-04-17) | MIT (`backtest-review/LICENSE.quant-skills`) |
| `cost-basis-engine`, `portfolio-analytics`, `risk-management`, `position-sizing`, `kelly-criterion`, `trade-accounting` | https://github.com/agiprolabs/claude-trading-skills | `981e1d7` (2026-09-02) | MIT (`cost-basis-engine/LICENSE.agiprolabs.md`) |
| `backtest-expert`, `us-stock-analysis`, `position-sizer`, `drawdown-circuit-breaker`, `trade-performance-coach`, `weekly-performance-digest` | https://github.com/tradermonty/claude-trading-skills | `15347d6` (2026-09-18) | MIT (`backtest-expert/LICENSE.tradermonty`) |
| `vectorbt-reference` (selected `rules/*.md` only; own `SKILL.md`) | https://github.com/marketcalls/vectorbt-backtesting-skills | `05d9e8b` (2026-07-12) | MIT (declared in upstream README; no LICENSE file upstream) — see `vectorbt-reference/NOTICE` |

Rules for this directory:
- No skill here may perform network calls or read secrets. Re-run the audit grep before updating any of them.
- Skills are advisors. Financial formulas are defined in `docs/03-dane/obliczenia-finansowe.md`; where a skill disagrees, the docs win.
