-- Replay du récap (story « Revivre le match ») : live_match_recap est redéfinie EN ENTIER
-- (depuis 2026102203_live_recap) pour renvoyer en plus :
--   score[].at   — heure de chaque instantané, pour rejouer le match à son rythme
--   moments      — les 5 commentaires ou photos les plus réagis, placés à leur heure
--   photos_top   — les 6 photos les plus réagies, pour le diaporama (photos reste leur nombre)
-- Mêmes droits et même seuil de spectateurs. Lecture seule, aucune table touchée. Idempotente.
BEGIN;

CREATE OR REPLACE FUNCTION public.live_match_recap(p_match uuid,p_club uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE m live_matches; viewers integer;
BEGIN
 SELECT lm.* INTO m FROM live_matches lm JOIN clubs c ON c.id=lm.club_id
 WHERE lm.id=p_match AND lm.club_id=p_club AND c.status='active';
 IF NOT FOUND THEN RAISE EXCEPTION 'Match introuvable.'; END IF;
 IF m.status<>'finished' THEN RETURN NULL; END IF;
 SELECT count(*) INTO viewers FROM live_match_viewers WHERE match_id=p_match;
 RETURN (WITH posts AS (
   SELECT p.id,p.sequence,p.kind,p.body,p.image_path,p.author_name,p.created_at,p.score,
    (SELECT count(*) FROM live_post_reactions r WHERE r.post_id=p.id) reactions,
    (SELECT r.emoji FROM live_post_reactions r WHERE r.post_id=p.id
      GROUP BY r.emoji ORDER BY count(*) DESC,min(r.created_at) LIMIT 1) emoji
   FROM live_posts p WHERE p.match_id=p_match AND p.deleted_at IS NULL
  ), reacted AS (
   SELECT *,jsonb_build_object('id',id,'kind',kind,'body',body,'image_path',image_path,'author_name',author_name,
    'created_at',created_at,'score',score,'reactions',reactions,'emoji',emoji) item
   FROM posts WHERE kind IN ('message','photo')
  )
  SELECT jsonb_build_object(
  'messages',(SELECT count(*) FROM posts WHERE kind='message'),
  'photos',(SELECT count(*) FROM posts WHERE kind='photo'),
  'polls',(SELECT count(*) FROM posts WHERE kind='poll'),
  'reactions',(SELECT coalesce(sum(reactions),0)::bigint FROM posts),
  'top_reactions',coalesce((SELECT jsonb_agg(jsonb_build_object('emoji',t.emoji,'count',t.n) ORDER BY t.n DESC,t.first)
    FROM (SELECT r.emoji,count(*) n,min(r.created_at) first FROM live_post_reactions r JOIN posts p ON p.id=r.post_id
     GROUP BY r.emoji ORDER BY n DESC,first LIMIT 3) t),'[]'::jsonb),
  'viewers',CASE WHEN viewers>10 THEN viewers END,
  'score',coalesce((SELECT jsonb_agg(e.score||jsonb_build_object('at',e.created_at) ORDER BY e.id)
    FROM live_score_events e WHERE e.match_id=p_match),'[]'::jsonb),
  'moments',coalesce((SELECT jsonb_agg(t.item ORDER BY t.sequence)
    FROM (SELECT item,sequence FROM reacted ORDER BY reactions DESC,sequence LIMIT 5) t),'[]'::jsonb),
  'photos_top',coalesce((SELECT jsonb_agg(t.item ORDER BY t.reactions DESC,t.sequence)
    FROM (SELECT item,reactions,sequence FROM reacted WHERE kind='photo' ORDER BY reactions DESC,sequence LIMIT 6) t),'[]'::jsonb)));
END $$;

REVOKE ALL ON FUNCTION public.live_match_recap(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.live_match_recap(uuid,uuid) TO anon,authenticated;
COMMIT;
