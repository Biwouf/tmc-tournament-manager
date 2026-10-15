-- Réactions emoji sur les publications du live (commentaires et photos), en remplacement
-- des réactions éphémères du bouton flottant (table live_reactions supprimée).
-- N'importe quel emoji (clavier natif du téléphone), un seul par réaction.
-- Connexion requise ; une réaction par compte et par publication, modifiable et retirable,
-- y compris après la fin du match. Les noms de ceux qui ont réagi ne sont renvoyés
-- qu'aux comptes connectés. Déployer cette migration avant le client.
--
-- ⚠️ `live_activity_command` (depuis 2026101104_live_reactions_throttle) et
-- `live_activity_page` (depuis 2026101102_live_photos) sont redéfinies EN ENTIER.
-- Toute autre migration qui les redéfinit doit repartir de cette version.
BEGIN;

-- La suppression retire aussi la table de la publication supabase_realtime.
DROP TABLE public.live_reactions;

-- Un emoji unique (séquences ZWJ, tons de peau, drapeaux et keycaps compris), jamais du texte :
-- uniquement des points de code des blocs symboles/emoji, dont au moins un pictogramme.
CREATE FUNCTION public.live_is_emoji(p text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT coalesce(char_length(p) BETWEEN 1 AND 16
  AND p ~ '^[#*0-9©®︎️ -⯿〰〽㊗㊙\U0001F000-\U0001FAFF\U000E0020-\U000E007F]+$'
  AND p ~ '[©® -⯿〰〽㊗㊙\U0001F000-\U0001FAFF]',false)
$$;

CREATE TABLE public.live_post_reactions(
 post_id uuid NOT NULL REFERENCES live_posts(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 emoji text NOT NULL CHECK(live_is_emoji(emoji)),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(post_id,user_id)
);
ALTER TABLE live_post_reactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON live_post_reactions FROM anon,authenticated;
-- Aucune lecture ni écriture directe : agrégats via live_activity_page, écriture via la commande.

CREATE OR REPLACE FUNCTION public.live_activity_page(p_match uuid,p_club uuid,p_before bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM live_matches m JOIN clubs c ON c.id=m.club_id WHERE m.id=p_match AND m.club_id=p_club AND c.status='active') THEN RAISE EXCEPTION 'Match introuvable.'; END IF;
 WITH page AS (
  SELECT p.* FROM live_posts p WHERE match_id=p_match AND deleted_at IS NULL
   AND (p_before IS NULL OR sequence<p_before) ORDER BY sequence DESC LIMIT 50
 ), items AS (
  SELECT p.sequence,jsonb_build_object('id',p.id,'sequence',p.sequence,'kind',p.kind,'body',p.body,
   'image_path',p.image_path,
   'author_name',p.author_name,'created_at',p.created_at,'score',p.score,'options',p.options,
   'closed',p.closed_at IS NOT NULL OR m.status<>'live','my_vote',v.option_index,
   'total',(SELECT count(*) FROM live_votes WHERE post_id=p.id),
   'counts',CASE WHEN v.option_index IS NOT NULL OR p.closed_at IS NOT NULL OR m.status<>'live'
    THEN (SELECT jsonb_agg((SELECT count(*) FROM live_votes vv WHERE vv.post_id=p.id AND vv.option_index=o.i))
          FROM generate_series(0,jsonb_array_length(p.options)-1) o(i)) ELSE NULL END,
   'my_reaction',(SELECT emoji FROM live_post_reactions WHERE post_id=p.id AND user_id=auth.uid()),
   -- Noms des auteurs de réactions réservés aux comptes connectés.
   'reactions',coalesce((SELECT jsonb_agg(jsonb_build_object('emoji',r.emoji,'count',r.n,
     'names',CASE WHEN auth.uid() IS NOT NULL THEN r.names END) ORDER BY r.first)
    FROM (SELECT pr.emoji,count(*) n,min(pr.created_at) first,
      jsonb_agg(coalesce(nullif(btrim(concat_ws(' ',pf.prenom,pf.nom)),''),'Un spectateur') ORDER BY pr.created_at) names
     FROM live_post_reactions pr LEFT JOIN profiles pf ON pf.id=pr.user_id
     WHERE pr.post_id=p.id GROUP BY pr.emoji) r),'[]'::jsonb)) item
  FROM page p JOIN live_matches m ON m.id=p.match_id
  LEFT JOIN live_votes v ON v.post_id=p.id AND v.user_id=auth.uid()
 )
 SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(item ORDER BY sequence) FROM items),'[]'::jsonb),
  'before',(SELECT min(sequence) FROM page),
  'has_more',EXISTS(SELECT 1 FROM live_posts WHERE match_id=p_match AND deleted_at IS NULL AND sequence<(SELECT min(sequence) FROM page)),
  'can_animate',live_can_animate(p_club)) INTO result;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.live_activity_command(p_match uuid,p_club uuid,p_action text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE m live_matches; p live_posts; request uuid; choices jsonb; content text; name text; image text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Connectez-vous pour participer.' USING ERRCODE='42501'; END IF;
 -- Réaction à un commentaire ou une photo : aucun verrou sur le match, permise après la fin.
 -- Une par compte et par publication ; emoji null = retrait. Rejouable (état cible).
 IF p_action='react' THEN
  SELECT p2.* INTO p FROM live_posts p2 JOIN live_matches lm ON lm.id=p2.match_id JOIN clubs c ON c.id=lm.club_id
  WHERE p2.id=(p_data->>'id')::uuid AND p2.match_id=p_match AND lm.club_id=p_club AND c.status='active'
   AND p2.deleted_at IS NULL AND p2.kind IN ('message','photo') FOR UPDATE OF p2;
  IF NOT FOUND THEN RAISE EXCEPTION 'Publication indisponible.'; END IF;
  IF p_data->>'emoji' IS NULL THEN DELETE FROM live_post_reactions WHERE post_id=p.id AND user_id=auth.uid();
  ELSIF NOT live_is_emoji(p_data->>'emoji') THEN RAISE EXCEPTION 'Réaction invalide.';
  ELSE
   INSERT INTO live_post_reactions(post_id,user_id,emoji) VALUES(p.id,auth.uid(),p_data->>'emoji')
   ON CONFLICT(post_id,user_id) DO UPDATE SET emoji=excluded.emoji,created_at=clock_timestamp()
   WHERE live_post_reactions.emoji<>excluded.emoji;
  END IF;
  -- Diffuse le changement aux autres lecteurs via le temps réel de live_posts.
  UPDATE live_posts SET updated_at=clock_timestamp() WHERE id=p.id;
  RETURN jsonb_build_object('id',p.id);
 END IF;
 SELECT lm.* INTO m FROM live_matches lm JOIN clubs c ON c.id=lm.club_id
 WHERE lm.id=p_match AND lm.club_id=p_club AND c.status='active' FOR UPDATE OF lm;
 IF NOT FOUND THEN RAISE EXCEPTION 'Match introuvable.'; END IF;
 IF p_action IN ('message','poll','photo','close','delete') AND NOT live_can_animate(p_club) THEN
  RAISE EXCEPTION 'Seuls les membres de ce club peuvent animer le live.' USING ERRCODE='42501'; END IF;
 IF m.status<>'live' AND p_action<>'delete' THEN RAISE EXCEPTION 'Ce match n’est pas en cours.'; END IF;
 IF p_action IN ('message','poll','photo') THEN
  request:=(p_data->>'id')::uuid; choices:=coalesce(p_data->'options','[]'::jsonb);
  content:=CASE WHEN p_action='photo' THEN btrim(coalesce(p_data->>'body','')) ELSE btrim(p_data->>'body') END;
  IF request IS NULL OR content IS NULL OR char_length(content) NOT BETWEEN (CASE WHEN p_action='photo' THEN 0 ELSE 1 END) AND (CASE WHEN p_action='poll' THEN 140 ELSE 280 END) THEN RAISE EXCEPTION 'Texte invalide.'; END IF;
  IF p_action='poll' THEN
   IF jsonb_typeof(choices)<>'array' OR jsonb_array_length(choices) NOT BETWEEN 2 AND 4 THEN RAISE EXCEPTION 'Choisissez 2 à 4 réponses.'; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(choices) o WHERE jsonb_typeof(o)<>'string' OR char_length(btrim(o#>>'{}')) NOT BETWEEN 1 AND 60)
    OR (SELECT count(DISTINCT lower(btrim(o#>>'{}'))) FROM jsonb_array_elements(choices) o)<>jsonb_array_length(choices)
    THEN RAISE EXCEPTION 'Les réponses doivent être distinctes et non vides.'; END IF;
   SELECT jsonb_agg(btrim(o#>>'{}')) INTO choices FROM jsonb_array_elements(choices) o;
  ELSE choices:='[]'::jsonb; END IF;
  IF p_action='photo' THEN image:=p_club::text||'/'||p_match::text||'/'||request::text||'.jpg'; END IF;
  SELECT * INTO p FROM live_posts WHERE id=request;
  IF FOUND THEN
   IF p.author_id IS DISTINCT FROM auth.uid() OR p.match_id<>p_match OR p.kind<>p_action OR p.body<>content OR p.options<>choices THEN RAISE EXCEPTION 'Publication déjà utilisée.'; END IF;
   RETURN jsonb_build_object('id',p.id);
  END IF;
  IF p_action='photo' AND NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='live-images' AND o.name=image) THEN
   RAISE EXCEPTION 'Photo introuvable, réessayez l’envoi.'; END IF;
  SELECT coalesce(nullif(btrim(concat_ws(' ',prenom,nom)),''),'Membre du club') INTO name FROM profiles WHERE id=auth.uid();
  INSERT INTO live_posts(id,match_id,author_id,author_name,kind,body,options,image_path,score)
  VALUES(request,p_match,auth.uid(),coalesce(name,'Membre du club'),p_action,content,choices,image,
   jsonb_build_object('set1_j1',m.set1_j1,'set1_j2',m.set1_j2,'set2_j1',m.set2_j1,'set2_j2',m.set2_j2,
    'set3_j1',m.set3_j1,'set3_j2',m.set3_j2,'set3_format',m.set3_format,
    'set1_tb_j1',m.set1_tb_j1,'set1_tb_j2',m.set1_tb_j2,'set2_tb_j1',m.set2_tb_j1,'set2_tb_j2',m.set2_tb_j2,
    'set3_tb_j1',m.set3_tb_j1,'set3_tb_j2',m.set3_tb_j2));
  RETURN jsonb_build_object('id',request);
 ELSIF p_action IN ('vote','close','delete') THEN
  SELECT * INTO p FROM live_posts WHERE id=(p_data->>'id')::uuid AND match_id=p_match FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Publication indisponible.'; END IF;
  IF p.deleted_at IS NOT NULL THEN
   IF p_action='delete' THEN RETURN jsonb_build_object('id',p.id); END IF;
   RAISE EXCEPTION 'Publication indisponible.';
  END IF;
  IF p_action='delete' THEN UPDATE live_posts SET deleted_at=clock_timestamp() WHERE id=p.id;
  ELSE
   IF p.kind<>'poll' THEN RAISE EXCEPTION 'Sondage introuvable.'; END IF;
   IF p_action='close' THEN UPDATE live_posts SET closed_at=coalesce(closed_at,clock_timestamp()) WHERE id=p.id;
   ELSE
    IF p.closed_at IS NOT NULL THEN RAISE EXCEPTION 'Ce sondage est clôturé.'; END IF;
    IF (p_data->>'option') IS NULL OR (p_data->>'option')::integer NOT BETWEEN 0 AND jsonb_array_length(p.options)-1 THEN RAISE EXCEPTION 'Réponse invalide.'; END IF;
    INSERT INTO live_votes VALUES(p.id,auth.uid(),(p_data->>'option')::integer)
    ON CONFLICT(post_id,user_id) DO UPDATE SET option_index=excluded.option_index;
    UPDATE live_posts SET updated_at=clock_timestamp() WHERE id=p.id;
   END IF;
  END IF;
  RETURN jsonb_build_object('id',p.id);
 END IF;
 RAISE EXCEPTION 'Action inconnue.';
END $$;
COMMIT;
