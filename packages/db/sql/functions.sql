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

-- Usunięcie konta zlecone przez administratora (BL-509, FR-08.01; decyzja właściciela 2026-11-21): ten sam wniosek
-- i to samo nocne zadanie identity.erasure co RODO, z requested_by = 'admin'. Rola aplikacji w kontekście admina nie ma
-- polityk na tej tabeli (FR-08.01), więc wniosek zakłada, anuluje i pokazuje wyłącznie ta trójka funkcji. Własnego konta
-- administrator tą drogą nie usunie (prawo z RODO w /ustawienia). Aktywny wniosek → pusty wynik (409 w API).
CREATE FUNCTION identity.admin_schedule_deletion(p_user_id uuid, p_grace_days integer)
  RETURNS TABLE (id uuid, requested_at timestamptz, scheduled_for timestamptz)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, identity
  AS $$
  #variable_conflict use_column
  BEGIN
    IF platform.current_app_role() IS DISTINCT FROM 'admin' OR platform.current_user_id() IS NULL THEN
      RAISE EXCEPTION 'administrator context required' USING ERRCODE = '42501';
    END IF;
    IF p_user_id IS NULL OR p_user_id = platform.current_user_id() OR p_grace_days IS NULL OR p_grace_days < 14 THEN
      RAISE EXCEPTION 'invalid deletion request' USING ERRCODE = '22023';
    END IF;
    -- Ten sam klucz co wniosek użytkownika (gdpr-routes.ts): równoległe wnioski nie tworzą dwóch aktywnych.
    PERFORM pg_advisory_xact_lock(hashtextextended('gdpr-deletion:' || p_user_id::text, 114));
    IF EXISTS (SELECT 1 FROM identity.deletion_requests d WHERE d.user_id = p_user_id
        AND d.cancelled_at IS NULL AND d.completed_at IS NULL) THEN
      RETURN;
    END IF;
    RETURN QUERY INSERT INTO identity.deletion_requests AS d (user_id, scheduled_for, requested_by)
      VALUES (p_user_id, now() + make_interval(days => p_grace_days), 'admin')
      RETURNING d.id, d.requested_at, d.scheduled_for;
  END
  $$;

CREATE FUNCTION identity.admin_cancel_deletion(p_user_id uuid)
  RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, identity
  AS $$
  DECLARE v_id uuid;
  BEGIN
    IF platform.current_app_role() IS DISTINCT FROM 'admin' OR platform.current_user_id() IS NULL THEN
      RAISE EXCEPTION 'administrator context required' USING ERRCODE = '42501';
    END IF;
    UPDATE identity.deletion_requests d SET cancelled_at = now()
      WHERE d.user_id = p_user_id AND d.requested_by = 'admin' AND d.cancelled_at IS NULL
        AND d.completed_at IS NULL AND d.scheduled_for > now()
      RETURNING d.id INTO v_id;
    RETURN v_id;
  END
  $$;

-- Stan wniosków dla listy kont w panelu: tylko termin i strona zlecająca, bez innych danych konta.
CREATE FUNCTION identity.admin_deletion_status(p_user_ids uuid[])
  RETURNS TABLE (user_id uuid, scheduled_for timestamptz, requested_by text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, identity
  AS $$
    SELECT DISTINCT ON (d.user_id) d.user_id, d.scheduled_for, d.requested_by
    FROM identity.deletion_requests d
    WHERE platform.current_app_role() = 'admin' AND platform.current_user_id() IS NOT NULL
      AND d.user_id = ANY (p_user_ids) AND d.cancelled_at IS NULL AND d.completed_at IS NULL
    ORDER BY d.user_id, d.requested_at DESC, d.id DESC
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
