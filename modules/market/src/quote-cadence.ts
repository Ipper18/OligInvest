// Delayed-quote cadence (ADR-016, strategia-cache § 2 and § 5). Yahoo costs one chart request per
// instrument, so the stale threshold follows from the budget, not the other way round.
const MINUTE_MS = 60_000;
/** Yahoo budget per minute (owner decision 2026-10-12: at most 12). */
export const YAHOO_PER_MINUTE = 12;
/** Chart requests per quote run; the remaining 2/min stay free for on-demand symbol search. */
export const QUOTES_PER_RUN = 10;
/** The quote job runs every minute; each instrument is attempted at most once per cycle. */
export const QUOTE_RUN_MS = MINUTE_MS;
export const QUOTE_CYCLE_MS = 5 * MINUTE_MS;
/** Instruments quoted within one cycle across open sessions: 10 per run × 5 runs = 50. */
export const MAX_QUOTED_INSTRUMENTS = QUOTES_PER_RUN * (QUOTE_CYCLE_MS / QUOTE_RUN_MS);
/** Attempt marker lifetime: expires before the run that closes the cycle. */
export const QUOTE_ATTEMPT_MS = QUOTE_CYCLE_MS - QUOTE_RUN_MS / 2;
/** Stale after a full cycle at maximum load, one missed run and one run of margin: 7 min. */
export const QUOTE_STALE_MS = QUOTE_CYCLE_MS + 2 * QUOTE_RUN_MS;
