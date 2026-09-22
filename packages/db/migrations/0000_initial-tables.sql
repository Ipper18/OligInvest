CREATE SCHEMA "platform";
--> statement-breakpoint
CREATE SCHEMA "alerts";
--> statement-breakpoint
CREATE SCHEMA "analytics";
--> statement-breakpoint
CREATE SCHEMA "education";
--> statement-breakpoint
CREATE SCHEMA "auth";
--> statement-breakpoint
CREATE SCHEMA "identity";
--> statement-breakpoint
CREATE SCHEMA "market";
--> statement-breakpoint
CREATE SCHEMA "notifications";
--> statement-breakpoint
CREATE SCHEMA "portfolio";
--> statement-breakpoint
CREATE TABLE "platform"."audit_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"actor_ref" text NOT NULL,
	"actor_type" text NOT NULL,
	"action" text NOT NULL,
	"resource_type" text,
	"resource_id" text,
	"outcome" text DEFAULT 'success'::text NOT NULL,
	"ip" "inet",
	"user_agent" text,
	"request_id" text,
	"before" jsonb,
	"after" jsonb,
	CONSTRAINT "audit_log_actor_type_check" CHECK (((actor_type = ANY (ARRAY['user'::text, 'admin'::text, 'system'::text, 'pat'::text])))),
	CONSTRAINT "audit_log_outcome_check" CHECK (((outcome = ANY (ARRAY['success'::text, 'denied'::text, 'error'::text]))))
);
--> statement-breakpoint
CREATE TABLE "platform"."erasure_log" (
	"erased_user_id" uuid PRIMARY KEY NOT NULL,
	"erased_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purge_after" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."feature_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."idempotency_keys" (
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"request_hash" text NOT NULL,
	"status_code" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
CREATE TABLE "platform"."role_limits" (
	"role" text PRIMARY KEY NOT NULL,
	"limits" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_limits_role_check" CHECK (((role = ANY (ARRAY['user'::text, 'pro'::text, 'admin'::text]))))
);
--> statement-breakpoint
CREATE TABLE "platform"."web_vitals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"route" text NOT NULL,
	"metric" text NOT NULL,
	"value" double precision NOT NULL,
	"rating" text,
	"device_class" text,
	"connection" text,
	CONSTRAINT "web_vitals_metric_check" CHECK (((metric = ANY (ARRAY['LCP'::text, 'INP'::text, 'CLS'::text, 'FCP'::text, 'TTFB'::text])))),
	CONSTRAINT "web_vitals_rating_check" CHECK (((rating = ANY (ARRAY['good'::text, 'needs-improvement'::text, 'poor'::text]))))
);
--> statement-breakpoint
CREATE TABLE "alerts"."alert_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"triggered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"value" numeric(20, 8),
	"threshold" numeric(20, 8),
	"data_as_of" timestamp with time zone NOT NULL,
	"data_source" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alerts"."alert_rules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"instrument_id" uuid,
	"params" jsonb NOT NULL,
	"channels" text[] DEFAULT '{push,email}'::text[] NOT NULL,
	"cooldown_minutes" integer DEFAULT 1440 NOT NULL,
	"hysteresis_pct" numeric(6, 3) DEFAULT 0.5 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_triggered_at" timestamp with time zone,
	"last_state" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_rules_id_user_id_key" UNIQUE("id","user_id"),
	CONSTRAINT "alert_rules_type_check" CHECK (((type = ANY (ARRAY['price_above'::text, 'price_below'::text, 'change_pct'::text, 'indicator'::text, 'portfolio_change'::text, 'drawdown'::text, 'allocation_drift'::text, 'earnings'::text, 'news'::text]))))
);
--> statement-breakpoint
CREATE TABLE "analytics"."analytics_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'queued'::text NOT NULL,
	"params" jsonb NOT NULL,
	"input_snapshot" jsonb NOT NULL,
	"result" jsonb,
	"assumptions" jsonb,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"seed" bigint,
	"algorithm_version" text NOT NULL,
	"data_version" jsonb,
	"progress" smallint DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	CONSTRAINT "analytics_runs_progress_check" CHECK ((((progress >= 0) AND (progress <= 100)))),
	CONSTRAINT "analytics_runs_status_check" CHECK (((status = ANY (ARRAY['queued'::text, 'running'::text, 'done'::text, 'failed'::text, 'cancelled'::text])))),
	CONSTRAINT "analytics_runs_type_check" CHECK (((type = ANY (ARRAY['monte_carlo'::text, 'optimization'::text, 'stress_test'::text, 'what_if'::text, 'backtest'::text, 'goal'::text, 'rebalance'::text]))))
);
--> statement-breakpoint
CREATE TABLE "analytics"."strategy_definitions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"definition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "strategy_definitions_user_id_name_key" UNIQUE("user_id","name")
);
--> statement-breakpoint
CREATE TABLE "analytics"."stress_scenarios" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"start_date" date,
	"end_date" date,
	"shocks" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stress_scenarios_check" CHECK ((((kind <> 'historical'::text) OR ((start_date IS NOT NULL) AND (end_date IS NOT NULL) AND (start_date < end_date))))),
	CONSTRAINT "stress_scenarios_kind_check" CHECK (((kind = ANY (ARRAY['historical'::text, 'hypothetical'::text]))))
);
--> statement-breakpoint
CREATE TABLE "education"."learning_progress" (
	"user_id" uuid NOT NULL,
	"lesson_key" text NOT NULL,
	"status" text NOT NULL,
	"score" smallint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_progress_pkey" PRIMARY KEY("user_id","lesson_key"),
	CONSTRAINT "learning_progress_status_check" CHECK (((status = ANY (ARRAY['started'::text, 'completed'::text]))))
);
--> statement-breakpoint
CREATE TABLE "education"."onboarding_state" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"step" text DEFAULT 'start'::text NOT NULL,
	"completed_at" timestamp with time zone,
	"skipped_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"issuer" text,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_provider_id_account_id_key" UNIQUE("provider_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "auth"."api_keys" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"config_id" text DEFAULT 'default'::text NOT NULL,
	"name" text,
	"start" text,
	"prefix" text,
	"key" text NOT NULL,
	"reference_id" uuid NOT NULL,
	"refill_interval" bigint,
	"refill_amount" integer,
	"last_refill_at" timestamp with time zone,
	"enabled" boolean DEFAULT true NOT NULL,
	"rate_limit_enabled" boolean DEFAULT true NOT NULL,
	"rate_limit_time_window" bigint,
	"rate_limit_max" integer,
	"request_count" integer DEFAULT 0 NOT NULL,
	"remaining" integer,
	"last_request" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"permissions" text,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "auth"."rate_limits" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limits_key_key" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "auth"."sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	"impersonated_by" uuid,
	"mfa_verified_at" timestamp with time zone,
	CONSTRAINT "sessions_token_key" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "auth"."two_factors" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" uuid NOT NULL,
	"verified" boolean DEFAULT true,
	"failed_verification_count" integer DEFAULT 0,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "auth"."users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"role" text DEFAULT 'user'::text NOT NULL,
	"banned" boolean DEFAULT false NOT NULL,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	"two_factor_enabled" boolean DEFAULT false NOT NULL,
	CONSTRAINT "users_email_key" UNIQUE("email"),
	CONSTRAINT "users_email_check" CHECK (((email = lower(email)))),
	CONSTRAINT "users_role_check" CHECK (((role = ANY (ARRAY['user'::text, 'pro'::text, 'admin'::text]))))
);
--> statement-breakpoint
CREATE TABLE "auth"."verifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."consent_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"document" text NOT NULL,
	"version" text NOT NULL,
	"action" text NOT NULL,
	"source" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consent_action_matches_document" CHECK (((((document = 'terms'::text) AND (action = 'accepted'::text)) OR ((document = 'privacy_notice'::text) AND (action = 'acknowledged'::text)) OR ((document = 'diagnostics'::text) AND (action = ANY (ARRAY['granted'::text, 'withdrawn'::text])))))),
	CONSTRAINT "consent_events_document_check" CHECK (((document = ANY (ARRAY['terms'::text, 'privacy_notice'::text, 'diagnostics'::text])))),
	CONSTRAINT "consent_events_source_check" CHECK (((source = ANY (ARRAY['sign_up'::text, 'gate'::text, 'settings'::text])))),
	CONSTRAINT "consent_events_version_check" CHECK (((version ~ '^[0-9]{4}-[0-9]{2}(-[0-9]{2})?(.[0-9]{1,3})?$'::text)))
);
--> statement-breakpoint
CREATE TABLE "identity"."data_exports" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'queued'::text NOT NULL,
	"content" "bytea",
	"size_bytes" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"downloaded_at" timestamp with time zone,
	CONSTRAINT "data_exports_status_check" CHECK (((status = ANY (ARRAY['queued'::text, 'running'::text, 'ready'::text, 'failed'::text, 'expired'::text]))))
);
--> statement-breakpoint
CREATE TABLE "identity"."deletion_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"cancelled_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "identity"."invitations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'user'::text NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_by" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "invitations_email_check" CHECK (((email = lower(email)))),
	CONSTRAINT "invitations_role_check" CHECK (((role = ANY (ARRAY['user'::text, 'pro'::text, 'admin'::text]))))
);
--> statement-breakpoint
CREATE TABLE "identity"."user_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"base_currency" char(3) DEFAULT 'PLN'::bpchar NOT NULL,
	"cost_basis_method" text DEFAULT 'fifo'::text NOT NULL,
	"pl_view" text DEFAULT 'economic'::text NOT NULL,
	"timezone" text DEFAULT 'Europe/Warsaw'::text NOT NULL,
	"locale" text DEFAULT 'pl-PL'::text NOT NULL,
	"theme" text DEFAULT 'system'::text NOT NULL,
	"pl_palette" text DEFAULT 'default'::text NOT NULL,
	"tax_date_basis" text DEFAULT 'settlement'::text NOT NULL,
	"tax_include_fx_fee" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_preferences_cost_basis_method_check" CHECK (((cost_basis_method = ANY (ARRAY['fifo'::text, 'average'::text])))),
	CONSTRAINT "user_preferences_pl_palette_check" CHECK (((pl_palette = ANY (ARRAY['default'::text, 'colorblind'::text])))),
	CONSTRAINT "user_preferences_pl_view_check" CHECK (((pl_view = ANY (ARRAY['economic'::text, 'tax'::text])))),
	CONSTRAINT "user_preferences_tax_date_basis_check" CHECK (((tax_date_basis = ANY (ARRAY['settlement'::text, 'trade'::text])))),
	CONSTRAINT "user_preferences_theme_check" CHECK (((theme = ANY (ARRAY['system'::text, 'light'::text, 'dark'::text]))))
);
--> statement-breakpoint
CREATE TABLE "market"."bars_daily" (
	"instrument_id" uuid NOT NULL,
	"session_date" date NOT NULL,
	"open" numeric(20, 8),
	"high" numeric(20, 8),
	"low" numeric(20, 8),
	"close" numeric(20, 8) NOT NULL,
	"volume" numeric(24, 4) DEFAULT 0 NOT NULL,
	"turnover" numeric(24, 4),
	"trades" integer,
	"no_trades" boolean DEFAULT false NOT NULL,
	"adjustment_factor" numeric(24, 12) DEFAULT 1 NOT NULL,
	"source" text NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bars_daily_pkey" PRIMARY KEY("instrument_id","session_date"),
	CONSTRAINT "bars_daily_volume_check" CHECK (((volume >= (0)::numeric)))
);
--> statement-breakpoint
CREATE TABLE "market"."bars_intraday" (
	"instrument_id" uuid NOT NULL,
	"interval" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"open" numeric(20, 8),
	"high" numeric(20, 8),
	"low" numeric(20, 8),
	"close" numeric(20, 8) NOT NULL,
	"volume" numeric(24, 4) DEFAULT 0 NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "bars_intraday_pkey" PRIMARY KEY("instrument_id","interval","ts"),
	CONSTRAINT "bars_intraday_interval_check" CHECK ((("interval" = ANY (ARRAY['5m'::text, '15m'::text, '1h'::text]))))
);
--> statement-breakpoint
CREATE TABLE "market"."calendar_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"instrument_id" uuid,
	"type" text NOT NULL,
	"event_date" date NOT NULL,
	"event_time" time,
	"title" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_events_source_check" CHECK (((source = ANY (ARRAY['alphavantage'::text, 'fmp'::text, 'fred'::text, 'admin'::text])))),
	CONSTRAINT "calendar_events_type_check" CHECK (((type = ANY (ARRAY['earnings'::text, 'macro'::text, 'dividend'::text, 'other'::text]))))
);
--> statement-breakpoint
CREATE TABLE "market"."corporate_actions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"instrument_id" uuid NOT NULL,
	"type" text NOT NULL,
	"ex_date" date NOT NULL,
	"record_date" date,
	"pay_date" date,
	"ratio" numeric(24, 12),
	"amount" numeric(20, 8),
	"currency" char(3),
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text NOT NULL,
	"confirmed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "corporate_actions_type_check" CHECK (((type = ANY (ARRAY['split'::text, 'reverse_split'::text, 'dividend'::text, 'isin_change'::text, 'name_change'::text, 'delisting'::text, 'rights_issue'::text]))))
);
--> statement-breakpoint
CREATE TABLE "market"."data_quality_issues" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"instrument_id" uuid NOT NULL,
	"session_date" date,
	"check_code" text NOT NULL,
	"severity" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'open'::text NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_quality_issues_severity_check" CHECK (((severity = ANY (ARRAY['BLOCK'::text, 'WARN'::text, 'INFO'::text])))),
	CONSTRAINT "data_quality_issues_status_check" CHECK (((status = ANY (ARRAY['open'::text, 'resolved'::text, 'ignored'::text]))))
);
--> statement-breakpoint
CREATE TABLE "market"."fundamentals_snapshots" (
	"instrument_id" uuid NOT NULL,
	"period_end" date NOT NULL,
	"period_type" text NOT NULL,
	"data" jsonb NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fundamentals_snapshots_pkey" PRIMARY KEY("instrument_id","period_end","period_type"),
	CONSTRAINT "fundamentals_snapshots_period_type_check" CHECK (((period_type = ANY (ARRAY['Q'::text, 'Y'::text]))))
);
--> statement-breakpoint
CREATE TABLE "market"."fx_rates" (
	"base" char(3) NOT NULL,
	"quote" char(3) NOT NULL,
	"rate_date" date NOT NULL,
	"rate" numeric(18, 8) NOT NULL,
	"source" text NOT NULL,
	"table_no" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_rates_pkey" PRIMARY KEY("base","quote","rate_date","source"),
	CONSTRAINT "fx_rates_rate_check" CHECK (((rate > (0)::numeric))),
	CONSTRAINT "fx_rates_source_check" CHECK (((source = ANY (ARRAY['nbp'::text, 'ecb'::text]))))
);
--> statement-breakpoint
CREATE TABLE "market"."instrument_provider_symbols" (
	"provider" text NOT NULL,
	"symbol" text NOT NULL,
	"instrument_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instrument_provider_symbols_pkey" PRIMARY KEY("provider","symbol"),
	CONSTRAINT "instrument_provider_symbols_provider_check" CHECK (((provider = ANY (ARRAY['gpw'::text, 'yahoo'::text, 'stooq'::text, 'finnhub'::text, 'twelvedata'::text, 'alphavantage'::text, 'fmp'::text, 'eodhd'::text, 'xtb'::text, 'mbank'::text, 'openfigi'::text]))))
);
--> statement-breakpoint
CREATE TABLE "market"."instruments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"isin" text,
	"mic" text NOT NULL,
	"ticker" text,
	"exchange_short_name" text,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"currency" char(3) NOT NULL,
	"country" char(2),
	"asset_class" text DEFAULT 'equity'::text NOT NULL,
	"sector_code" text,
	"lot_size" numeric(24, 10) DEFAULT 1 NOT NULL,
	"supports_fractional" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"delisted_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instruments_asset_class_check" CHECK (((asset_class = ANY (ARRAY['equity'::text, 'bond'::text, 'commodity'::text, 'cash'::text, 'fx'::text, 'crypto'::text, 'real_estate'::text, 'other'::text])))),
	CONSTRAINT "instruments_isin_check" CHECK (((isin ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$'::text))),
	CONSTRAINT "instruments_type_check" CHECK (((type = ANY (ARRAY['stock'::text, 'etf'::text, 'etc'::text, 'etn'::text, 'index'::text, 'fx'::text, 'commodity'::text, 'bond'::text, 'fund'::text, 'crypto'::text]))))
);
--> statement-breakpoint
CREATE TABLE "market"."macro_observations" (
	"series_id" uuid NOT NULL,
	"obs_date" date NOT NULL,
	"value" numeric(20, 8) NOT NULL,
	CONSTRAINT "macro_observations_pkey" PRIMARY KEY("series_id","obs_date")
);
--> statement-breakpoint
CREATE TABLE "market"."macro_series" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"unit" text NOT NULL,
	"frequency" text NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "macro_series_code_key" UNIQUE("code"),
	CONSTRAINT "macro_series_frequency_check" CHECK (((frequency = ANY (ARRAY['daily'::text, 'weekly'::text, 'monthly'::text, 'quarterly'::text, 'annual'::text, 'event'::text])))),
	CONSTRAINT "macro_series_source_check" CHECK (((source = ANY (ARRAY['fred'::text, 'nbp'::text, 'admin'::text]))))
);
--> statement-breakpoint
CREATE TABLE "market"."news_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"instrument_id" uuid,
	"market" text,
	"published_at" timestamp with time zone NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"source_domain" text NOT NULL,
	"language" text,
	"tone" double precision,
	"sentiment_score" double precision,
	"sentiment_source" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_items_url_key" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE "market"."quotes_latest" (
	"instrument_id" uuid PRIMARY KEY NOT NULL,
	"price" numeric(20, 8) NOT NULL,
	"prev_close" numeric(20, 8),
	"change" numeric(20, 8),
	"change_pct" double precision,
	"volume" numeric(24, 4),
	"as_of" timestamp with time zone NOT NULL,
	"delay_minutes" integer DEFAULT 15 NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market"."screener_presets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"universe" text DEFAULT 'gpw_all'::text NOT NULL,
	"criteria" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "screener_presets_user_id_name_key" UNIQUE("user_id","name")
);
--> statement-breakpoint
CREATE TABLE "market"."sector_memberships" (
	"instrument_id" uuid NOT NULL,
	"sector_code" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"source" text NOT NULL,
	CONSTRAINT "sector_memberships_pkey" PRIMARY KEY("instrument_id","sector_code","valid_from")
);
--> statement-breakpoint
CREATE TABLE "market"."sectors" (
	"code" text PRIMARY KEY NOT NULL,
	"scheme" text NOT NULL,
	"name_pl" text NOT NULL,
	"name_en" text,
	CONSTRAINT "sectors_scheme_check" CHECK (((scheme = ANY (ARRAY['gpw_subindex'::text, 'provider'::text]))))
);
--> statement-breakpoint
CREATE TABLE "market"."trading_calendar" (
	"mic" text NOT NULL,
	"session_date" date NOT NULL,
	"is_open" boolean NOT NULL,
	"open_time" time,
	"close_time" time,
	"timezone" text NOT NULL,
	"notes" text,
	CONSTRAINT "trading_calendar_pkey" PRIMARY KEY("mic","session_date")
);
--> statement-breakpoint
CREATE TABLE "market"."universe_members" (
	"universe_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	CONSTRAINT "universe_members_pkey" PRIMARY KEY("universe_id","instrument_id","valid_from")
);
--> statement-breakpoint
CREATE TABLE "market"."universes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "universes_code_key" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "market"."watchlist_items" (
	"watchlist_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"note" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watchlist_items_pkey" PRIMARY KEY("watchlist_id","instrument_id")
);
--> statement-breakpoint
CREATE TABLE "market"."watchlists" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watchlists_id_user_id_key" UNIQUE("id","user_id"),
	CONSTRAINT "watchlists_user_id_name_key" UNIQUE("user_id","name")
);
--> statement-breakpoint
CREATE TABLE "notifications"."notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source_ref" text,
	"channel" text NOT NULL,
	"status" text DEFAULT 'queued'::text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "notification_deliveries_channel_check" CHECK (((channel = ANY (ARRAY['push'::text, 'email'::text])))),
	CONSTRAINT "notification_deliveries_kind_check" CHECK (((kind = ANY (ARRAY['alert'::text, 'system'::text, 'export'::text, 'invitation'::text, 'security'::text])))),
	CONSTRAINT "notification_deliveries_status_check" CHECK (((status = ANY (ARRAY['queued'::text, 'sent'::text, 'failed'::text, 'skipped'::text]))))
);
--> statement-breakpoint
CREATE TABLE "notifications"."notification_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"channels" jsonb DEFAULT '{"push": true, "email": true}'::jsonb NOT NULL,
	"quiet_hours_start" time,
	"quiet_hours_end" time,
	"email_fallback" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications"."push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone,
	"failure_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_key" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "portfolio"."accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"broker" text NOT NULL,
	"account_type" text DEFAULT 'regular'::text NOT NULL,
	"currency" char(3) NOT NULL,
	"external_ref" text,
	"opened_on" date,
	"closed_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_id_user_id_key" UNIQUE("id","user_id"),
	CONSTRAINT "accounts_user_id_name_key" UNIQUE("user_id","name"),
	CONSTRAINT "accounts_account_type_check" CHECK (((account_type = ANY (ARRAY['regular'::text, 'ike'::text, 'ikze'::text, 'demo'::text])))),
	CONSTRAINT "accounts_broker_check" CHECK (((broker = ANY (ARRAY['xtb'::text, 'mbank'::text, 'other'::text, 'demo'::text]))))
);
--> statement-breakpoint
CREATE TABLE "portfolio"."cash_balances_daily" (
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"currency" char(3) NOT NULL,
	"valuation_date" date NOT NULL,
	"balance" numeric(20, 8) NOT NULL,
	CONSTRAINT "cash_balances_daily_pkey" PRIMARY KEY("account_id","currency","valuation_date")
);
--> statement-breakpoint
CREATE TABLE "portfolio"."import_batches" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"source" text NOT NULL,
	"format_detected" text,
	"file_name" text NOT NULL,
	"file_sha256" text NOT NULL,
	"status" text DEFAULT 'uploaded'::text NOT NULL,
	"summary" jsonb,
	"reconciliation" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"parsed_at" timestamp with time zone,
	"committed_at" timestamp with time zone,
	CONSTRAINT "import_batches_id_user_id_key" UNIQUE("id","user_id"),
	CONSTRAINT "import_batches_source_check" CHECK (((source = ANY (ARRAY['xtb'::text, 'mbank'::text, 'generic'::text])))),
	CONSTRAINT "import_batches_status_check" CHECK (((status = ANY (ARRAY['uploaded'::text, 'parsing'::text, 'parsed'::text, 'committed'::text, 'discarded'::text, 'failed'::text]))))
);
--> statement-breakpoint
CREATE TABLE "portfolio"."import_files" (
	"batch_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"content" "bytea" NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "import_files_size_bytes_check" CHECK (((size_bytes <= 10485760)))
);
--> statement-breakpoint
CREATE TABLE "portfolio"."import_rows" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"batch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"sheet" text,
	"raw" jsonb NOT NULL,
	"normalized" jsonb,
	"status" text NOT NULL,
	"status_reason" text,
	"dedupe_key" text NOT NULL,
	"instrument_id" uuid,
	"transaction_id" uuid,
	CONSTRAINT "import_rows_status_check" CHECK (((status = ANY (ARRAY['new'::text, 'duplicate'::text, 'unsupported'::text, 'needs_mapping'::text, 'error'::text, 'skipped'::text]))))
);
--> statement-breakpoint
CREATE TABLE "portfolio"."import_templates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"source_hint" text,
	"mapping" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_templates_user_id_name_key" UNIQUE("user_id","name")
);
--> statement-breakpoint
CREATE TABLE "portfolio"."instrument_overrides" (
	"user_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"asset_class" text,
	"sector_code" text,
	"country" char(2),
	"note" text,
	CONSTRAINT "instrument_overrides_pkey" PRIMARY KEY("user_id","instrument_id")
);
--> statement-breakpoint
CREATE TABLE "portfolio"."journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid,
	"instrument_id" uuid,
	"transaction_id" uuid,
	"analytics_run_id" uuid,
	"entry_date" date NOT NULL,
	"thesis" text NOT NULL,
	"horizon" text,
	"planned_exit" numeric(20, 8),
	"planned_risk" numeric(20, 8),
	"confidence" smallint,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"emotion" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entries_id_user_id_key" UNIQUE("id","user_id"),
	CONSTRAINT "journal_entries_confidence_check" CHECK ((((confidence >= 1) AND (confidence <= 5))))
);
--> statement-breakpoint
CREATE TABLE "portfolio"."journal_postmortems" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"journal_entry_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"closed_on" date,
	"process_score" smallint,
	"outcome_score" smallint,
	"went_well" text,
	"went_wrong" text,
	"lessons" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_postmortems_journal_entry_id_key" UNIQUE("journal_entry_id"),
	CONSTRAINT "journal_postmortems_outcome_score_check" CHECK ((((outcome_score >= 1) AND (outcome_score <= 5)))),
	CONSTRAINT "journal_postmortems_process_score_check" CHECK ((((process_score >= 1) AND (process_score <= 5))))
);
--> statement-breakpoint
CREATE TABLE "portfolio"."lot_consumptions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"close_transaction_id" uuid NOT NULL,
	"quantity" numeric(24, 10) NOT NULL,
	"cost_economic" numeric(20, 8) NOT NULL,
	"proceeds_economic" numeric(20, 8) NOT NULL,
	"realized_pl_economic" numeric(20, 8) NOT NULL,
	"cost_tax_pln" numeric(20, 8),
	"proceeds_tax_pln" numeric(20, 8),
	"realized_pl_tax_pln" numeric(20, 8),
	"fx_cost_pln" numeric(20, 8),
	"closed_on" date NOT NULL,
	CONSTRAINT "lot_consumptions_quantity_check" CHECK (((quantity > (0)::numeric)))
);
--> statement-breakpoint
CREATE TABLE "portfolio"."lots" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"open_transaction_id" uuid NOT NULL,
	"acquired_on" date NOT NULL,
	"quantity_open" numeric(24, 10) NOT NULL,
	"quantity_remaining" numeric(24, 10) NOT NULL,
	"cost_total" numeric(20, 8) NOT NULL,
	"cost_currency" char(3) NOT NULL,
	"cost_total_instrument_ccy" numeric(20, 8),
	"cost_total_tax_pln" numeric(20, 8),
	"fees_total" numeric(20, 8) DEFAULT 0 NOT NULL,
	"fx_fee_total" numeric(20, 8) DEFAULT 0 NOT NULL,
	"split_factor" numeric(24, 12) DEFAULT 1 NOT NULL,
	"closed_on" date,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lots_id_user_id_key" UNIQUE("id","user_id"),
	CONSTRAINT "lots_quantity_open_check" CHECK (((quantity_open > (0)::numeric))),
	CONSTRAINT "lots_quantity_remaining_check" CHECK (((quantity_remaining >= (0)::numeric)))
);
--> statement-breakpoint
CREATE TABLE "portfolio"."positions_daily" (
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"valuation_date" date NOT NULL,
	"quantity" numeric(24, 10) NOT NULL,
	"cost_basis" numeric(20, 8) NOT NULL,
	"price" numeric(20, 8),
	"price_currency" char(3),
	"price_as_of" timestamp with time zone,
	"fx_rate_to_account" numeric(18, 8),
	"market_value" numeric(20, 8),
	"market_value_pln" numeric(20, 8),
	"unrealized_pl_pln" numeric(20, 8),
	CONSTRAINT "positions_daily_pkey" PRIMARY KEY("account_id","instrument_id","valuation_date")
);
--> statement-breakpoint
CREATE TABLE "portfolio"."target_allocations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"account_id" uuid,
	"targets" jsonb NOT NULL,
	"tolerance_pp" numeric(6, 3) DEFAULT 5 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "target_allocations_user_id_name_key" UNIQUE("user_id","name")
);
--> statement-breakpoint
CREATE TABLE "portfolio"."transactions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"type" text NOT NULL,
	"trade_date" date NOT NULL,
	"executed_at" timestamp with time zone,
	"settle_date" date,
	"sequence" integer DEFAULT 0 NOT NULL,
	"instrument_id" uuid,
	"quantity" numeric(24, 10),
	"price" numeric(20, 8),
	"price_currency" char(3),
	"amount" numeric(20, 8) NOT NULL,
	"cash_currency" char(3) NOT NULL,
	"fee" numeric(20, 8) DEFAULT 0 NOT NULL,
	"fee_currency" char(3),
	"tax" numeric(20, 8) DEFAULT 0 NOT NULL,
	"tax_currency" char(3),
	"fx_rate" numeric(18, 8),
	"fx_source" text,
	"split_ratio" numeric(24, 12),
	"counter_amount" numeric(20, 8),
	"counter_currency" char(3),
	"category" text,
	"related_transaction_id" uuid,
	"source" text NOT NULL,
	"import_batch_id" uuid,
	"external_id" text,
	"created_by_api_key" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_id_user_id_key" UNIQUE("id","user_id"),
	CONSTRAINT "transactions_fx_source_check" CHECK (((fx_source = ANY (ARRAY['broker'::text, 'implied'::text, 'nbp_fallback'::text, 'manual'::text])))),
	CONSTRAINT "transactions_source_check" CHECK (((source = ANY (ARRAY['manual'::text, 'import'::text, 'quick'::text, 'demo'::text])))),
	CONSTRAINT "transactions_type_check" CHECK (((type = ANY (ARRAY['BUY'::text, 'SELL'::text, 'DIVIDEND'::text, 'INTEREST'::text, 'FEE'::text, 'TAX'::text, 'DEPOSIT'::text, 'WITHDRAWAL'::text, 'CASH_TRANSFER_IN'::text, 'CASH_TRANSFER_OUT'::text, 'FX_CONVERSION'::text, 'SPLIT'::text, 'SECURITY_TRANSFER_IN'::text, 'SECURITY_TRANSFER_OUT'::text, 'ADJUSTMENT'::text])))),
	CONSTRAINT "tx_fx_legs" CHECK ((((type <> 'FX_CONVERSION'::text) OR ((counter_amount IS NOT NULL) AND (counter_currency IS NOT NULL))))),
	CONSTRAINT "tx_instrument_required" CHECK ((((type <> ALL (ARRAY['BUY'::text, 'SELL'::text, 'DIVIDEND'::text, 'SPLIT'::text, 'SECURITY_TRANSFER_IN'::text, 'SECURITY_TRANSFER_OUT'::text])) OR (instrument_id IS NOT NULL)))),
	CONSTRAINT "tx_quantity_positive" CHECK ((((type <> ALL (ARRAY['BUY'::text, 'SELL'::text, 'SECURITY_TRANSFER_IN'::text, 'SECURITY_TRANSFER_OUT'::text])) OR ((quantity IS NOT NULL) AND (quantity > (0)::numeric))))),
	CONSTRAINT "tx_split_ratio" CHECK ((((type <> 'SPLIT'::text) OR ((split_ratio IS NOT NULL) AND (split_ratio > (0)::numeric)))))
);
--> statement-breakpoint
CREATE TABLE "portfolio"."valuations_daily" (
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"valuation_date" date NOT NULL,
	"market_value" numeric(20, 8) NOT NULL,
	"cash" numeric(20, 8) NOT NULL,
	"total_value" numeric(20, 8) NOT NULL,
	"total_value_pln" numeric(20, 8) NOT NULL,
	"external_flow" numeric(20, 8) DEFAULT 0 NOT NULL,
	"external_flow_pln" numeric(20, 8) DEFAULT 0 NOT NULL,
	"fx_rate_to_pln" numeric(18, 8),
	"as_of" timestamp with time zone NOT NULL,
	"is_complete" boolean DEFAULT true NOT NULL,
	CONSTRAINT "valuations_daily_pkey" PRIMARY KEY("account_id","valuation_date")
);
--> statement-breakpoint
ALTER TABLE "alerts"."alert_events" ADD CONSTRAINT "alert_events_rule_id_user_id_fkey" FOREIGN KEY ("rule_id","user_id") REFERENCES "alerts"."alert_rules"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts"."alert_rules" ADD CONSTRAINT "alert_rules_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "market"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts"."alert_rules" ADD CONSTRAINT "alert_rules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics"."analytics_runs" ADD CONSTRAINT "analytics_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics"."strategy_definitions" ADD CONSTRAINT "strategy_definitions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "education"."learning_progress" ADD CONSTRAINT "learning_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "education"."onboarding_state" ADD CONSTRAINT "onboarding_state_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."api_keys" ADD CONSTRAINT "api_keys_reference_id_fkey" FOREIGN KEY ("reference_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."two_factors" ADD CONSTRAINT "two_factors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."consent_events" ADD CONSTRAINT "consent_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."data_exports" ADD CONSTRAINT "data_exports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."deletion_requests" ADD CONSTRAINT "deletion_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."invitations" ADD CONSTRAINT "invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."invitations" ADD CONSTRAINT "invitations_used_by_fkey" FOREIGN KEY ("used_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."user_preferences" ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market"."bars_daily" ADD CONSTRAINT "bars_daily_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "market"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market"."bars_intraday" ADD CONSTRAINT "bars_intraday_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "market"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market"."calendar_events" ADD CONSTRAINT "calendar_events_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "market"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market"."corporate_actions" ADD CONSTRAINT "corporate_actions_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "market"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market"."data_quality_issues" ADD CONSTRAINT "data_quality_issues_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "market"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market"."fundamentals_snapshots" ADD CONSTRAINT "fundamentals_snapshots_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "market"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market"."instrument_provider_symbols" ADD CONSTRAINT "instrument_provider_symbols_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "market"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market"."macro_observations" ADD CONSTRAINT "macro_observations_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "market"."macro_series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market"."news_items" ADD CONSTRAINT "news_items_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "market"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market"."quotes_latest" ADD CONSTRAINT "quotes_latest_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "market"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market"."screener_presets" ADD CONSTRAINT "screener_presets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market"."sector_memberships" ADD CONSTRAINT "sector_memberships_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "market"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market"."sector_memberships" ADD CONSTRAINT "sector_memberships_sector_code_fkey" FOREIGN KEY ("sector_code") REFERENCES "market"."sectors"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market"."universe_members" ADD CONSTRAINT "universe_members_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "market"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market"."universe_members" ADD CONSTRAINT "universe_members_universe_id_fkey" FOREIGN KEY ("universe_id") REFERENCES "market"."universes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market"."watchlist_items" ADD CONSTRAINT "watchlist_items_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "market"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market"."watchlist_items" ADD CONSTRAINT "watchlist_items_watchlist_id_user_id_fkey" FOREIGN KEY ("watchlist_id","user_id") REFERENCES "market"."watchlists"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market"."watchlists" ADD CONSTRAINT "watchlists_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications"."notification_deliveries" ADD CONSTRAINT "notification_deliveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications"."notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications"."push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio"."accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio"."cash_balances_daily" ADD CONSTRAINT "cash_balances_daily_account_id_user_id_fkey" FOREIGN KEY ("account_id","user_id") REFERENCES "portfolio"."accounts"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio"."import_batches" ADD CONSTRAINT "import_batches_account_id_user_id_fkey" FOREIGN KEY ("account_id","user_id") REFERENCES "portfolio"."accounts"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio"."import_files" ADD CONSTRAINT "import_files_batch_id_user_id_fkey" FOREIGN KEY ("batch_id","user_id") REFERENCES "portfolio"."import_batches"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio"."import_rows" ADD CONSTRAINT "import_rows_batch_id_user_id_fkey" FOREIGN KEY ("batch_id","user_id") REFERENCES "portfolio"."import_batches"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio"."import_rows" ADD CONSTRAINT "import_rows_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "market"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio"."import_templates" ADD CONSTRAINT "import_templates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio"."instrument_overrides" ADD CONSTRAINT "instrument_overrides_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "market"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio"."instrument_overrides" ADD CONSTRAINT "instrument_overrides_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio"."journal_entries" ADD CONSTRAINT "journal_entries_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "market"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio"."journal_entries" ADD CONSTRAINT "journal_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio"."journal_postmortems" ADD CONSTRAINT "journal_postmortems_journal_entry_id_user_id_fkey" FOREIGN KEY ("journal_entry_id","user_id") REFERENCES "portfolio"."journal_entries"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio"."lot_consumptions" ADD CONSTRAINT "lot_consumptions_close_transaction_id_user_id_fkey" FOREIGN KEY ("close_transaction_id","user_id") REFERENCES "portfolio"."transactions"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio"."lot_consumptions" ADD CONSTRAINT "lot_consumptions_lot_id_user_id_fkey" FOREIGN KEY ("lot_id","user_id") REFERENCES "portfolio"."lots"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio"."lots" ADD CONSTRAINT "lots_account_id_user_id_fkey" FOREIGN KEY ("account_id","user_id") REFERENCES "portfolio"."accounts"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio"."lots" ADD CONSTRAINT "lots_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "market"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio"."lots" ADD CONSTRAINT "lots_open_transaction_id_user_id_fkey" FOREIGN KEY ("open_transaction_id","user_id") REFERENCES "portfolio"."transactions"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio"."positions_daily" ADD CONSTRAINT "positions_daily_account_id_user_id_fkey" FOREIGN KEY ("account_id","user_id") REFERENCES "portfolio"."accounts"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio"."positions_daily" ADD CONSTRAINT "positions_daily_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "market"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio"."target_allocations" ADD CONSTRAINT "target_allocations_account_id_user_id_fkey" FOREIGN KEY ("account_id","user_id") REFERENCES "portfolio"."accounts"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio"."target_allocations" ADD CONSTRAINT "target_allocations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio"."transactions" ADD CONSTRAINT "transactions_account_id_user_id_fkey" FOREIGN KEY ("account_id","user_id") REFERENCES "portfolio"."accounts"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio"."transactions" ADD CONSTRAINT "transactions_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "market"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio"."valuations_daily" ADD CONSTRAINT "valuations_daily_account_id_user_id_fkey" FOREIGN KEY ("account_id","user_id") REFERENCES "portfolio"."accounts"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "platform"."audit_log" USING btree (actor_user_id,occurred_at);--> statement-breakpoint
CREATE INDEX "audit_log_occurred_at_idx" ON "platform"."audit_log" USING btree (occurred_at);--> statement-breakpoint
CREATE INDEX "web_vitals_route_idx" ON "platform"."web_vitals" USING btree (route,metric,recorded_at);--> statement-breakpoint
CREATE INDEX "alert_events_user_idx" ON "alerts"."alert_events" USING btree (user_id,triggered_at);--> statement-breakpoint
CREATE INDEX "alert_rules_instrument_idx" ON "alerts"."alert_rules" USING btree (instrument_id) WHERE enabled;--> statement-breakpoint
CREATE INDEX "analytics_runs_user_idx" ON "analytics"."analytics_runs" USING btree (user_id,created_at);--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "auth"."accounts" USING btree (user_id);--> statement-breakpoint
CREATE INDEX "api_keys_key_idx" ON "auth"."api_keys" USING btree (key);--> statement-breakpoint
CREATE INDEX "api_keys_reference_id_idx" ON "auth"."api_keys" USING btree (reference_id);--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "auth"."sessions" USING btree (user_id);--> statement-breakpoint
CREATE INDEX "two_factors_user_id_idx" ON "auth"."two_factors" USING btree (user_id);--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "auth"."verifications" USING btree (identifier);--> statement-breakpoint
CREATE INDEX "consent_events_user_doc_idx" ON "identity"."consent_events" USING btree (user_id,document,recorded_at);--> statement-breakpoint
CREATE INDEX "bars_daily_session_date_brin" ON "market"."bars_daily" USING brin (session_date);--> statement-breakpoint
CREATE INDEX "calendar_events_date_idx" ON "market"."calendar_events" USING btree (event_date);--> statement-breakpoint
CREATE INDEX "corporate_actions_instrument_idx" ON "market"."corporate_actions" USING btree (instrument_id,ex_date);--> statement-breakpoint
CREATE INDEX "data_quality_issues_open_idx" ON "market"."data_quality_issues" USING btree (instrument_id) WHERE (status = 'open'::text);--> statement-breakpoint
CREATE INDEX "instrument_provider_symbols_instrument_idx" ON "market"."instrument_provider_symbols" USING btree (instrument_id);--> statement-breakpoint
CREATE UNIQUE INDEX "instruments_isin_mic_uq" ON "market"."instruments" USING btree (isin,mic) WHERE (isin IS NOT NULL);--> statement-breakpoint
CREATE UNIQUE INDEX "instruments_mic_ticker_uq" ON "market"."instruments" USING btree (mic,ticker) WHERE (ticker IS NOT NULL);--> statement-breakpoint
CREATE INDEX "instruments_name_idx" ON "market"."instruments" USING btree (lower(name));--> statement-breakpoint
CREATE INDEX "news_items_instrument_idx" ON "market"."news_items" USING btree (instrument_id,published_at);--> statement-breakpoint
CREATE INDEX "notification_deliveries_user_idx" ON "notifications"."notification_deliveries" USING btree (user_id,created_at);--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "notifications"."push_subscriptions" USING btree (user_id);--> statement-breakpoint
CREATE UNIQUE INDEX "import_batches_active_file_uq" ON "portfolio"."import_batches" USING btree (account_id,file_sha256) WHERE (status <> 'discarded'::text);--> statement-breakpoint
CREATE INDEX "import_rows_batch_idx" ON "portfolio"."import_rows" USING btree (batch_id,status);--> statement-breakpoint
CREATE INDEX "lot_consumptions_user_date_idx" ON "portfolio"."lot_consumptions" USING btree (user_id,closed_on);--> statement-breakpoint
CREATE INDEX "lots_fifo_idx" ON "portfolio"."lots" USING btree (account_id,instrument_id,acquired_on) WHERE (quantity_remaining > (0)::numeric);--> statement-breakpoint
CREATE INDEX "positions_daily_user_date_idx" ON "portfolio"."positions_daily" USING btree (user_id,valuation_date);--> statement-breakpoint
CREATE INDEX "transactions_account_date_idx" ON "portfolio"."transactions" USING btree (account_id,trade_date,sequence);--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_external_uq" ON "portfolio"."transactions" USING btree (account_id,source,external_id) WHERE (external_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "transactions_instrument_idx" ON "portfolio"."transactions" USING btree (account_id,instrument_id,trade_date);--> statement-breakpoint
CREATE INDEX "transactions_user_date_idx" ON "portfolio"."transactions" USING btree (user_id,trade_date);--> statement-breakpoint
CREATE INDEX "valuations_daily_user_date_idx" ON "portfolio"."valuations_daily" USING btree (user_id,valuation_date);