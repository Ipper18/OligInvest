-- ADR-003 / R-38 (owner decision 2026-10-19): data-quality findings are market-data metadata, not
-- user data; the Python worker checks the § 14 BLOCK gate itself before an FR-04 analysis.
GRANT SELECT ON market.data_quality_issues TO oliginvest_analytics_ro;
