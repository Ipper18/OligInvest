-- =====================================================================================
-- OligInvest — docelowy schemat bazy danych (PostgreSQL 18)
-- Cel: jedno źródło prawdy dla struktury danych, ról i polityk RLS; migracje Drizzle
--      (packages/db) mają odtwarzać ten schemat, a test CI porównuje oba (ADR-004, ADR-012).
-- Konwencje: schemat PostgreSQL per moduł; tabele snake_case w liczbie mnogiej; identyfikatory
--      UUIDv7 (uuidv7() — PostgreSQL 18); kwoty NUMERIC + waluta CHAR(3) (ADR-014); czas timestamptz (UTC).
-- Uruchomienie: sekcja 0 — administrator bazy (superuser), jednorazowo; sekcje 1+ — rola oliginvest_owner.
-- Hasła ról ustawiane poza repozytorium (ALTER ROLE ... PASSWORD z menedżera sekretów).
-- =====================================================================================

-- =====================================================================================
-- 0. BOOTSTRAP: role (superuser)
-- =====================================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'oliginvest_owner') THEN
    CREATE ROLE oliginvest_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'oliginvest_auth') THEN
    CREATE ROLE oliginvest_auth LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'oliginvest_app') THEN
    CREATE ROLE oliginvest_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'oliginvest_analytics_ro') THEN
    CREATE ROLE oliginvest_analytics_ro LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'oliginvest_backup') THEN
    CREATE ROLE oliginvest_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
  END IF;
END
$$;

GRANT pg_read_all_data TO oliginvest_backup;                -- kopie zapasowe (pg_dump); poświadczenia poza kontenerami aplikacji
DO $$ BEGIN EXECUTE format('GRANT CREATE, CONNECT ON DATABASE %I TO oliginvest_owner', current_database()); END $$;
DO $$ BEGIN EXECUTE format('GRANT CONNECT ON DATABASE %I TO oliginvest_auth, oliginvest_app, oliginvest_analytics_ro, oliginvest_backup', current_database()); END $$;
DO $$ BEGIN EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database()); END $$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- Od tego miejsca obiekty tworzy właściciel schematu.
SET ROLE oliginvest_owner;

CREATE SCHEMA auth AUTHORIZATION oliginvest_owner;          -- Better Auth (tylko rola oliginvest_auth)
CREATE SCHEMA identity AUTHORIZATION oliginvest_owner;      -- moduł identity
CREATE SCHEMA platform AUTHORIZATION oliginvest_owner;      -- jądro: flagi, audyt, idempotencja
CREATE SCHEMA notifications AUTHORIZATION oliginvest_owner; -- moduł notifications
CREATE SCHEMA market AUTHORIZATION oliginvest_owner;        -- moduł market
CREATE SCHEMA portfolio AUTHORIZATION oliginvest_owner;     -- moduł portfolio
CREATE SCHEMA analytics AUTHORIZATION oliginvest_owner;     -- moduł analytics
CREATE SCHEMA alerts AUTHORIZATION oliginvest_owner;        -- moduł alerts
CREATE SCHEMA education AUTHORIZATION oliginvest_owner;     -- moduł education

-- =====================================================================================
-- 1. PLATFORM — funkcje pomocnicze kontekstu RLS
-- =====================================================================================
-- API/jobs ustawiają w KAŻDEJ transakcji: SET LOCAL app.user_id = '<uuid>'; SET LOCAL app.role = 'user|pro|admin|system'.
CREATE FUNCTION platform.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

CREATE FUNCTION platform.current_app_role() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT coalesce(nullif(current_setting('app.role', true), ''), 'anonymous') $$;

CREATE FUNCTION platform.set_updated_at() RETURNS trigger
  LANGUAGE plpgsql
  AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- =====================================================================================
-- 2. AUTH — tabele Better Auth (generateId: "uuid"; nazwy pól mapowane w Drizzle na snake_case).
-- Kanoniczna definicja pochodzi z `npx @better-auth/cli generate` (M1); test CI porównuje z poniższą.
-- =====================================================================================
CREATE TABLE auth.users (
  id                  uuid        PRIMARY KEY DEFAULT uuidv7(),
  name                text        NOT NULL,
  email               text        NOT NULL UNIQUE CHECK (email = lower(email)),
  email_verified      boolean     NOT NULL DEFAULT false,
  image               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  role                text        NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'pro', 'admin')),  -- wtyczka admin
  banned              boolean     NOT NULL DEFAULT false,
  ban_reason          text,
  ban_expires         timestamptz,
  two_factor_enabled  boolean     NOT NULL DEFAULT false                                            -- wtyczka twoFactor
);

CREATE TABLE auth.sessions (
  id               uuid        PRIMARY KEY DEFAULT uuidv7(),
  expires_at       timestamptz NOT NULL,
  token            text        NOT NULL UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  ip_address       text,
  user_agent       text,
  user_id          uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  impersonated_by  uuid,                 -- wtyczka admin; impersonacja WYŁĄCZONA w konfiguracji (ADR-004)
  mfa_verified_at  timestamptz           -- pole dodatkowe OligInvest: ostatnia weryfikacja TOTP (bramka MFA, step-up)
);
CREATE INDEX sessions_user_id_idx ON auth.sessions (user_id);

CREATE TABLE auth.accounts (
  id                        uuid        PRIMARY KEY DEFAULT uuidv7(),
  account_id                text        NOT NULL,
  provider_id               text        NOT NULL,       -- 'credential' | 'google' | 'github'
  issuer                    text,                       -- ❓ nowsze wersje Better Auth; potwierdzić przez CLI w M1
  user_id                   uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  access_token              text,                       -- tokeny OAuth: szyfrowane po stronie aplikacji (NFR-03.08)
  refresh_token             text,
  id_token                  text,
  access_token_expires_at   timestamptz,
  refresh_token_expires_at  timestamptz,
  scope                     text,
  password                  text,                       -- hash Argon2id ($argon2id$...), tylko provider 'credential'
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, account_id)
);
CREATE INDEX accounts_user_id_idx ON auth.accounts (user_id);

