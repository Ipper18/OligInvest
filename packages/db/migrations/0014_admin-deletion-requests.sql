-- BL-509 (FR-08.01): usunięcie zlecone przez administratora; anuluje je wyłącznie administrator (decyzja właściciela 2026-11-21).
ALTER TABLE "identity"."deletion_requests" ADD COLUMN "requested_by" text DEFAULT 'user' NOT NULL;
--> statement-breakpoint
ALTER TABLE "identity"."deletion_requests" ADD CONSTRAINT "deletion_requests_requested_by_check" CHECK ((requested_by = ANY (ARRAY['user'::text, 'admin'::text])));
--> statement-breakpoint
-- BL-509: wniosek administratora — użytkownik go widzi (owner_all), ale nie zmieni ani nie usunie; własne wnioski
-- zakłada wyłącznie z requested_by = 'user'. Funkcje admin_* (właściciel) zakładają i anulują tylko wnioski 'admin'.
CREATE POLICY user_requests_insert ON identity.deletion_requests AS RESTRICTIVE FOR INSERT TO oliginvest_app
  WITH CHECK (requested_by = 'user');
--> statement-breakpoint
CREATE POLICY user_requests_update ON identity.deletion_requests AS RESTRICTIVE FOR UPDATE TO oliginvest_app
  USING (requested_by = 'user') WITH CHECK (requested_by = 'user');
--> statement-breakpoint
CREATE POLICY user_requests_delete ON identity.deletion_requests AS RESTRICTIVE FOR DELETE TO oliginvest_app
  USING (requested_by = 'user');
--> statement-breakpoint
CREATE POLICY definer_admin_insert ON identity.deletion_requests FOR INSERT TO oliginvest_owner
  WITH CHECK (requested_by = 'admin');
--> statement-breakpoint
CREATE POLICY definer_admin_cancel ON identity.deletion_requests FOR UPDATE TO oliginvest_owner
  USING (requested_by = 'admin') WITH CHECK (requested_by = 'admin');
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION identity.admin_schedule_deletion(uuid, integer), identity.admin_cancel_deletion(uuid), identity.admin_deletion_status(uuid[]) TO oliginvest_app;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION identity.admin_schedule_deletion(uuid, integer), identity.admin_cancel_deletion(uuid), identity.admin_deletion_status(uuid[]) FROM PUBLIC;
