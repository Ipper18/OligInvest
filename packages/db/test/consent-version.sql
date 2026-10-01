-- Synthetic regression fixture for the normative consent version CHECK.
BEGIN;
SET LOCAL ROLE oliginvest_auth;
INSERT INTO auth.users (id, name, email)
VALUES ('0198a000-0000-7000-8000-0000000000c0', 'Version test', 'version@example.test');
SET LOCAL ROLE oliginvest_app;
SET LOCAL app.user_id = '0198a000-0000-7000-8000-0000000000c0';
SET LOCAL app.role = 'user';
INSERT INTO identity.consent_events (user_id, document, version, action, source)
VALUES ('0198a000-0000-7000-8000-0000000000c0', 'terms', '2026-09-19.1', 'accepted', 'sign_up');
DO $$
DECLARE failed_constraint text;
BEGIN
  BEGIN
    INSERT INTO identity.consent_events (user_id, document, version, action, source)
    VALUES ('0198a000-0000-7000-8000-0000000000c0', 'terms', '2026-09-19x1', 'accepted', 'sign_up');
    RAISE EXCEPTION 'Invalid consent version was accepted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS failed_constraint = CONSTRAINT_NAME;
    IF failed_constraint <> 'consent_events_version_check' THEN
      RAISE EXCEPTION 'Unexpected failing constraint: %', failed_constraint;
    END IF;
  END;
END $$;
ROLLBACK;