CREATE TABLE auth.verifications (
  id          uuid        PRIMARY KEY DEFAULT uuidv7(),
  identifier  text        NOT NULL,
  value       text        NOT NULL,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verifications_identifier_idx ON auth.verifications (identifier);

CREATE TABLE auth.two_factors (
  id                         uuid        PRIMARY KEY DEFAULT uuidv7(),
  secret                     text        NOT NULL,     -- weryfikacja szyfrowania w M1 (ADR-004 pkt 6)
  backup_codes               text        NOT NULL,     -- szyfrowane (domyślnie w Better Auth)
  user_id                    uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  verified                   boolean     DEFAULT true,
  failed_verification_count  integer     DEFAULT 0,
  locked_until               timestamptz
);
CREATE INDEX two_factors_user_id_idx ON auth.two_factors (user_id);

CREATE TABLE auth.api_keys (                                 -- wtyczka @better-auth/api-key (PAT użytkowników)
  id                      uuid        PRIMARY KEY DEFAULT uuidv7(),
  config_id               text        NOT NULL DEFAULT 'default',
  name                    text,
  start                   text,                          -- pierwsze znaki klucza do rozpoznania w UI
  prefix                  text,                          -- 'oli_pat_'
  key                     text        NOT NULL,          -- SHA-256 (base64url) — surowy klucz nigdy nie jest zapisywany
  reference_id            uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  refill_interval         bigint,
  refill_amount           integer,
  last_refill_at          timestamptz,
  enabled                 boolean     NOT NULL DEFAULT true,
  rate_limit_enabled      boolean     NOT NULL DEFAULT true,
  rate_limit_time_window  bigint,
  rate_limit_max          integer,
  request_count           integer     NOT NULL DEFAULT 0,
  remaining               integer,
  last_request            timestamptz,
  expires_at              timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  permissions             text,                          -- JSON zakresów, np. {"portfolio":["read"]}
  metadata                text
);
CREATE INDEX api_keys_reference_id_idx ON auth.api_keys (reference_id);
CREATE INDEX api_keys_key_idx ON auth.api_keys (key);

CREATE TABLE auth.rate_limits (                              -- limity Better Auth w bazie (storage: "database")
  id            uuid   PRIMARY KEY DEFAULT uuidv7(),
  key           text   NOT NULL UNIQUE,
  count         integer NOT NULL,
  last_request  bigint NOT NULL
);

-- =====================================================================================
-- 3. IDENTITY
-- =====================================================================================
CREATE TABLE identity.invitations (
  id           uuid        PRIMARY KEY DEFAULT uuidv7(),
  email        text        NOT NULL CHECK (email = lower(email)),
  role         text        NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'pro', 'admin')),
  token_hash   text        NOT NULL UNIQUE,                 -- SHA-256 tokenu z linku; token jawny tylko w e-mailu
  invited_by   uuid        NOT NULL REFERENCES auth.users (id),
  expires_at   timestamptz NOT NULL,                        -- domyślnie now() + 72 h (FR-07.01)
  used_at      timestamptz,
  used_by      uuid        REFERENCES auth.users (id),
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE identity.user_preferences (
  user_id            uuid        PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  base_currency      char(3)     NOT NULL DEFAULT 'PLN',
  cost_basis_method  text        NOT NULL DEFAULT 'fifo' CHECK (cost_basis_method IN ('fifo', 'average')),
  pl_view            text        NOT NULL DEFAULT 'economic' CHECK (pl_view IN ('economic', 'tax')),
  timezone           text        NOT NULL DEFAULT 'Europe/Warsaw',
  locale             text        NOT NULL DEFAULT 'pl-PL',
  theme              text        NOT NULL DEFAULT 'system' CHECK (theme IN ('system', 'light', 'dark')),
  pl_palette         text        NOT NULL DEFAULT 'default' CHECK (pl_palette IN ('default', 'colorblind')),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE identity.deletion_requests (
  id             uuid        PRIMARY KEY DEFAULT uuidv7(),
  user_id        uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  requested_at   timestamptz NOT NULL DEFAULT now(),
  scheduled_for  timestamptz NOT NULL,                      -- requested_at + 14 dni (FR-07.09)
  cancelled_at   timestamptz,
  completed_at   timestamptz
);

CREATE TABLE identity.data_exports (
  id            uuid        PRIMARY KEY DEFAULT uuidv7(),
  user_id       uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  status        text        NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'ready', 'failed', 'expired')),
  content       bytea,                                      -- ZIP (JSON + CSV); usuwany po pobraniu lub po 24 h
  size_bytes    bigint,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz,                                -- +24 h
  downloaded_at timestamptz
);

-- Katalog użytkowników dla modułów (bez danych uwierzytelniania); widok z uprawnieniami właściciela.
CREATE VIEW identity.user_directory WITH (security_barrier = true) AS
  SELECT u.id, u.name, u.email, u.role, u.banned, u.two_factor_enabled, u.created_at
  FROM auth.users u
  WHERE platform.current_app_role() IN ('admin', 'system') OR u.id = platform.current_user_id();

