BEGIN;
-- Lecture d'une photo de feuille par l'IA (Edge Function compo-scan) : chaque appel est payant,
-- il est réservé aux membres et plafonné par utilisateur et par club.
CREATE TABLE IF NOT EXISTS public.team_compo_scans (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
 actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS team_compo_scans_actor ON public.team_compo_scans(actor_id,created_at);
CREATE INDEX IF NOT EXISTS team_compo_scans_club ON public.team_compo_scans(club_id,created_at);
-- Aucune policy ni GRANT : seule team_compo_scan_begin (SECURITY DEFINER) y écrit.
ALTER TABLE public.team_compo_scans ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.team_compo_scan_begin(p_club uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT team_can_score(p_club) THEN RAISE EXCEPTION 'Accès membre requis.' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('team_compo_scan:'||p_club::text,0));
 IF (SELECT count(*) FROM team_compo_scans WHERE actor_id=auth.uid() AND created_at>now()-interval '10 minutes')>=6 THEN
  RAISE EXCEPTION 'Trop de lectures de feuille. Réessayez dans quelques minutes ou saisissez la compo à la main.' USING ERRCODE='PT429'; END IF;
 IF (SELECT count(*) FROM team_compo_scans WHERE club_id=p_club AND created_at>now()-interval '1 day')>=60 THEN
  RAISE EXCEPTION 'Limite quotidienne de lectures de feuille atteinte pour le club. Saisissez la compo à la main.' USING ERRCODE='PT429'; END IF;
 INSERT INTO team_compo_scans(club_id,actor_id) VALUES(p_club,auth.uid());
END $$;
REVOKE ALL ON FUNCTION public.team_compo_scan_begin(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.team_compo_scan_begin(uuid) TO authenticated;
COMMIT;
