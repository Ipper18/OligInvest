---
name: vectorbt-reference
description: Reference knowledge base for vectorbt backtesting used by the OligInvest Python worker (apps/analytics). Use when designing or reviewing backtests, walk-forward validation, parameter optimization, position sizing, stop-loss/take-profit logic, realistic transaction costs, or performance metrics. Read the relevant rule file before writing any backtest spec.
user-invocable: false
---

# vectorbt reference (OligInvest)

Curated rule files adapted from `marketcalls/vectorbt-backtesting-skills` (MIT). See `NOTICE` for provenance.

## OligInvest environment (differs from upstream)

- Data comes from the OligInvest `DataProvider` layer (see `docs/03-dane/zrodla-danych.md`) — **never** from OpenAlgo, DuckDB Historify or broker APIs referenced in upstream rules.
- Indicators: `packages/core` (TS) is the source of truth for SMA/EMA/RSI/MACD/Bollinger/ATR; in Python use `pandas-ta` only to cross-check. Ignore upstream instructions that mandate `openalgo.ta`.
- Costs: use the GPW / XTB fee model documented in `docs/03-dane/obliczenia-finansowe.md`; `rules/us-market-costs.md` is the template for US instruments.
- Every backtest output must carry the methodology disclaimer and assumptions block required by `docs/11-zgodnosc-prawna.md`.
- Run `strategy-critique` and `backtest-review` skills on every strategy before it is documented as a feature.

## Rule files (read the one you need)

| File | Use when |
|------|----------|
| `rules/pitfalls.md` | Any backtest — look-ahead, survivorship, overfitting checklist |
| `rules/walk-forward.md` | Out-of-sample validation design |
| `rules/robustness-testing.md` | Parameter sensitivity, Monte Carlo on trade order |
| `rules/parameter-optimization.md` | Grid search, heatmaps, avoiding curve-fitting |
| `rules/position-sizing.md` | Fixed fractional, volatility-adjusted sizing |
| `rules/stop-loss-take-profit.md` | SL/TP/trailing logic in vectorbt |
| `rules/us-market-costs.md` | Fee/slippage template for US instruments |
| `rules/performance-analysis.md` | Metrics, tearsheets, drawdown analysis |
| `rules/simulation-modes.md` | `from_signals` vs `from_orders` vs `from_holding` |
| `rules/indicators-signals.md` | Signal generation and cleaning |
| `rules/long-short-trading.md` | Direction handling |
| `rules/strategy-catalog.md` | Reference strategies for benchmarks and demos |
| `rules/plotting.md` | Chart conventions (adapt to Plotly/Lightweight Charts) |
