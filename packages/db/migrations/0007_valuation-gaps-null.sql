-- BL-302 (owner decision 2026-10-20): a missing FX rate or flow value is a gap (NULL), never 0.
ALTER TABLE portfolio.valuations_daily ALTER COLUMN total_value_pln DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE portfolio.valuations_daily ALTER COLUMN external_flow DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE portfolio.valuations_daily ALTER COLUMN external_flow_pln DROP NOT NULL;
--> statement-breakpoint
UPDATE portfolio.valuations_daily SET total_value_pln = NULL WHERE fx_rate_to_pln IS NULL;