-- Zaproszenia: odczyt i zużycie przed zalogowaniem (rejestracja) wyłącznie przez funkcje.
CREATE FUNCTION identity.find_invitation(p_token_hash text)
  RETURNS TABLE (id uuid, email text, role text, expires_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, identity
  AS $$
    SELECT i.id, i.email, i.role, i.expires_at FROM identity.invitations i
    WHERE i.token_hash = p_token_hash AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
  $$;

CREATE FUNCTION identity.consume_invitation(p_token_hash text, p_user_id uuid)
  RETURNS boolean
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, identity
  AS $$
    WITH u AS (
      UPDATE identity.invitations SET used_at = now(), used_by = p_user_id
      WHERE token_hash = p_token_hash AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
      RETURNING 1)
    SELECT EXISTS (SELECT 1 FROM u)
  $$;

-- =====================================================================================
-- 4. PLATFORM — flagi, limity ról, audyt, idempotencja, RUM
-- =====================================================================================
CREATE TABLE platform.feature_flags (
  key          text        PRIMARY KEY,                     -- np. 'module.analytics.backtest'
  description  text        NOT NULL,
  enabled      boolean     NOT NULL DEFAULT false,
  rules        jsonb       NOT NULL DEFAULT '{}'::jsonb,     -- {"roles":["pro","admin"],"users":["<uuid>"]}
  updated_by   uuid,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform.role_limits (
  role        text        PRIMARY KEY CHECK (role IN ('user', 'pro', 'admin')),
  limits      jsonb       NOT NULL,                         -- {"analytics_heavy_per_day":20,"imports_per_day":20}
  updated_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform.audit_log (                           -- append-only (FR-08.05, FR-08.10)
  id             uuid        PRIMARY KEY DEFAULT uuidv7(),
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  actor_user_id  uuid,                                      -- NULL po usunięciu konta (Z-21) — zostaje actor_ref
  actor_ref      text        NOT NULL,                      -- pseudonim: sha256(user_id + sól) — trwały po usunięciu konta
  actor_type     text        NOT NULL CHECK (actor_type IN ('user', 'admin', 'system', 'pat')),
  action         text        NOT NULL,                      -- np. 'admin.flag.update', 'auth.sign_in', 'portfolio.import.commit'
  resource_type  text,
  resource_id    text,
  outcome        text        NOT NULL DEFAULT 'success' CHECK (outcome IN ('success', 'denied', 'error')),
  ip             inet,
  user_agent     text,
  request_id     text,
  before         jsonb,
  after          jsonb
);
CREATE INDEX audit_log_occurred_at_idx ON platform.audit_log (occurred_at DESC);
CREATE INDEX audit_log_actor_idx ON platform.audit_log (actor_user_id, occurred_at DESC);

CREATE TABLE platform.idempotency_keys (
  user_id        uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  key            text        NOT NULL,
  method         text        NOT NULL,
  path           text        NOT NULL,
  request_hash   text        NOT NULL,
  status_code    integer,
  response_body  jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,                      -- +24 h
  PRIMARY KEY (user_id, key)
);

CREATE TABLE platform.web_vitals (                          -- RUM (NFR-01.01), bez identyfikatora użytkownika
  id            uuid        PRIMARY KEY DEFAULT uuidv7(),
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  route         text        NOT NULL,
  metric        text        NOT NULL CHECK (metric IN ('LCP', 'INP', 'CLS', 'FCP', 'TTFB')),
  value         double precision NOT NULL,
  rating        text        CHECK (rating IN ('good', 'needs-improvement', 'poor')),
  device_class  text,                                       -- 'mobile' | 'desktop'
  connection    text                                        -- effectiveType z Network Information API (jeśli dostępne)
);
CREATE INDEX web_vitals_route_idx ON platform.web_vitals (route, metric, recorded_at DESC);

-- =====================================================================================
-- 5. NOTIFICATIONS
-- =====================================================================================
CREATE TABLE notifications.push_subscriptions (
  id               uuid        PRIMARY KEY DEFAULT uuidv7(),
  user_id          uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  endpoint         text        NOT NULL UNIQUE,
  p256dh           text        NOT NULL,
  auth             text        NOT NULL,
  user_agent       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_success_at  timestamptz,
  failure_count    integer     NOT NULL DEFAULT 0
);
CREATE INDEX push_subscriptions_user_idx ON notifications.push_subscriptions (user_id);

CREATE TABLE notifications.notification_preferences (
  user_id            uuid        PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  channels           jsonb       NOT NULL DEFAULT '{"push": true, "email": true}'::jsonb,
  quiet_hours_start  time,
  quiet_hours_end    time,
  email_fallback     boolean     NOT NULL DEFAULT true,       -- e-mail, gdy brak subskrypcji push (FR-05.06)
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications.notification_deliveries (
  id          uuid        PRIMARY KEY DEFAULT uuidv7(),
  user_id     uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  kind        text        NOT NULL CHECK (kind IN ('alert', 'system', 'export', 'invitation', 'security')),
  source_ref  text,                                         -- np. alert_event id
  channel     text        NOT NULL CHECK (channel IN ('push', 'email')),
  status      text        NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz
);
CREATE INDEX notification_deliveries_user_idx ON notifications.notification_deliveries (user_id, created_at DESC);

-- =====================================================================================
-- 6. MARKET — dane rynkowe (globalne) + dane użytkownika (watchlisty, presety)
-- =====================================================================================
CREATE TABLE market.instruments (
  id                   uuid        PRIMARY KEY DEFAULT uuidv7(),
  isin                 text        CHECK (isin ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$'),
  mic                  text        NOT NULL,                  -- ISO 10383: XWAR, XNYS, XNAS, XETR, XLON...
  ticker               text,                                  -- symbol giełdowy (np. PKO)
  exchange_short_name  text,                                  -- np. nazwa skrócona GPW (PKOBP)
  name                 text        NOT NULL,
  type                 text        NOT NULL CHECK (type IN ('stock', 'etf', 'etc', 'etn', 'index', 'fx', 'commodity', 'bond', 'fund', 'crypto')),
  currency             char(3)     NOT NULL,
  country              char(2),
  asset_class          text        NOT NULL DEFAULT 'equity' CHECK (asset_class IN ('equity', 'bond', 'commodity', 'cash', 'fx', 'crypto', 'real_estate', 'other')),
  sector_code          text,
  lot_size             numeric(24,10) NOT NULL DEFAULT 1,
  supports_fractional  boolean     NOT NULL DEFAULT false,
  is_active            boolean     NOT NULL DEFAULT true,
  delisted_on          date,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX instruments_isin_mic_uq ON market.instruments (isin, mic) WHERE isin IS NOT NULL;
CREATE UNIQUE INDEX instruments_mic_ticker_uq ON market.instruments (mic, ticker) WHERE ticker IS NOT NULL;
CREATE INDEX instruments_name_idx ON market.instruments (lower(name));

CREATE TABLE market.instrument_provider_symbols (
  provider       text        NOT NULL CHECK (provider IN ('gpw', 'yahoo', 'stooq', 'finnhub', 'twelvedata', 'alphavantage', 'fmp', 'eodhd', 'xtb', 'mbank', 'openfigi')),
  symbol         text        NOT NULL,                      -- np. 'PKO.WA' (yahoo), 'PKO.PL' (xtb), 'PKO BP' (mbank)
  instrument_id  uuid        NOT NULL REFERENCES market.instruments (id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, symbol)
);
CREATE INDEX instrument_provider_symbols_instrument_idx ON market.instrument_provider_symbols (instrument_id);

CREATE TABLE market.bars_daily (
  instrument_id      uuid           NOT NULL REFERENCES market.instruments (id) ON DELETE CASCADE,
  session_date       date           NOT NULL,
  open               numeric(20,8),
  high               numeric(20,8),
  low                numeric(20,8),
  close              numeric(20,8)  NOT NULL,
  volume             numeric(24,4)  NOT NULL DEFAULT 0 CHECK (volume >= 0),
  turnover           numeric(24,4),                          -- w walucie notowania (GPW: tys. zł × 1000)
  trades             integer,
  no_trades          boolean        NOT NULL DEFAULT false,  -- GPW: wolumen 0 (świeca techniczna)
  adjustment_factor  numeric(24,12) NOT NULL DEFAULT 1,      -- skumulowany współczynnik splitów (ceny skorygowane = cena × factor)
  source             text           NOT NULL,
  ingested_at        timestamptz    NOT NULL DEFAULT now(),
  PRIMARY KEY (instrument_id, session_date)
);
CREATE INDEX bars_daily_session_date_brin ON market.bars_daily USING brin (session_date);

CREATE TABLE market.bars_intraday (                          -- retencja 90 dni
  instrument_id  uuid          NOT NULL REFERENCES market.instruments (id) ON DELETE CASCADE,
  interval       text          NOT NULL CHECK (interval IN ('5m', '15m', '1h')),
  ts             timestamptz   NOT NULL,
  open           numeric(20,8),
  high           numeric(20,8),
  low            numeric(20,8),
  close          numeric(20,8) NOT NULL,
  volume         numeric(24,4) NOT NULL DEFAULT 0,
  source         text          NOT NULL,
  PRIMARY KEY (instrument_id, interval, ts)
);

CREATE TABLE market.quotes_latest (
  instrument_id  uuid          PRIMARY KEY REFERENCES market.instruments (id) ON DELETE CASCADE,
  price          numeric(20,8) NOT NULL,
  prev_close     numeric(20,8),
  change         numeric(20,8),
  change_pct     double precision,
  volume         numeric(24,4),
  as_of          timestamptz   NOT NULL,                     -- czas notowania u źródła
  delay_minutes  integer       NOT NULL DEFAULT 15,
  source         text          NOT NULL,
  fetched_at     timestamptz   NOT NULL DEFAULT now()
);

CREATE TABLE market.fx_rates (
  base        char(3)       NOT NULL,
  quote       char(3)       NOT NULL,
  rate_date   date          NOT NULL,
  rate        numeric(18,8) NOT NULL CHECK (rate > 0),
  source      text          NOT NULL CHECK (source IN ('nbp', 'ecb')),
  table_no    text,                                          -- np. '180/A/NBP/2026'
  fetched_at  timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (base, quote, rate_date, source)
);

CREATE TABLE market.corporate_actions (
  id             uuid           PRIMARY KEY DEFAULT uuidv7(),
  instrument_id  uuid           NOT NULL REFERENCES market.instruments (id) ON DELETE CASCADE,
  type           text           NOT NULL CHECK (type IN ('split', 'reverse_split', 'dividend', 'isin_change', 'name_change', 'delisting', 'rights_issue')),
  ex_date        date           NOT NULL,
  record_date    date,
  pay_date       date,
  ratio          numeric(24,12),                             -- split 4:1 → 4; scalenie 1:10 → 0.1
  amount         numeric(20,8),
  currency       char(3),
  details        jsonb          NOT NULL DEFAULT '{}'::jsonb,
  source         text           NOT NULL,
  confirmed_by   uuid,
  created_at     timestamptz    NOT NULL DEFAULT now()
);
CREATE INDEX corporate_actions_instrument_idx ON market.corporate_actions (instrument_id, ex_date);

CREATE TABLE market.trading_calendar (
  mic           text    NOT NULL,
  session_date  date    NOT NULL,
  is_open       boolean NOT NULL,
  open_time     time,
  close_time    time,
  timezone      text    NOT NULL,
  notes         text,
  PRIMARY KEY (mic, session_date)
);

CREATE TABLE market.sectors (
  code     text PRIMARY KEY,
  scheme   text NOT NULL CHECK (scheme IN ('gpw_subindex', 'provider')),
  name_pl  text NOT NULL,
  name_en  text
);

CREATE TABLE market.sector_memberships (
  instrument_id  uuid NOT NULL REFERENCES market.instruments (id) ON DELETE CASCADE,
  sector_code    text NOT NULL REFERENCES market.sectors (code),
  valid_from     date NOT NULL,
  valid_to       date,
  source         text NOT NULL,
  PRIMARY KEY (instrument_id, sector_code, valid_from)
);

CREATE TABLE market.universes (                              -- np. 'us-large-caps' (Z-11), 'benchmarks'
  id           uuid        PRIMARY KEY DEFAULT uuidv7(),
  code         text        NOT NULL UNIQUE,
  name         text        NOT NULL,
  description  text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE market.universe_members (
  universe_id    uuid NOT NULL REFERENCES market.universes (id) ON DELETE CASCADE,
  instrument_id  uuid NOT NULL REFERENCES market.instruments (id) ON DELETE CASCADE,
  valid_from     date NOT NULL,
  valid_to       date,
  PRIMARY KEY (universe_id, instrument_id, valid_from)
);

CREATE TABLE market.calendar_events (
  id             uuid        PRIMARY KEY DEFAULT uuidv7(),
  instrument_id  uuid        REFERENCES market.instruments (id) ON DELETE CASCADE,
  type           text        NOT NULL CHECK (type IN ('earnings', 'macro', 'dividend', 'other')),
  event_date     date        NOT NULL,
  event_time     time,
  title          text        NOT NULL,
  details        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  source         text        NOT NULL CHECK (source IN ('alphavantage', 'fmp', 'fred', 'admin')),
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX calendar_events_date_idx ON market.calendar_events (event_date);

CREATE TABLE market.news_items (                             -- retencja 90 dni
  id                uuid        PRIMARY KEY DEFAULT uuidv7(),
  instrument_id     uuid        REFERENCES market.instruments (id) ON DELETE CASCADE,
  market            text,
  published_at      timestamptz NOT NULL,
  title             text        NOT NULL,
  url               text        NOT NULL UNIQUE,
  source_domain     text        NOT NULL,
  language          text,
  tone              double precision,                        -- GDELT: ton artykułu (nie sygnał inwestycyjny)
  sentiment_score   double precision,
  sentiment_source  text,
  fetched_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX news_items_instrument_idx ON market.news_items (instrument_id, published_at DESC);

CREATE TABLE market.macro_series (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  code       text NOT NULL UNIQUE,                           -- np. 'FRED:DGS3MO', 'NBP:REF_RATE'
  name       text NOT NULL,
  unit       text NOT NULL,
  frequency  text NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'quarterly', 'annual', 'event')),
  source     text NOT NULL CHECK (source IN ('fred', 'nbp', 'admin'))
);

CREATE TABLE market.macro_observations (
  series_id  uuid          NOT NULL REFERENCES market.macro_series (id) ON DELETE CASCADE,
  obs_date   date          NOT NULL,
  value      numeric(20,8) NOT NULL,
  PRIMARY KEY (series_id, obs_date)
);

CREATE TABLE market.fundamentals_snapshots (
  instrument_id  uuid        NOT NULL REFERENCES market.instruments (id) ON DELETE CASCADE,
  period_end     date        NOT NULL,
  period_type    text        NOT NULL CHECK (period_type IN ('Q', 'Y')),
  data           jsonb       NOT NULL,
  source         text        NOT NULL,
  fetched_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instrument_id, period_end, period_type)
);

CREATE TABLE market.data_quality_issues (
  id             uuid        PRIMARY KEY DEFAULT uuidv7(),
  instrument_id  uuid        NOT NULL REFERENCES market.instruments (id) ON DELETE CASCADE,
  session_date   date,
  check_code     text        NOT NULL,                       -- 'ohlc_integrity', 'gap', 'jump_without_action', ...
  severity       text        NOT NULL CHECK (severity IN ('BLOCK', 'WARN', 'INFO')),
  details        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status         text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'ignored')),
  resolved_by    uuid,
  resolved_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX data_quality_issues_open_idx ON market.data_quality_issues (instrument_id) WHERE status = 'open';

CREATE TABLE market.watchlists (
  id          uuid        PRIMARY KEY DEFAULT uuidv7(),
  user_id     uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name        text        NOT NULL,
  position    integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id),
  UNIQUE (user_id, name)
);

CREATE TABLE market.watchlist_items (
  watchlist_id   uuid        NOT NULL,
  user_id        uuid        NOT NULL,
  instrument_id  uuid        NOT NULL REFERENCES market.instruments (id) ON DELETE CASCADE,
  position       integer     NOT NULL DEFAULT 0,
  note           text,
  added_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (watchlist_id, instrument_id),
  FOREIGN KEY (watchlist_id, user_id) REFERENCES market.watchlists (id, user_id) ON DELETE CASCADE
);

CREATE TABLE market.screener_presets (
  id          uuid        PRIMARY KEY DEFAULT uuidv7(),
  user_id     uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name        text        NOT NULL,
  universe    text        NOT NULL DEFAULT 'gpw_all',
  criteria    jsonb       NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

-- =====================================================================================
-- 7. PORTFOLIO — dane użytkownika (RLS). Tabele „pochodne” są odtwarzalne z operacji.
-- =====================================================================================
CREATE TABLE portfolio.accounts (
  id            uuid        PRIMARY KEY DEFAULT uuidv7(),
  user_id       uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name          text        NOT NULL,
  broker        text        NOT NULL CHECK (broker IN ('xtb', 'mbank', 'other', 'demo')),
  account_type  text        NOT NULL DEFAULT 'regular' CHECK (account_type IN ('regular', 'ike', 'ikze', 'demo')),
  currency      char(3)     NOT NULL,
  external_ref  text,                                        -- ostatnie 4 znaki numeru rachunku (nigdy pełny numer)
  opened_on     date,
  closed_on     date,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id),
  UNIQUE (user_id, name)
);

CREATE TABLE portfolio.import_batches (
  id               uuid        PRIMARY KEY DEFAULT uuidv7(),
  user_id          uuid        NOT NULL,
  account_id       uuid        NOT NULL,
  source           text        NOT NULL CHECK (source IN ('xtb', 'mbank', 'generic')),
  format_detected  text,                                     -- np. 'xtb.cash_operations.new_with_ticker'
  file_name        text        NOT NULL,
  file_sha256      text        NOT NULL,
  status           text        NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'parsing', 'parsed', 'committed', 'discarded', 'failed')),
  summary          jsonb,
  reconciliation   jsonb,
  error            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  parsed_at        timestamptz,
  committed_at     timestamptz,
  UNIQUE (id, user_id),
  FOREIGN KEY (account_id, user_id) REFERENCES portfolio.accounts (id, user_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX import_batches_active_file_uq ON portfolio.import_batches (account_id, file_sha256) WHERE status <> 'discarded';

CREATE TABLE portfolio.import_files (                        -- retencja 90 dni (NFR-11.02)
  batch_id      uuid        PRIMARY KEY,
  user_id       uuid        NOT NULL,
  content       bytea       NOT NULL,
  content_type  text        NOT NULL,
  size_bytes    integer     NOT NULL CHECK (size_bytes <= 10485760),
  expires_at    timestamptz NOT NULL,
  FOREIGN KEY (batch_id, user_id) REFERENCES portfolio.import_batches (id, user_id) ON DELETE CASCADE
);

CREATE TABLE portfolio.import_templates (
  id           uuid        PRIMARY KEY DEFAULT uuidv7(),
  user_id      uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name         text        NOT NULL,
  source_hint  text,
  mapping      jsonb       NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE TABLE portfolio.transactions (
  id                      uuid           PRIMARY KEY DEFAULT uuidv7(),
  user_id                 uuid           NOT NULL,
  account_id              uuid           NOT NULL,
  type                    text           NOT NULL CHECK (type IN (
                            'BUY', 'SELL', 'DIVIDEND', 'INTEREST', 'FEE', 'TAX', 'DEPOSIT', 'WITHDRAWAL',
                            'CASH_TRANSFER_IN', 'CASH_TRANSFER_OUT', 'FX_CONVERSION', 'SPLIT',
                            'SECURITY_TRANSFER_IN', 'SECURITY_TRANSFER_OUT', 'ADJUSTMENT')),
  trade_date              date           NOT NULL,
  executed_at             timestamptz,
  settle_date             date,
  sequence                integer        NOT NULL DEFAULT 0,  -- kolejność w obrębie dnia (obliczenia-finansowe.md § 1)
  instrument_id           uuid           REFERENCES market.instruments (id),
  quantity                numeric(24,10),
  price                   numeric(20,8),
  price_currency          char(3),
  amount                  numeric(20,8)  NOT NULL,           -- wpływ na gotówkę (ze znakiem) w cash_currency
  cash_currency           char(3)        NOT NULL,
  fee                     numeric(20,8)  NOT NULL DEFAULT 0,
  fee_currency            char(3),
  tax                     numeric(20,8)  NOT NULL DEFAULT 0, -- np. podatek u źródła dywidendy
  tax_currency            char(3),
  fx_rate                 numeric(18,8),                     -- price_currency → cash_currency, kurs brokera
  fx_source               text           CHECK (fx_source IN ('broker', 'implied', 'nbp_fallback', 'manual')),
  split_ratio             numeric(24,12),
  counter_amount          numeric(20,8),                     -- druga noga FX_CONVERSION
  counter_currency        char(3),
  category                text,                              -- podtyp: 'sec_fee', 'ftt', 'interest_tax', 'cfd_pl', ...
  related_transaction_id  uuid,                              -- powiązana operacja tego samego użytkownika (FK złożony poniżej)
  source                  text           NOT NULL CHECK (source IN ('manual', 'import', 'quick', 'demo')),
  import_batch_id         uuid,
  external_id             text,
  created_by_api_key      uuid,                              -- PAT, jeśli operację dodał skrót (FR-09.04)
  note                    text,
  created_at              timestamptz    NOT NULL DEFAULT now(),
  updated_at              timestamptz    NOT NULL DEFAULT now(),
  UNIQUE (id, user_id),
  FOREIGN KEY (account_id, user_id) REFERENCES portfolio.accounts (id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (related_transaction_id, user_id) REFERENCES portfolio.transactions (id, user_id) ON DELETE SET NULL (related_transaction_id),
  FOREIGN KEY (import_batch_id, user_id) REFERENCES portfolio.import_batches (id, user_id) ON DELETE SET NULL (import_batch_id),
  CONSTRAINT tx_instrument_required CHECK (
    type NOT IN ('BUY', 'SELL', 'DIVIDEND', 'SPLIT', 'SECURITY_TRANSFER_IN', 'SECURITY_TRANSFER_OUT') OR instrument_id IS NOT NULL),
  CONSTRAINT tx_quantity_positive CHECK (
    type NOT IN ('BUY', 'SELL', 'SECURITY_TRANSFER_IN', 'SECURITY_TRANSFER_OUT') OR (quantity IS NOT NULL AND quantity > 0)),
  CONSTRAINT tx_split_ratio CHECK (type <> 'SPLIT' OR (split_ratio IS NOT NULL AND split_ratio > 0)),
  CONSTRAINT tx_fx_legs CHECK (type <> 'FX_CONVERSION' OR (counter_amount IS NOT NULL AND counter_currency IS NOT NULL))
);
CREATE UNIQUE INDEX transactions_external_uq ON portfolio.transactions (account_id, source, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX transactions_account_date_idx ON portfolio.transactions (account_id, trade_date, sequence);
CREATE INDEX transactions_user_date_idx ON portfolio.transactions (user_id, trade_date);
CREATE INDEX transactions_instrument_idx ON portfolio.transactions (account_id, instrument_id, trade_date);

CREATE TABLE portfolio.import_rows (
  id              uuid        PRIMARY KEY DEFAULT uuidv7(),
  batch_id        uuid        NOT NULL,
  user_id         uuid        NOT NULL,
  row_number      integer     NOT NULL,
  sheet           text,
  raw             jsonb       NOT NULL,
  normalized      jsonb,
  status          text        NOT NULL CHECK (status IN ('new', 'duplicate', 'unsupported', 'needs_mapping', 'error', 'skipped')),
  status_reason   text,
  dedupe_key      text        NOT NULL,
  instrument_id   uuid        REFERENCES market.instruments (id),
  transaction_id  uuid,
  FOREIGN KEY (batch_id, user_id) REFERENCES portfolio.import_batches (id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (transaction_id, user_id) REFERENCES portfolio.transactions (id, user_id) ON DELETE SET NULL (transaction_id)
);
CREATE INDEX import_rows_batch_idx ON portfolio.import_rows (batch_id, status);

CREATE TABLE portfolio.instrument_overrides (                -- ręczna klasyfikacja per użytkownik (FR-02.05)
  user_id        uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  instrument_id  uuid NOT NULL REFERENCES market.instruments (id) ON DELETE CASCADE,
  asset_class    text,
  sector_code    text,
  country        char(2),
  note           text,
  PRIMARY KEY (user_id, instrument_id)
);

-- ---- pochodne (odtwarzane przez zadanie recompute) ----
CREATE TABLE portfolio.lots (
  id                        uuid           PRIMARY KEY DEFAULT uuidv7(),
  user_id                   uuid           NOT NULL,
  account_id                uuid           NOT NULL,
  instrument_id             uuid           NOT NULL REFERENCES market.instruments (id),
  open_transaction_id       uuid           NOT NULL,
  acquired_on               date           NOT NULL,
  quantity_open             numeric(24,10) NOT NULL CHECK (quantity_open > 0),
  quantity_remaining        numeric(24,10) NOT NULL CHECK (quantity_remaining >= 0),
  cost_total                numeric(20,8)  NOT NULL,         -- widok ekonomiczny, waluta rachunku
  cost_currency             char(3)        NOT NULL,
  cost_total_instrument_ccy numeric(20,8),
  cost_total_tax_pln        numeric(20,8),                    -- widok podatkowy (NBP D-1)
  fees_total                numeric(20,8)  NOT NULL DEFAULT 0,
  split_factor              numeric(24,12) NOT NULL DEFAULT 1,
  closed_on                 date,
  computed_at               timestamptz    NOT NULL DEFAULT now(),
  UNIQUE (id, user_id),
  FOREIGN KEY (account_id, user_id) REFERENCES portfolio.accounts (id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (open_transaction_id, user_id) REFERENCES portfolio.transactions (id, user_id) ON DELETE CASCADE
);
CREATE INDEX lots_fifo_idx ON portfolio.lots (account_id, instrument_id, acquired_on) WHERE quantity_remaining > 0;

CREATE TABLE portfolio.lot_consumptions (
  id                    uuid           PRIMARY KEY DEFAULT uuidv7(),
  user_id               uuid           NOT NULL,
  lot_id                uuid           NOT NULL,
  close_transaction_id  uuid           NOT NULL,
  quantity              numeric(24,10) NOT NULL CHECK (quantity > 0),
  cost_economic         numeric(20,8)  NOT NULL,
  proceeds_economic     numeric(20,8)  NOT NULL,
  realized_pl_economic  numeric(20,8)  NOT NULL,
  cost_tax_pln          numeric(20,8),
  proceeds_tax_pln      numeric(20,8),
  realized_pl_tax_pln   numeric(20,8),
  closed_on             date           NOT NULL,
  FOREIGN KEY (lot_id, user_id) REFERENCES portfolio.lots (id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (close_transaction_id, user_id) REFERENCES portfolio.transactions (id, user_id) ON DELETE CASCADE
);
CREATE INDEX lot_consumptions_user_date_idx ON portfolio.lot_consumptions (user_id, closed_on);

CREATE TABLE portfolio.positions_daily (
  user_id               uuid           NOT NULL,
  account_id            uuid           NOT NULL,
  instrument_id         uuid           NOT NULL REFERENCES market.instruments (id),
  valuation_date        date           NOT NULL,
  quantity              numeric(24,10) NOT NULL,
  cost_basis            numeric(20,8)  NOT NULL,             -- waluta rachunku
  price                 numeric(20,8),
  price_currency        char(3),
  price_as_of           timestamptz,
  fx_rate_to_account    numeric(18,8),
  market_value          numeric(20,8),                        -- waluta rachunku
  market_value_pln      numeric(20,8),
  unrealized_pl_pln     numeric(20,8),
  PRIMARY KEY (account_id, instrument_id, valuation_date),
  FOREIGN KEY (account_id, user_id) REFERENCES portfolio.accounts (id, user_id) ON DELETE CASCADE
);
CREATE INDEX positions_daily_user_date_idx ON portfolio.positions_daily (user_id, valuation_date);

CREATE TABLE portfolio.cash_balances_daily (
  user_id         uuid          NOT NULL,
  account_id      uuid          NOT NULL,
  currency        char(3)       NOT NULL,
  valuation_date  date          NOT NULL,
  balance         numeric(20,8) NOT NULL,
  PRIMARY KEY (account_id, currency, valuation_date),
  FOREIGN KEY (account_id, user_id) REFERENCES portfolio.accounts (id, user_id) ON DELETE CASCADE
);

CREATE TABLE portfolio.valuations_daily (
  user_id            uuid          NOT NULL,
  account_id         uuid          NOT NULL,
  valuation_date     date          NOT NULL,
  market_value       numeric(20,8) NOT NULL,                  -- waluta rachunku
  cash               numeric(20,8) NOT NULL,
  total_value        numeric(20,8) NOT NULL,
  total_value_pln    numeric(20,8) NOT NULL,
  external_flow      numeric(20,8) NOT NULL DEFAULT 0,        -- F_d (obliczenia-finansowe.md § 6.2)
  external_flow_pln  numeric(20,8) NOT NULL DEFAULT 0,
  fx_rate_to_pln     numeric(18,8),
  as_of              timestamptz   NOT NULL,
  is_complete        boolean       NOT NULL DEFAULT true,     -- false: brak ceny/kursu dla części pozycji
  PRIMARY KEY (account_id, valuation_date),
  FOREIGN KEY (account_id, user_id) REFERENCES portfolio.accounts (id, user_id) ON DELETE CASCADE
);
CREATE INDEX valuations_daily_user_date_idx ON portfolio.valuations_daily (user_id, valuation_date);

-- ---- dziennik i alokacja ----
CREATE TABLE portfolio.journal_entries (
  id               uuid        PRIMARY KEY DEFAULT uuidv7(),
  user_id          uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  account_id       uuid,
  instrument_id    uuid        REFERENCES market.instruments (id),
  transaction_id   uuid,
  analytics_run_id uuid,                                     -- powiązanie decyzji z analizą (§ 13.2 wzorów)
  entry_date       date        NOT NULL,
  thesis           text        NOT NULL,
  horizon          text,
  planned_exit     numeric(20,8),
  planned_risk     numeric(20,8),                             -- kwota ryzyka w walucie rachunku (R-multiple)
  confidence       smallint    CHECK (confidence BETWEEN 1 AND 5),
  tags             text[]      NOT NULL DEFAULT '{}',
  emotion          text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id),
  FOREIGN KEY (account_id, user_id) REFERENCES portfolio.accounts (id, user_id) ON DELETE SET NULL (account_id),
  FOREIGN KEY (transaction_id, user_id) REFERENCES portfolio.transactions (id, user_id) ON DELETE SET NULL (transaction_id)
);

CREATE TABLE portfolio.journal_postmortems (
  id                uuid        PRIMARY KEY DEFAULT uuidv7(),
  journal_entry_id  uuid        NOT NULL UNIQUE,
  user_id           uuid        NOT NULL,
  closed_on         date,
  process_score     smallint    CHECK (process_score BETWEEN 1 AND 5),
  outcome_score     smallint    CHECK (outcome_score BETWEEN 1 AND 5),
  went_well         text,
  went_wrong        text,
  lessons           text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (journal_entry_id, user_id) REFERENCES portfolio.journal_entries (id, user_id) ON DELETE CASCADE
);

CREATE TABLE portfolio.target_allocations (
  id            uuid        PRIMARY KEY DEFAULT uuidv7(),
  user_id       uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name          text        NOT NULL,
  account_id    uuid,                                        -- NULL = wszystkie rachunki
  targets       jsonb       NOT NULL,                        -- [{"instrumentId"|"assetClass": ..., "weight": "0.60"}]
  tolerance_pp  numeric(6,3) NOT NULL DEFAULT 5,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name),
  FOREIGN KEY (account_id, user_id) REFERENCES portfolio.accounts (id, user_id) ON DELETE CASCADE
);

-- =====================================================================================
-- 8. ANALYTICS
-- =====================================================================================
CREATE TABLE analytics.analytics_runs (
  id                 uuid        PRIMARY KEY DEFAULT uuidv7(),
  user_id            uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  type               text        NOT NULL CHECK (type IN ('monte_carlo', 'optimization', 'stress_test', 'what_if', 'backtest', 'goal', 'rebalance')),
  status             text        NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  params             jsonb       NOT NULL,
  input_snapshot     jsonb       NOT NULL,                   -- wagi, przepływy, mapowanie proxy — stan na moment uruchomienia
  result             jsonb,
  assumptions        jsonb,
  warnings           jsonb       NOT NULL DEFAULT '[]'::jsonb,
  seed               bigint,
  algorithm_version  text        NOT NULL,
  data_version       jsonb,                                  -- serie i zakresy dat (NFR-08.05)
  progress           smallint    NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  error              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  started_at         timestamptz,
  finished_at        timestamptz,
  duration_ms        integer
);
CREATE INDEX analytics_runs_user_idx ON analytics.analytics_runs (user_id, created_at DESC);

CREATE TABLE analytics.stress_scenarios (                    -- globalne, edytowane przez admina
  key          text        PRIMARY KEY,
  name         text        NOT NULL,
  kind         text        NOT NULL CHECK (kind IN ('historical', 'hypothetical')),
  start_date   date,
  end_date     date,
  shocks       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  description  text        NOT NULL,
  enabled      boolean     NOT NULL DEFAULT true,
  updated_by   uuid,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'historical' OR (start_date IS NOT NULL AND end_date IS NOT NULL AND start_date < end_date))
);

CREATE TABLE analytics.strategy_definitions (
  id          uuid        PRIMARY KEY DEFAULT uuidv7(),
  user_id     uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name        text        NOT NULL,
  definition  jsonb       NOT NULL,                          -- reguły wejścia/wyjścia, wielkość pozycji, uniwersum
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

-- =====================================================================================
-- 9. ALERTS
-- =====================================================================================
CREATE TABLE alerts.alert_rules (
  id                 uuid        PRIMARY KEY DEFAULT uuidv7(),
  user_id            uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  type               text        NOT NULL CHECK (type IN ('price_above', 'price_below', 'change_pct', 'indicator',
                                   'portfolio_change', 'drawdown', 'allocation_drift', 'earnings', 'news')),
  instrument_id      uuid        REFERENCES market.instruments (id) ON DELETE CASCADE,
  params             jsonb       NOT NULL,
  channels           text[]      NOT NULL DEFAULT '{push,email}',
  cooldown_minutes   integer     NOT NULL DEFAULT 1440,
  hysteresis_pct     numeric(6,3) NOT NULL DEFAULT 0.5,
  enabled            boolean     NOT NULL DEFAULT true,
  last_triggered_at  timestamptz,
  last_state         jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id)
);
CREATE INDEX alert_rules_instrument_idx ON alerts.alert_rules (instrument_id) WHERE enabled;

CREATE TABLE alerts.alert_events (
  id            uuid        PRIMARY KEY DEFAULT uuidv7(),
  user_id       uuid        NOT NULL,
  rule_id       uuid        NOT NULL,
  triggered_at  timestamptz NOT NULL DEFAULT now(),
  value         numeric(20,8),
  threshold     numeric(20,8),
  data_as_of    timestamptz NOT NULL,
  data_source   text        NOT NULL,
  payload       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (rule_id, user_id) REFERENCES alerts.alert_rules (id, user_id) ON DELETE CASCADE
);
CREATE INDEX alert_events_user_idx ON alerts.alert_events (user_id, triggered_at DESC);

-- =====================================================================================
-- 10. EDUCATION
-- =====================================================================================
CREATE TABLE education.onboarding_state (
  user_id       uuid        PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  step          text        NOT NULL DEFAULT 'start',
  completed_at  timestamptz,
  skipped_at    timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE education.learning_progress (
  user_id     uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  lesson_key  text        NOT NULL,
  status      text        NOT NULL CHECK (status IN ('started', 'completed')),
  score       smallint,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lesson_key)
);

-- =====================================================================================
-- 11. TRIGGERY updated_at
-- =====================================================================================
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_schema, c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    WHERE c.column_name = 'updated_at'
      AND c.table_schema IN ('auth', 'identity', 'platform', 'notifications', 'market', 'portfolio', 'analytics', 'alerts', 'education')
  LOOP
    EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I.%I FOR EACH ROW EXECUTE FUNCTION platform.set_updated_at()',
                   r.table_schema, r.table_name);
  END LOOP;
END
$$;

-- =====================================================================================
-- 12. ROW LEVEL SECURITY
-- =====================================================================================
-- 12.1 Tabele z danymi użytkownika: właściciel = platform.current_user_id(). Admin NIE ma polityk (FR-08.01).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'identity.user_preferences', 'identity.deletion_requests', 'identity.data_exports',
    'platform.idempotency_keys',
    'notifications.push_subscriptions', 'notifications.notification_preferences', 'notifications.notification_deliveries',
    'market.watchlists', 'market.watchlist_items', 'market.screener_presets',
    'portfolio.accounts', 'portfolio.import_batches', 'portfolio.import_files', 'portfolio.import_templates',
    'portfolio.transactions', 'portfolio.import_rows', 'portfolio.instrument_overrides', 'portfolio.lots',
    'portfolio.lot_consumptions', 'portfolio.positions_daily', 'portfolio.cash_balances_daily',
    'portfolio.valuations_daily', 'portfolio.journal_entries', 'portfolio.journal_postmortems',
    'portfolio.target_allocations',
    'analytics.analytics_runs', 'analytics.strategy_definitions',
    'alerts.alert_rules', 'alerts.alert_events',
    'education.onboarding_state', 'education.learning_progress']
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY owner_all ON %s FOR ALL TO oliginvest_app
                     USING (user_id = platform.current_user_id())
                     WITH CHECK (user_id = platform.current_user_id())$p$, t);
  END LOOP;
END
$$;

-- 12.2 Tabele konfiguracyjne: odczyt dla wszystkich, zapis tylko admin/system (obrona w głąb obok RBAC w api).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['platform.feature_flags', 'platform.role_limits', 'analytics.stress_scenarios']
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY read_all ON %s FOR SELECT TO oliginvest_app USING (true)', t);
    EXECUTE format($p$CREATE POLICY write_admin ON %s FOR ALL TO oliginvest_app
                     USING (platform.current_app_role() IN ('admin', 'system'))
                     WITH CHECK (platform.current_app_role() IN ('admin', 'system'))$p$, t);
  END LOOP;
END
$$;

-- 12.3 Zaproszenia: tylko admin (rejestracja korzysta z funkcji SECURITY DEFINER).
ALTER TABLE identity.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY admin_all ON identity.invitations FOR ALL TO oliginvest_app
  USING (platform.current_app_role() = 'admin') WITH CHECK (platform.current_app_role() = 'admin');
-- Funkcje SECURITY DEFINER działają jako właściciel; przy FORCE RLS właściciel bez polityki nie widzi wierszy.
-- Rola oliginvest_owner jest używana wyłącznie przez migracje i te funkcje (zasada dla każdej nowej funkcji DEFINER).
CREATE POLICY definer_functions ON identity.invitations FOR ALL TO oliginvest_owner USING (true) WITH CHECK (true);

-- 12.4 Audyt: dopisywanie przez każdego, odczyt — admin lub własne wpisy; brak UPDATE/DELETE (brak uprawnień).
ALTER TABLE platform.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_insert ON platform.audit_log FOR INSERT TO oliginvest_app WITH CHECK (true);
CREATE POLICY audit_read ON platform.audit_log FOR SELECT TO oliginvest_app
  USING (platform.current_app_role() = 'admin' OR actor_user_id = platform.current_user_id());

-- =====================================================================================
-- 13. UPRAWNIENIA
-- =====================================================================================
GRANT USAGE ON SCHEMA identity, platform, notifications, market, portfolio, analytics, alerts, education TO oliginvest_app;
GRANT USAGE ON SCHEMA auth TO oliginvest_auth;
GRANT USAGE ON SCHEMA identity TO oliginvest_auth;
GRANT USAGE ON SCHEMA market TO oliginvest_analytics_ro;

-- oliginvest_auth: wyłącznie tabele uwierzytelniania + funkcje zaproszeń
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth TO oliginvest_auth;
GRANT EXECUTE ON FUNCTION identity.find_invitation(text), identity.consume_invitation(text, uuid) TO oliginvest_auth;

-- oliginvest_app: tabele domenowe (RLS egzekwuje własność); BRAK dostępu do schematu auth
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA identity, notifications, market, portfolio, analytics, alerts, education TO oliginvest_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.feature_flags, platform.role_limits, platform.idempotency_keys, platform.web_vitals TO oliginvest_app;
GRANT SELECT, INSERT ON platform.audit_log TO oliginvest_app;                         -- append-only
GRANT SELECT ON identity.user_directory TO oliginvest_app;
-- Widok jest automatycznie aktualizowalny i działa z uprawnieniami właściciela — bez tego REVOKE rola aplikacji
-- mogłaby zmienić auth.users (np. własną rolę) przez UPDATE na widoku.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON identity.user_directory FROM oliginvest_app;
GRANT EXECUTE ON FUNCTION identity.find_invitation(text), identity.consume_invitation(text, uuid) TO oliginvest_app;
GRANT EXECUTE ON FUNCTION platform.current_user_id(), platform.current_app_role() TO oliginvest_app;

-- oliginvest_analytics_ro: tylko dane rynkowe (bez watchlist i presetów użytkowników)
GRANT SELECT ON market.instruments, market.bars_daily, market.fx_rates, market.corporate_actions, market.trading_calendar,
                market.sectors, market.sector_memberships, market.universes, market.universe_members,
                market.macro_series, market.macro_observations TO oliginvest_analytics_ro;

-- Funkcje: domyślnie wykonywalne przez PUBLIC — zawężamy funkcje SECURITY DEFINER
REVOKE EXECUTE ON FUNCTION identity.find_invitation(text), identity.consume_invitation(text, uuid) FROM PUBLIC;

-- Przyszłe tabele w schematach domenowych dostają uprawnienia domyślne (nowa tabela z user_id MUSI dostać politykę RLS w tej samej migracji).
ALTER DEFAULT PRIVILEGES FOR ROLE oliginvest_owner IN SCHEMA identity, notifications, market, portfolio, analytics, alerts, education
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO oliginvest_app;

-- =====================================================================================
-- 14. OPISY
-- =====================================================================================
COMMENT ON SCHEMA auth IS 'Better Auth — dostęp wyłącznie dla roli oliginvest_auth (ADR-004)';
COMMENT ON TABLE portfolio.transactions IS 'Źródło prawdy portfela: operacje (obliczenia-finansowe.md § 1)';
COMMENT ON TABLE portfolio.lots IS 'Pochodne: partie FIFO odtwarzane z operacji (zadanie recompute)';
COMMENT ON TABLE portfolio.valuations_daily IS 'Pochodne: dzienne wyceny rachunków — wejście TWR/XIRR';
COMMENT ON TABLE market.bars_daily IS 'Historia EOD; źródło prawdy dla wykresów i analiz (strategia-cache.md)';
COMMENT ON TABLE platform.audit_log IS 'Append-only: rola aplikacji ma tylko INSERT i SELECT';
COMMENT ON VIEW identity.user_directory IS 'Bezpieczne kolumny kont; filtr: admin/system widzi wszystkich, użytkownik siebie';

RESET ROLE;
