ALTER TABLE market.corporate_actions ADD COLUMN ratio_from integer;
--> statement-breakpoint
ALTER TABLE market.corporate_actions ADD COLUMN ratio_to integer;
--> statement-breakpoint
-- Preserve the exact stored rational value; abort atomically if it cannot fit integer pairs.
UPDATE market.corporate_actions SET
  ratio_from = (1000000000000 / gcd(abs(ratio * 1000000000000), 1000000000000))::integer,
  ratio_to = (ratio * 1000000000000 / gcd(abs(ratio * 1000000000000), 1000000000000))::integer
WHERE ratio IS NOT NULL;
--> statement-breakpoint
ALTER TABLE market.corporate_actions DROP COLUMN ratio;
--> statement-breakpoint
ALTER TABLE portfolio.transactions DROP CONSTRAINT tx_split_ratio;
--> statement-breakpoint
ALTER TABLE portfolio.transactions ADD COLUMN ratio_from integer;
--> statement-breakpoint
ALTER TABLE portfolio.transactions ADD COLUMN ratio_to integer;
--> statement-breakpoint
UPDATE portfolio.transactions SET
  ratio_from = (1000000000000 / gcd(abs(split_ratio * 1000000000000), 1000000000000))::integer,
  ratio_to = (split_ratio * 1000000000000 / gcd(abs(split_ratio * 1000000000000), 1000000000000))::integer
WHERE split_ratio IS NOT NULL;
--> statement-breakpoint
ALTER TABLE portfolio.transactions DROP COLUMN split_ratio;
--> statement-breakpoint
ALTER TABLE portfolio.transactions ADD COLUMN cash_in_lieu numeric(20,8);
--> statement-breakpoint
ALTER TABLE portfolio.transactions ADD COLUMN acquisition_cost numeric(20,8);
--> statement-breakpoint
ALTER TABLE portfolio.transactions ADD COLUMN acquired_on date;
--> statement-breakpoint
ALTER TABLE portfolio.transactions ADD CONSTRAINT tx_split_ratio CHECK (type <> 'SPLIT' OR (ratio_from IS NOT NULL AND ratio_from > 0 AND ratio_to IS NOT NULL AND ratio_to > 0));
--> statement-breakpoint
ALTER TABLE portfolio.lots ALTER COLUMN cost_total DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE portfolio.lots ADD COLUMN transfer_rate jsonb;
--> statement-breakpoint
ALTER TABLE portfolio.lot_consumptions ALTER COLUMN cost_economic DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE portfolio.lot_consumptions ALTER COLUMN realized_pl_economic DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE portfolio.positions_daily ALTER COLUMN cost_basis DROP NOT NULL;
