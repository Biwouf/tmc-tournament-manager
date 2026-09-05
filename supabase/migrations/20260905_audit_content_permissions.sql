-- Audit sécurité : droits d'écriture métier, suspension et dernier administrateur.
-- Migration transactionnelle ; les policies existantes de lecture sont conservées.
-- Les membres gardent le Live Score ; seuls admin/manager écrivent les autres modules.
BEGIN;

CREATE OR REPLACE FUNCTION public.auth_club_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.club_id FROM public.club_members m
  JOIN public.clubs c ON c.id = m.club_id
  WHERE m.user_id = auth.uid() AND c.status = 'active'
$$;

CREATE OR REPLACE FUNCTION public.can_manage_club_content(target_club uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin() OR EXISTS (
    SELECT 1 FROM public.club_members m JOIN public.clubs c ON c.id = m.club_id
    WHERE m.club_id = target_club AND m.user_id = auth.uid()
      AND m.role IN ('admin', 'manager') AND c.status = 'active'
  )
$$;
REVOKE ALL ON FUNCTION public.can_manage_club_content(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_club_content(uuid) TO authenticated;

-- RESTRICTIVE : une ancienne policy permissive ne peut pas rouvrir ces écritures.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['events','actus','tournaments','team_saisons',
    'team_competitions','team_equipes','team_etapes','team_rencontres','team_match_lines']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS content_insert_role ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS content_update_role ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS content_delete_role ON public.%I', t);
    EXECUTE format('CREATE POLICY content_insert_role ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.can_manage_club_content(club_id))', t);
    EXECUTE format('CREATE POLICY content_update_role ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.can_manage_club_content(club_id)) WITH CHECK (public.can_manage_club_content(club_id))', t);
    EXECUTE format('CREATE POLICY content_delete_role ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (public.can_manage_club_content(club_id))', t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['events','live_matches','actus','tournaments','team_saisons',
    'team_competitions','team_equipes','team_etapes','team_rencontres','team_match_lines','club_settings']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS active_club_access ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY active_club_access ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated '
      || 'USING (public.is_super_admin() OR EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = club_id AND c.status = ''active'')) '
      || 'WITH CHECK (public.is_super_admin() OR EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = club_id AND c.status = ''active''))', t);
  END LOOP;
END $$;

-- Pas de cast du chemin en UUID : les objets historiques n'ont pas ce préfixe.
CREATE OR REPLACE FUNCTION public.can_write_club_object(object_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin() OR EXISTS (
    SELECT 1 FROM public.clubs c JOIN public.club_members m ON m.club_id = c.id
    WHERE m.user_id = auth.uid() AND m.role IN ('admin', 'manager') AND c.status = 'active'
      AND (
        c.id::text = (storage.foldername(object_name))[1]
        OR (c.slug = 'cac-tennis' AND
          COALESCE((storage.foldername(object_name))[1], '') !~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
      )
  )
$$;

-- Le verrou du club sérialise les retraits/rétrogradations, y compris en service role.
-- Une invitation utilise désormais ON CONFLICT DO NOTHING et ne réécrit plus de rôle.
CREATE OR REPLACE FUNCTION public.protect_last_club_admin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.role <> 'admin' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.role = 'admin' AND NEW.club_id = OLD.club_id THEN RETURN NEW; END IF;
  END IF;
  PERFORM 1 FROM public.clubs WHERE id = OLD.club_id FOR UPDATE;
  -- Suppression du club parent en cascade : aucune appartenance à préserver.
  IF FOUND AND NOT EXISTS (
    SELECT 1 FROM public.club_members WHERE club_id = OLD.club_id
      AND role = 'admin' AND id <> OLD.id
  ) THEN
    RAISE EXCEPTION 'Le club doit conserver au moins un administrateur.' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END
$$;
REVOKE ALL ON FUNCTION public.protect_last_club_admin() FROM PUBLIC;
DROP TRIGGER IF EXISTS protect_last_club_admin ON public.club_members;
CREATE TRIGGER protect_last_club_admin BEFORE UPDATE OR DELETE ON public.club_members
FOR EACH ROW EXECUTE FUNCTION public.protect_last_club_admin();

COMMIT;
