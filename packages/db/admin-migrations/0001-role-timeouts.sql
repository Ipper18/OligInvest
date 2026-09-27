-- Run as PostgreSQL administrator after role bootstrap; safe to apply again.
BEGIN;
-- Limity sesji ról aplikacyjnych (P-03); obowiązują nowe połączenia.
ALTER ROLE oliginvest_app SET statement_timeout = '5s';
ALTER ROLE oliginvest_app SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE oliginvest_app SET lock_timeout = '2s';
ALTER ROLE oliginvest_auth SET statement_timeout = '5s';
ALTER ROLE oliginvest_auth SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE oliginvest_auth SET lock_timeout = '2s';
ALTER ROLE oliginvest_analytics_ro SET statement_timeout = '60s';
ALTER ROLE oliginvest_analytics_ro SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE oliginvest_analytics_ro SET lock_timeout = '2s';

COMMIT;
