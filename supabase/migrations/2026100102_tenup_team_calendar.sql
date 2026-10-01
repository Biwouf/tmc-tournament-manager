BEGIN;
ALTER TABLE public.team_equipes DROP CONSTRAINT team_equipes_division_check;
ALTER TABLE public.team_equipes ADD CONSTRAINT team_equipes_division_check
 CHECK (char_length(division) BETWEEN 1 AND 160 AND division ~ '[^[:space:]]');
ALTER TABLE public.team_equipes ADD COLUMN tenup_team_id text CHECK(tenup_team_id ~ '^[0-9]+$'),
 ADD COLUMN tenup_team_name text CHECK(char_length(tenup_team_name) BETWEEN 1 AND 160),
 ADD COLUMN tenup_source_url text CHECK(tenup_source_url ~ '^https://tenup[.]fft[.]fr/championnat/[0-9]+[?]division=[0-9]+&phase=[0-9]+&poule=[0-9]+$');
CREATE UNIQUE INDEX team_equipe_tenup_unique ON public.team_equipes(competition_id,tenup_team_id) WHERE tenup_team_id IS NOT NULL;
ALTER TABLE public.team_etapes ADD COLUMN exempt boolean NOT NULL DEFAULT false;
-- Both teams of one club can face each other: retain each side independently.
DROP INDEX public.team_tenup_source_unique;
CREATE UNIQUE INDEX team_tenup_source_unique ON public.team_rencontres(club_id,tenup_url,tenup_side) WHERE tenup_url IS NOT NULL;
CREATE TABLE public.team_tenup_pool_previews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
 competition_id uuid NOT NULL REFERENCES public.team_competitions(id) ON DELETE CASCADE,
 source_url text NOT NULL, payload jsonb, created_at timestamptz NOT NULL DEFAULT now(), equipe_id uuid REFERENCES public.team_equipes(id) ON DELETE SET NULL
);
ALTER TABLE public.team_tenup_pool_previews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.team_tenup_pool_previews FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.team_tenup_pool_previews TO service_role;
CREATE FUNCTION public.team_tenup_pool_begin(p_club uuid,p_competition uuid,p_url text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c team_competitions; result uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT can_manage_club_content(p_club) THEN RAISE EXCEPTION 'Administration du club requise.' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM team_competitions WHERE id=p_competition AND club_id=p_club;
 IF c.id IS NULL THEN RAISE EXCEPTION 'Compétition introuvable pour ce club.'; END IF;
 IF c.tenup_url IS NOT NULL AND split_part(c.tenup_url,'?',1)<>split_part(p_url,'?',1) THEN RAISE EXCEPTION 'Le lien doit correspondre au championnat de la compétition.'; END IF;
 IF p_url IS NULL OR p_url !~ '^https://tenup[.]fft[.]fr/championnat/[0-9]+[?]division=[0-9]+&phase=[0-9]+&poule=[0-9]+$' OR length(p_url)>500 THEN RAISE EXCEPTION 'Lien de poule Ten’Up invalide.'; END IF;
 PERFORM team_tenup_competition_begin(p_club,c.saison_id,p_url);
 DELETE FROM team_tenup_pool_previews WHERE actor_id=auth.uid() AND created_at<now()-interval '1 day';
 INSERT INTO team_tenup_pool_previews(actor_id,club_id,competition_id,source_url) VALUES(auth.uid(),p_club,p_competition,p_url) RETURNING id INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.team_tenup_pool_begin(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.team_tenup_pool_begin(uuid,uuid,text) TO authenticated;

-- A single transaction creates the team, rounds and scheduled encounters.
-- Imported data comes exclusively from a worker snapshot, never from the browser.
CREATE FUNCTION public.team_equipe_create(p_club uuid,p_competition uuid,p_numero integer,p_division text,p_journees integer,p_preview uuid DEFAULT NULL,p_team_id text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE preview team_tenup_pool_previews; team jsonb; round jsonb; match jsonb; opponent text;
 result uuid; step uuid; division_label text; days integer; seen integer; home boolean; source_prefix text;
BEGIN
 IF auth.uid() IS NULL OR NOT can_manage_club_content(p_club) THEN RAISE EXCEPTION 'Administration du club requise.' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM team_competitions c JOIN team_saisons s ON s.id=c.saison_id AND s.club_id=p_club WHERE c.id=p_competition AND c.club_id=p_club) THEN RAISE EXCEPTION 'Compétition introuvable pour ce club.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('team-create:'||p_competition::text,0));
 division_label=btrim(p_division); days=p_journees;
 IF p_preview IS NOT NULL THEN
  SELECT * INTO preview FROM team_tenup_pool_previews WHERE id=p_preview AND actor_id=auth.uid() AND club_id=p_club AND competition_id=p_competition FOR UPDATE;
  IF preview.id IS NULL THEN RAISE EXCEPTION 'Aperçu introuvable.'; END IF;
  IF preview.equipe_id IS NOT NULL THEN
   IF EXISTS(SELECT 1 FROM team_equipes WHERE id=preview.equipe_id AND tenup_team_id=p_team_id) THEN RETURN preview.equipe_id; END IF;
   RAISE EXCEPTION 'Cet aperçu a déjà été utilisé pour une autre équipe.';
  END IF;
  IF preview.created_at<now()-interval '15 minutes' OR preview.payload IS NULL THEN RAISE EXCEPTION 'Aperçu expiré ou incomplet. Relancez la lecture Ten’Up.'; END IF;
  SELECT t INTO team FROM jsonb_array_elements(preview.payload->'teams') t WHERE t->>'id'=p_team_id;
  IF team IS NULL THEN RAISE EXCEPTION 'Sélectionnez une équipe Ten’Up.'; END IF;
  IF EXISTS(SELECT 1 FROM team_equipes WHERE competition_id=p_competition AND tenup_team_id=p_team_id) THEN RAISE EXCEPTION 'Cette équipe Ten’Up est déjà ajoutée à la compétition.'; END IF;
  division_label=preview.payload->>'division';days=jsonb_array_length(preview.payload->'rounds');
 END IF;
 IF p_numero IS NULL OR p_numero<1 OR p_numero>999 THEN RAISE EXCEPTION 'Numéro d’équipe invalide.'; END IF;
 IF EXISTS(SELECT 1 FROM team_equipes WHERE competition_id=p_competition AND numero=p_numero) THEN RAISE EXCEPTION 'Ce numéro d’équipe est déjà utilisé dans la compétition.'; END IF;
 IF division_label IS NULL OR char_length(division_label) NOT BETWEEN 1 AND 160 OR division_label !~ '[^[:space:]]' OR days IS NULL OR days NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'Division ou nombre de journées invalide.'; END IF;
 INSERT INTO team_equipes(club_id,competition_id,numero,division,nb_journees_poule,tenup_team_id,tenup_team_name,tenup_source_url)
 VALUES(p_club,p_competition,p_numero,division_label,days,CASE WHEN p_preview IS NOT NULL THEN p_team_id END,team->>'name',preview.source_url) RETURNING id INTO result;
 IF p_preview IS NULL THEN
  INSERT INTO team_etapes(club_id,equipe_id,phase,numero_journee) SELECT p_club,result,'poule',generate_series(1,days);
 ELSE
  source_prefix=split_part(preview.source_url,'?',1)||'/division/'||substring(preview.source_url from 'division=([0-9]+)')||'/phase/'||substring(preview.source_url from 'phase=([0-9]+)')||'/poule/'||substring(preview.source_url from 'poule=([0-9]+)')||'/rencontre/';
  seen=0;
  FOR round IN SELECT value FROM jsonb_array_elements(preview.payload->'rounds') LOOP
   seen=seen+1;IF (round->>'numero')::integer<>seen THEN RAISE EXCEPTION 'Journées invalides.'; END IF;
   IF (SELECT count(*) FROM jsonb_array_elements(round->'matches') m WHERE m->>'home_id'=p_team_id OR m->>'away_id'=p_team_id)>1 THEN RAISE EXCEPTION 'Plusieurs rencontres pour une journée.'; END IF;
   match=NULL;
   SELECT m INTO match FROM jsonb_array_elements(round->'matches') m WHERE m->>'home_id'=p_team_id OR m->>'away_id'=p_team_id;
   INSERT INTO team_etapes(club_id,equipe_id,phase,numero_journee,exempt) VALUES(p_club,result,'poule',seen,match IS NULL) RETURNING id INTO step;
   IF match IS NOT NULL THEN
    home=match->>'home_id'=p_team_id;
    SELECT t->>'name' INTO opponent FROM jsonb_array_elements(preview.payload->'teams') t WHERE t->>'id'=CASE WHEN home THEN match->>'away_id' ELSE match->>'home_id' END;
    IF opponent IS NULL OR match->>'url' NOT LIKE source_prefix||'%' OR substring(match->>'url' from length(source_prefix)+1) !~ '^[0-9]+$' THEN RAISE EXCEPTION 'Rencontre invalide.'; END IF;
    INSERT INTO team_rencontres(club_id,etape_id,club_adverse,date_heure,domicile,tenup_url,tenup_side)
    VALUES(p_club,step,opponent,(match->>'date')::date::timestamp AT TIME ZONE 'Europe/Paris',home,match->>'url',CASE WHEN home THEN 0 ELSE 1 END);
   END IF;
  END LOOP;
  UPDATE team_tenup_pool_previews SET equipe_id=result WHERE id=p_preview;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.team_equipe_create(uuid,uuid,integer,text,integer,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.team_equipe_create(uuid,uuid,integer,text,integer,uuid,text) TO authenticated;
-- Opposite sides of one intra-club encounter can each sync their results.
CREATE OR REPLACE FUNCTION public.team_tenup_begin(p_club uuid,p_rencontre uuid,p_url text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r team_rencontres; pid uuid;
BEGIN
 IF NOT team_can_score(p_club) THEN RAISE EXCEPTION 'Accès membre requis.' USING ERRCODE='42501'; END IF;
 IF p_url IS NULL OR length(p_url)>500 OR p_url !~ '^https://tenup[.]fft[.]fr/championnat/[0-9]+/division/[0-9]+/phase/[0-9]+/poule/[0-9]+/rencontre/[0-9]+$' THEN RAISE EXCEPTION 'Lien de rencontre Ten’Up invalide.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('tenup:'||auth.uid()::text,0));
 DELETE FROM team_tenup_previews WHERE actor_id=auth.uid() AND created_at<now()-interval '1 day';
 IF (SELECT count(*) FROM team_tenup_previews WHERE actor_id=auth.uid() AND created_at>now()-interval '1 minute')>=3 THEN
  RAISE EXCEPTION 'Trop de demandes. Réessayez dans une minute.'; END IF;
 SELECT * INTO r FROM team_rencontres WHERE id=p_rencontre AND club_id=p_club;
 IF NOT FOUND THEN RAISE EXCEPTION 'Rencontre introuvable.'; END IF;
 IF r.wo THEN RAISE EXCEPTION 'Cette rencontre est déclarée WO.'; END IF;
 IF r.tenup_url IS NOT NULL AND r.tenup_url<>p_url THEN RAISE EXCEPTION 'Cette rencontre est déjà associée à un autre lien Ten’Up.'; END IF;
 IF EXISTS(SELECT 1 FROM team_rencontres WHERE club_id=p_club AND tenup_url=p_url AND id<>p_rencontre AND (r.tenup_side IS NULL OR tenup_side IS NULL OR tenup_side=r.tenup_side)) THEN
  RAISE EXCEPTION 'Cette feuille Ten’Up est déjà associée à une autre rencontre.'; END IF;
 INSERT INTO team_tenup_previews(actor_id,club_id,rencontre_id,revision,source_url)
 VALUES(auth.uid(),p_club,p_rencontre,r.revision,p_url) RETURNING id INTO pid;
 RETURN jsonb_build_object('id',pid);
END $$;

COMMIT;
