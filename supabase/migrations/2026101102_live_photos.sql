-- Photos du live : une image (pellicule ou appareil photo) et une légende facultative,
-- publiées par les animateurs (membres du club). Déployer cette migration avant le client.
--
-- Fichier : bucket public `live-images`, chemin `<club_id>/<match_id>/<post_id>.jpg`.
-- Le client envoie l'image puis appelle `live_activity_command('photo', {id, body})` ;
-- le serveur recalcule le chemin et exige que l'objet existe. À la suppression de la
-- publication, le client retire l'objet (policy DELETE réservée aux images non référencées).
--
-- ⚠️ `live_activity_command` et `live_activity_page` sont redéfinies EN ENTIER depuis
-- 2026093001. Toute autre migration qui les redéfinit doit repartir de cette version.
BEGIN;

ALTER TABLE public.live_posts ADD COLUMN image_path text;
ALTER TABLE public.live_posts DROP CONSTRAINT live_posts_kind_check,
 DROP CONSTRAINT live_posts_body_check, DROP CONSTRAINT live_posts_check;
ALTER TABLE public.live_posts
 ADD CONSTRAINT live_posts_kind_check CHECK(kind IN ('message','poll','photo')),
 -- La légende d'une photo peut être vide ; les autres publications gardent 1 à 280 caractères.
 ADD CONSTRAINT live_posts_body_check CHECK(char_length(btrim(body)) BETWEEN (CASE WHEN kind='photo' THEN 0 ELSE 1 END) AND 280),
 ADD CONSTRAINT live_posts_check CHECK(
  (kind='message' AND options='[]'::jsonb AND image_path IS NULL) OR
  (kind='poll' AND char_length(body)<=140 AND jsonb_typeof(options)='array' AND jsonb_array_length(options) BETWEEN 2 AND 4 AND image_path IS NULL) OR
  (kind='photo' AND options='[]'::jsonb AND image_path IS NOT NULL));

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 VALUES('live-images','live-images',true,5242880,ARRAY['image/jpeg']);

-- Comparaison en texte : aucun cast ::uuid dans une policy (cf. 20260822_config_storage_tenant).
CREATE FUNCTION public.live_image_writable(p_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT p_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$' AND EXISTS(
  SELECT 1 FROM live_matches m
  WHERE m.club_id::text=split_part(p_name,'/',1) AND m.id::text=split_part(p_name,'/',2)
   AND m.status='live' AND live_can_animate(m.club_id))
$$;
CREATE FUNCTION public.live_image_manageable(p_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM clubs c WHERE c.id::text=split_part(p_name,'/',1) AND live_can_animate(c.id))
$$;
-- Une image encore affichée dans le fil n'est pas supprimable.
CREATE FUNCTION public.live_image_unused(p_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT NOT EXISTS(SELECT 1 FROM live_posts WHERE image_path=p_name AND deleted_at IS NULL)
$$;
REVOKE ALL ON FUNCTION public.live_image_writable(text),public.live_image_manageable(text),public.live_image_unused(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.live_image_writable(text),public.live_image_manageable(text),public.live_image_unused(text) TO authenticated;

-- Lecture publique par URL (bucket public) ; SELECT requis par l'API Storage pour supprimer.
CREATE POLICY live_images_insert ON storage.objects FOR INSERT TO authenticated
 WITH CHECK(bucket_id='live-images' AND public.live_image_writable(name));
CREATE POLICY live_images_select ON storage.objects FOR SELECT TO authenticated
 USING(bucket_id='live-images' AND public.live_image_manageable(name));
CREATE POLICY live_images_delete ON storage.objects FOR DELETE TO authenticated
 USING(bucket_id='live-images' AND public.live_image_manageable(name) AND public.live_image_unused(name));

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
          FROM generate_series(0,jsonb_array_length(p.options)-1) o(i)) ELSE NULL END) item
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
 ELSIF p_action='reaction' THEN
  request:=(p_data->>'id')::uuid;
  IF request IS NULL OR coalesce(p_data->>'emoji','') NOT IN ('👏','🔥','💪','❤️','😮','🎉') THEN RAISE EXCEPTION 'Réaction invalide.'; END IF;
  INSERT INTO live_reactions(id,match_id,user_id,emoji) VALUES(request,p_match,auth.uid(),p_data->>'emoji') ON CONFLICT DO NOTHING;
  IF NOT EXISTS(SELECT 1 FROM live_reactions WHERE id=request AND match_id=p_match AND user_id=auth.uid() AND emoji=p_data->>'emoji') THEN
   RAISE EXCEPTION 'Réaction déjà utilisée.';
  END IF;
  -- Événements conservés 30 secondes au maximum après la prochaine activité.
  DELETE FROM live_reactions WHERE created_at<clock_timestamp()-interval '30 seconds';
  RETURN jsonb_build_object('id',request);
 END IF;
 RAISE EXCEPTION 'Action inconnue.';
END $$;
COMMIT;
