-- Récap d'un live terminé (PWA) : déroulé du score, posts, réactions, spectateurs uniques.
--   live_score_events   — instantané du score à chaque changement de jeux pendant le live (trigger)
--   live_match_viewers  — un appareil anonyme par match, compté seulement pendant le live
--   live_match_view     — RPC publique, une écriture par appareil et par match (ON CONFLICT DO NOTHING)
--   live_match_recap    — RPC publique de lecture, match terminé uniquement
-- Charge (instance Nano, incidents d'octobre 2026) : une insertion simple par jeu marqué, aucun
-- verrou sur live_matches, aucun battement de présence ni canal Realtime supplémentaire.
-- Les matchs terminés avant cette migration n'ont pas d'historique : le récap n'affiche que le score final.
-- Idempotente. Déployer avant le client.
BEGIN;

CREATE TABLE IF NOT EXISTS public.live_score_events(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 match_id uuid NOT NULL REFERENCES live_matches(id) ON DELETE CASCADE,
 score jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS live_score_events_match ON public.live_score_events(match_id,id);
ALTER TABLE public.live_score_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.live_score_events FROM anon,authenticated;

-- Mêmes clés que live_posts.score. Le déclenchement (WHEN) ignore les points de tie-break d'un
-- set normal : seuls les jeux, le super tie-break (set3_j1/j2) et le démarrage écrivent une ligne.
CREATE OR REPLACE FUNCTION public.record_live_score_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 INSERT INTO live_score_events(match_id,score) VALUES(NEW.id,
  jsonb_build_object('set1_j1',NEW.set1_j1,'set1_j2',NEW.set1_j2,'set2_j1',NEW.set2_j1,'set2_j2',NEW.set2_j2,
   'set3_j1',NEW.set3_j1,'set3_j2',NEW.set3_j2,'set3_format',NEW.set3_format,
   'set1_tb_j1',NEW.set1_tb_j1,'set1_tb_j2',NEW.set1_tb_j2,'set2_tb_j1',NEW.set2_tb_j1,'set2_tb_j2',NEW.set2_tb_j2,
   'set3_tb_j1',NEW.set3_tb_j1,'set3_tb_j2',NEW.set3_tb_j2));
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.record_live_score_event() FROM PUBLIC,anon,authenticated;

-- Pendant le live seulement (y compris l'écriture qui le termine) : un score réécrit hors live
-- (import, Ten'Up) n'entre pas dans le déroulé. Le démarrage pose l'instantané de départ.
DROP TRIGGER IF EXISTS live_matches_score_events ON public.live_matches;
CREATE TRIGGER live_matches_score_events AFTER UPDATE ON public.live_matches
FOR EACH ROW WHEN (
 (OLD.status='pending' AND NEW.status='live')
 OR ((OLD.status='live' OR NEW.status='live') AND
  (OLD.set1_j1,OLD.set1_j2,OLD.set2_j1,OLD.set2_j2,OLD.set3_j1,OLD.set3_j2,OLD.set3_format)
  IS DISTINCT FROM (NEW.set1_j1,NEW.set1_j2,NEW.set2_j1,NEW.set2_j2,NEW.set3_j1,NEW.set3_j2,NEW.set3_format))
) EXECUTE FUNCTION public.record_live_score_event();

CREATE TABLE IF NOT EXISTS public.live_match_viewers(
 match_id uuid NOT NULL REFERENCES live_matches(id) ON DELETE CASCADE,
 viewer uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(match_id,viewer)
);
ALTER TABLE public.live_match_viewers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.live_match_viewers FROM anon,authenticated;

-- p_viewer : UUID aléatoire propre à l'appareil (localStorage), aucune donnée personnelle.
-- Sans effet hors live ou pour un club inactif ; rejouable sans erreur.
CREATE OR REPLACE FUNCTION public.live_match_view(p_match uuid,p_viewer uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 INSERT INTO live_match_viewers(match_id,viewer)
 SELECT m.id,p_viewer FROM live_matches m JOIN clubs c ON c.id=m.club_id
 WHERE m.id=p_match AND m.status='live' AND c.status='active' AND p_viewer IS NOT NULL
 ON CONFLICT DO NOTHING
$$;

-- null si le match n'est pas terminé. viewers est null jusqu'à 11 spectateurs : le chiffre réel
-- d'un petit live n'est jamais exposé.
CREATE OR REPLACE FUNCTION public.live_match_recap(p_match uuid,p_club uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE m live_matches; viewers integer;
BEGIN
 SELECT lm.* INTO m FROM live_matches lm JOIN clubs c ON c.id=lm.club_id
 WHERE lm.id=p_match AND lm.club_id=p_club AND c.status='active';
 IF NOT FOUND THEN RAISE EXCEPTION 'Match introuvable.'; END IF;
 IF m.status<>'finished' THEN RETURN NULL; END IF;
 SELECT count(*) INTO viewers FROM live_match_viewers WHERE match_id=p_match;
 RETURN (SELECT jsonb_build_object(
  'messages',count(*) FILTER (WHERE kind='message'),
  'photos',count(*) FILTER (WHERE kind='photo'),
  'polls',count(*) FILTER (WHERE kind='poll'),
  'reactions',(SELECT count(*) FROM live_post_reactions r JOIN live_posts p ON p.id=r.post_id
    WHERE p.match_id=p_match AND p.deleted_at IS NULL),
  'top_reactions',coalesce((SELECT jsonb_agg(jsonb_build_object('emoji',t.emoji,'count',t.n) ORDER BY t.n DESC,t.first)
    FROM (SELECT r.emoji,count(*) n,min(r.created_at) first FROM live_post_reactions r JOIN live_posts p ON p.id=r.post_id
     WHERE p.match_id=p_match AND p.deleted_at IS NULL GROUP BY r.emoji ORDER BY n DESC,first LIMIT 3) t),'[]'::jsonb),
  'viewers',CASE WHEN viewers>10 THEN viewers END,
  'score',coalesce((SELECT jsonb_agg(e.score ORDER BY e.id) FROM live_score_events e WHERE e.match_id=p_match),'[]'::jsonb))
  FROM live_posts WHERE match_id=p_match AND deleted_at IS NULL);
END $$;

REVOKE ALL ON FUNCTION public.live_match_view(uuid,uuid),public.live_match_recap(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.live_match_view(uuid,uuid),public.live_match_recap(uuid,uuid) TO anon,authenticated;
COMMIT;
