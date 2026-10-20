-- Commentaires et photos du live autorisés après la fin du match (status='finished'),
-- pour les mêmes animateurs du club. Les sondages (lancement, vote, clôture) restent
-- réservés au match en cours : ils sont affichés clôturés dès la fin du match.
-- Un match en attente reste fermé à toute publication. Déployer cette migration avant le client.
--
-- ⚠️ `live_activity_command` (depuis 2026101501_live_post_reactions) est redéfinie EN ENTIER ;
-- seule la garde de statut change. Toute autre migration qui la redéfinit doit repartir de cette version.
BEGIN;

-- Dépôt d'une photo dans le bucket : match en cours ou terminé.
CREATE OR REPLACE FUNCTION public.live_image_writable(p_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT p_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$' AND EXISTS(
  SELECT 1 FROM live_matches m
  WHERE m.club_id::text=split_part(p_name,'/',1) AND m.id::text=split_part(p_name,'/',2)
   AND m.status IN ('live','finished') AND live_can_animate(m.club_id))
$$;

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
 -- Commentaire ou photo : aussi après la fin du match ; le reste exige un match en cours.
 IF p_action<>'delete' AND m.status<>'live' AND NOT (p_action IN ('message','photo') AND m.status='finished')
  THEN RAISE EXCEPTION 'Ce match n’est pas en cours.'; END IF;
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
