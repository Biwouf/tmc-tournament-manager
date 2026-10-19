-- Temps réel du live par Broadcast déclenché en base, à la place de postgres_changes.
--
-- Mesure prod (8 jours, ~10 appareils) : postgres_changes ≈ 36 % du temps base — lecture du WAL
-- par wal2json en boucle tant qu'un abonné existe, et une ligne realtime.subscription + une
-- évaluation RLS par abonné à chaque (ré)abonnement. Ici, chaque écriture publie un message
-- (realtime.send → realtime.messages) que Realtime diffuse aux canaux du topic ; aucun polling
-- du WAL, aucune RLS par abonné.
--
-- Topics publics (private = false) : leurs messages ne contiennent que ce qu'un visiteur lit déjà
-- (live_matches est lisible par anon pour les clubs actifs, live_posts aussi ; les signaux
-- d'équipe ne portent que des identifiants). Rien n'est publié pour un club non actif.
--   live:match:<match_id>  'score' {row}                          — ligne live_matches après écriture
--                          'post'  {id, sequence, op}              — fil (message, sondage, vote, réaction…)
--   live:club:<club_id>    'live'  {id, op, status, team_rencontre_id} — liste des matchs
--                          'team'  {rencontre_id}                  — rencontres et matches par équipe
--
-- Retire live_matches et live_posts de la publication supabase_realtime : plus aucun client
-- n'utilise postgres_changes sur ces tables. Un client resté sur l'ancienne version ne reçoit plus
-- d'événement et retombe sur son polling (15–30 s). Déployer BO et PWA juste après.
-- Idempotente.
BEGIN;

CREATE OR REPLACE FUNCTION public.live_club_active(p_club uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM clubs WHERE id=p_club AND status='active')
$$;
REVOKE ALL ON FUNCTION public.live_club_active(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.live_matches_broadcast() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r live_matches := CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
BEGIN
 IF NOT live_club_active(r.club_id) THEN RETURN NULL; END IF;
 IF TG_OP<>'DELETE' THEN
  PERFORM realtime.send(jsonb_build_object('row',to_jsonb(NEW)),'score','live:match:'||NEW.id,false);
 END IF;
 PERFORM realtime.send(jsonb_build_object('id',r.id,'op',TG_OP,'status',r.status,'team_rencontre_id',r.team_rencontre_id),
  'live','live:club:'||r.club_id,false);
 RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.live_posts_broadcast() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM live_matches m WHERE m.id=NEW.match_id AND live_club_active(m.club_id)) THEN RETURN NULL; END IF;
 PERFORM realtime.send(jsonb_build_object('id',NEW.id,'sequence',NEW.sequence,'op',TG_OP),
  'post','live:match:'||NEW.match_id,false);
 RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.team_broadcast() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE club uuid; rencontre uuid;
BEGIN
 IF TG_OP='DELETE' THEN club:=OLD.club_id; ELSE club:=NEW.club_id; END IF;
 IF TG_TABLE_NAME='team_rencontres' THEN
  rencontre:=CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
 ELSE
  rencontre:=CASE WHEN TG_OP='DELETE' THEN OLD.rencontre_id ELSE NEW.rencontre_id END;
 END IF;
 IF club IS NULL OR NOT live_club_active(club) THEN RETURN NULL; END IF;
 PERFORM realtime.send(jsonb_build_object('rencontre_id',rencontre),'team','live:club:'||club,false);
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.live_matches_broadcast(),public.live_posts_broadcast(),public.team_broadcast()
 FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS live_matches_broadcast ON public.live_matches;
CREATE TRIGGER live_matches_broadcast AFTER INSERT OR UPDATE OR DELETE ON public.live_matches
 FOR EACH ROW EXECUTE FUNCTION public.live_matches_broadcast();
DROP TRIGGER IF EXISTS live_posts_broadcast ON public.live_posts;
CREATE TRIGGER live_posts_broadcast AFTER INSERT OR UPDATE ON public.live_posts
 FOR EACH ROW EXECUTE FUNCTION public.live_posts_broadcast();
DROP TRIGGER IF EXISTS team_rencontres_broadcast ON public.team_rencontres;
CREATE TRIGGER team_rencontres_broadcast AFTER INSERT OR UPDATE OR DELETE ON public.team_rencontres
 FOR EACH ROW EXECUTE FUNCTION public.team_broadcast();
DROP TRIGGER IF EXISTS team_match_lines_broadcast ON public.team_match_lines;
CREATE TRIGGER team_match_lines_broadcast AFTER INSERT OR UPDATE OR DELETE ON public.team_match_lines
 FOR EACH ROW EXECUTE FUNCTION public.team_broadcast();

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['live_matches','live_posts'] LOOP
  IF EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN
   EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I',t);
  END IF;
 END LOOP;
END $$;
COMMIT;
