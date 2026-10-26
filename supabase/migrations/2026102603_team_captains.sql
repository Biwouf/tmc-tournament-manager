-- Capitaines d'équipe : un admin déclare un ou plusieurs capitaines par équipe (donc par
-- compétition et par saison). Un capitaine garde les droits d'un membre et peut en plus
-- changer la date d'une rencontre de son équipe, via team_rencontre_set_date.
BEGIN;

CREATE TABLE IF NOT EXISTS public.team_equipe_captains (
  club_id    uuid        NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  equipe_id  uuid        NOT NULL REFERENCES public.team_equipes(id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (equipe_id, user_id)
);

ALTER TABLE public.team_equipe_captains ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.team_equipe_captains FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON TABLE public.team_equipe_captains TO authenticated;

DROP POLICY IF EXISTS team_equipe_captains_select ON public.team_equipe_captains;
CREATE POLICY team_equipe_captains_select ON public.team_equipe_captains FOR SELECT TO authenticated
  USING (public.is_super_admin() OR club_id IN (SELECT public.auth_club_ids()));

-- L'équipe et le capitaine doivent appartenir au club de la ligne. SECURITY DEFINER : la RLS
-- de club_members ne laisse voir que sa propre ligne.
CREATE OR REPLACE FUNCTION public.team_captain_belongs(p_club uuid, p_equipe uuid, p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.team_equipes e WHERE e.id = p_equipe AND e.club_id = p_club)
     AND EXISTS (SELECT 1 FROM public.club_members m WHERE m.club_id = p_club AND m.user_id = p_user)
$$;
REVOKE ALL ON FUNCTION public.team_captain_belongs(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_captain_belongs(uuid, uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS team_equipe_captains_insert ON public.team_equipe_captains;
CREATE POLICY team_equipe_captains_insert ON public.team_equipe_captains FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_club_content(club_id) AND public.team_captain_belongs(club_id, equipe_id, user_id));

DROP POLICY IF EXISTS team_equipe_captains_delete ON public.team_equipe_captains;
CREATE POLICY team_equipe_captains_delete ON public.team_equipe_captains FOR DELETE TO authenticated
  USING (public.can_manage_club_content(club_id));

-- Admin du club, ou capitaine (toujours membre d'un club actif) de l'équipe de la rencontre.
CREATE OR REPLACE FUNCTION public.team_can_reschedule(p_club uuid, p_rencontre uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_manage_club_content(p_club) OR EXISTS (
    SELECT 1 FROM public.team_rencontres r
    JOIN public.team_etapes et ON et.id = r.etape_id
    JOIN public.team_equipe_captains cap ON cap.equipe_id = et.equipe_id AND cap.club_id = r.club_id
    JOIN public.club_members m ON m.club_id = cap.club_id AND m.user_id = cap.user_id
    JOIN public.clubs c ON c.id = cap.club_id
    WHERE r.id = p_rencontre AND r.club_id = p_club
      AND cap.user_id = auth.uid() AND c.status = 'active'
  )
$$;
REVOKE ALL ON FUNCTION public.team_can_reschedule(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_can_reschedule(uuid, uuid) TO authenticated;

-- La fonction tourne en propriétaire : guard_team_encounter ne remet donc pas la
-- confirmation à zéro, on le fait ici comme le ferait une écriture directe.
CREATE OR REPLACE FUNCTION public.team_rencontre_set_date(p_club uuid, p_rencontre uuid, p_date timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.team_can_reschedule(p_club, p_rencontre) THEN
    RAISE EXCEPTION 'Seul un administrateur ou un capitaine de l''équipe peut changer la date.' USING ERRCODE = '42501';
  END IF;
  IF p_date IS NULL THEN
    RAISE EXCEPTION 'Date requise.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.team_rencontres
     SET date_heure = p_date, confirmed_at = NULL, confirmed_by = NULL
   WHERE id = p_rencontre AND club_id = p_club AND date_heure IS DISTINCT FROM p_date;
END $$;
REVOKE ALL ON FUNCTION public.team_rencontre_set_date(uuid, uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_rencontre_set_date(uuid, uuid, timestamptz) TO authenticated;

COMMIT;
