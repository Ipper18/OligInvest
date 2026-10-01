CREATE FUNCTION platform.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

CREATE FUNCTION platform.current_app_role() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT coalesce(nullif(current_setting('app.role', true), ''), 'anonymous') $$;

CREATE FUNCTION platform.set_updated_at() RETURNS trigger
  LANGUAGE plpgsql
  AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

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
