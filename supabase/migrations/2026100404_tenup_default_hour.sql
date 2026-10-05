-- Ten’Up ne fournit pas l'heure des rencontres d'une poule : on les crée à 09:00
-- (heure de Paris) au lieu de minuit, et on corrige les rencontres déjà importées.
BEGIN;
CREATE OR REPLACE FUNCTION public.team_equipe_create(p_club uuid,p_competition uuid,p_numero integer,p_division text,p_journees integer,p_preview uuid DEFAULT NULL,p_team_id text DEFAULT NULL) RETURNS uuid
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
    VALUES(p_club,step,opponent,((match->>'date')::date+time '09:00') AT TIME ZONE 'Europe/Paris',home,match->>'url',CASE WHEN home THEN 0 ELSE 1 END);
   END IF;
  END LOOP;
  UPDATE team_tenup_pool_previews SET equipe_id=result WHERE id=p_preview;
 END IF;
 RETURN result;
END $$;
UPDATE team_rencontres SET date_heure=((date_heure AT TIME ZONE 'Europe/Paris')::date+time '09:00') AT TIME ZONE 'Europe/Paris'
 WHERE tenup_url IS NOT NULL AND (date_heure AT TIME ZONE 'Europe/Paris')::time='00:00';
COMMIT;
