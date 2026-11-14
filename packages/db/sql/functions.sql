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

-- Eksport RODO (BL-114, FR-07.09): rola aplikacji nie ma dostępu do schematu auth, więc dane konta, sesji,
-- powiązań logowania, 2FA i tokenów PAT bieżącego użytkownika wydaje ta funkcja — wyłącznie kolumny z listy,
-- bez sekretów (token sesji, skrót hasła, sekret TOTP, kody zapasowe, skrót klucza PAT, tokeny OAuth).
CREATE FUNCTION identity.export_auth_data()
  RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, identity
  AS $$
    SELECT jsonb_build_object(
      'users', coalesce((SELECT jsonb_agg(jsonb_build_object(
          'id', u.id, 'name', u.name, 'email', u.email, 'email_verified', u.email_verified, 'image', u.image,
          'role', u.role, 'banned', u.banned, 'ban_reason', u.ban_reason, 'ban_expires', u.ban_expires,
          'two_factor_enabled', u.two_factor_enabled, 'created_at', u.created_at, 'updated_at', u.updated_at))
        FROM auth.users u WHERE u.id = platform.current_user_id()), '[]'::jsonb),
      'sessions', coalesce((SELECT jsonb_agg(jsonb_build_object(
          'id', s.id, 'created_at', s.created_at, 'updated_at', s.updated_at, 'expires_at', s.expires_at,
          'ip_address', s.ip_address, 'user_agent', s.user_agent, 'mfa_verified_at', s.mfa_verified_at,
          'mfa_method', s.mfa_method) ORDER BY s.created_at, s.id)
        FROM auth.sessions s WHERE s.user_id = platform.current_user_id()), '[]'::jsonb),
      'accounts', coalesce((SELECT jsonb_agg(jsonb_build_object(
          'id', a.id, 'provider_id', a.provider_id, 'account_id', a.account_id, 'scope', a.scope,
          'created_at', a.created_at, 'updated_at', a.updated_at) ORDER BY a.created_at, a.id)
        FROM auth.accounts a WHERE a.user_id = platform.current_user_id()), '[]'::jsonb),
      'two_factors', coalesce((SELECT jsonb_agg(jsonb_build_object(
          'id', t.id, 'verified', t.verified, 'failed_verification_count', t.failed_verification_count,
          'locked_until', t.locked_until) ORDER BY t.id)
        FROM auth.two_factors t WHERE t.user_id = platform.current_user_id()), '[]'::jsonb),
      'api_keys', coalesce((SELECT jsonb_agg(jsonb_build_object(
          'id', k.id, 'name', k.name, 'start', k.start, 'prefix', k.prefix, 'enabled', k.enabled,
          'permissions', k.permissions, 'request_count', k.request_count, 'last_request', k.last_request,
          'expires_at', k.expires_at, 'created_at', k.created_at, 'updated_at', k.updated_at)
          ORDER BY k.created_at, k.id)
        FROM auth.api_keys k WHERE k.reference_id = platform.current_user_id()), '[]'::jsonb))
    WHERE platform.current_user_id() IS NOT NULL AND platform.current_app_role() IN ('user', 'pro', 'admin')
  $$;

-- Usunięcie konta po 14 dniach karencji (BL-114, RODO art. 17): wyłącznie kontekst systemowy i wyłącznie konto
-- z wymagalnym, nieanulowanym wnioskiem. Audyt zachowuje pseudonim (Z-21): bez identyfikatora konta, adresu IP
-- i przeglądarki; UUID w resource_id i w polach before/after zastępuje pseudonim. Kasowanie auth.users usuwa
-- kaskadowo wszystkie tabele z user_id (akcje referencyjne nie podlegają RLS); zaproszenia dostają NULL.
CREATE FUNCTION identity.erase_account(p_user_id uuid, p_actor_ref text)
  RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, identity
  AS $$
  BEGIN
    IF platform.current_app_role() IS DISTINCT FROM 'system' THEN
      RAISE EXCEPTION 'account erasure requires the system context' USING ERRCODE = '42501';
    END IF;
    IF p_actor_ref IS NULL OR p_actor_ref !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'invalid actor pseudonym' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM identity.deletion_requests d
        WHERE d.user_id = p_user_id AND d.cancelled_at IS NULL AND d.completed_at IS NULL
          AND d.scheduled_for <= now()) THEN
      RETURN false;
    END IF;
    UPDATE platform.audit_log SET actor_user_id = NULL, ip = NULL, user_agent = NULL
      WHERE actor_user_id = p_user_id;
    UPDATE platform.audit_log SET resource_id = p_actor_ref WHERE resource_id = p_user_id::text;
    UPDATE platform.audit_log
      SET before = replace(before::text, p_user_id::text, p_actor_ref)::jsonb,
          after = replace(after::text, p_user_id::text, p_actor_ref)::jsonb
      WHERE strpos(coalesce(before::text, ''), p_user_id::text) > 0
         OR strpos(coalesce(after::text, ''), p_user_id::text) > 0;
    UPDATE auth.sessions SET impersonated_by = NULL WHERE impersonated_by = p_user_id;
    DELETE FROM auth.verifications WHERE value = p_user_id::text;
    DELETE FROM auth.users WHERE id = p_user_id;
    INSERT INTO platform.erasure_log (erased_user_id, purge_after) VALUES (p_user_id, now() + interval '40 days');
    RETURN true;
  END
  $$;

-- Właściciel uruchomienia analizy (BL-312): jobs dostaje z kolejki wyłącznie runId i odczytuje user_id
-- z rekordu tą funkcją (tylko kontekst system), a wynik zapisuje już w kontekście RLS właściciela.
CREATE FUNCTION analytics.run_owner(p_run_id uuid)
  RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, analytics
  AS $$
    SELECT r.user_id FROM analytics.analytics_runs r
    WHERE r.id = p_run_id AND platform.current_app_role() = 'system'
  $$;
