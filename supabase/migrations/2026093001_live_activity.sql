-- Animation du live : droits uniques des membres, fil public, votes privés.
-- Déployer cette migration avant le client. Aucun service distant modifié par la PR.
BEGIN;
CREATE FUNCTION public.live_can_animate(p_club uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM clubs c WHERE c.id=p_club AND c.status='active')
 AND (is_super_admin() OR EXISTS(SELECT 1 FROM club_members m WHERE m.club_id=p_club AND m.user_id=auth.uid()))
$$;
CREATE FUNCTION public.live_can_read(p_match uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM live_matches m JOIN clubs c ON c.id=m.club_id WHERE m.id=p_match AND c.status='active')
$$;
REVOKE ALL ON FUNCTION public.live_can_animate(uuid),public.live_can_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.live_can_animate(uuid),public.live_can_read(uuid) TO anon,authenticated;
-- Les utilisateurs connectés sans adhésion ont la même lecture que les visiteurs.
CREATE POLICY live_authenticated_public_read ON public.live_matches FOR SELECT TO authenticated
USING(public.live_can_read(id));

CREATE OR REPLACE FUNCTION public.guard_live_match_write() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE caller uuid:=auth.uid();
BEGIN
 IF TG_OP='UPDATE' THEN NEW.revision:=OLD.revision+1; END IF;
 IF TG_OP='INSERT' THEN NEW.revision:=0; END IF;
 IF current_user IN ('postgres','service_role','supabase_admin') THEN
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
 END IF;
 IF caller IS NULL THEN RAISE EXCEPTION 'Connexion requise.' USING ERRCODE='42501'; END IF;
 -- Conserver les suppressions de FK et les protections des matchs d'équipes.
 IF TG_OP='UPDATE' AND pg_trigger_depth()>1 AND
  (to_jsonb(NEW)-ARRAY['event_id','team_match_line_id','team_rencontre_id','revision','updated_at'])=
  (to_jsonb(OLD)-ARRAY['event_id','team_match_line_id','team_rencontre_id','revision','updated_at']) THEN RETURN NEW; END IF;
 IF NOT live_can_animate(CASE WHEN TG_OP='INSERT' THEN NEW.club_id ELSE OLD.club_id END) THEN
  RAISE EXCEPTION 'Seuls les membres de ce club peuvent gérer ce live.' USING ERRCODE='42501';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'pending' OR NEW.scored_by IS NOT NULL THEN RAISE EXCEPTION 'Créer un match en attente avant de le démarrer.'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.club_id IS DISTINCT FROM OLD.club_id OR NEW.id IS DISTINCT FROM OLD.id THEN
  RAISE EXCEPTION 'Le club et l’identifiant du match ne peuvent pas être modifiés.' USING ERRCODE='42501';
 END IF;
 -- scored_by est une attribution du dernier marqueur, plus une exclusivité.
 IF NEW.scored_by IS DISTINCT FROM OLD.scored_by AND NEW.scored_by IS DISTINCT FROM caller AND
  NOT (NEW.scored_by IS NULL AND NEW.status='pending') THEN RAISE EXCEPTION 'Marqueur invalide.'; END IF;
 RETURN NEW;
END $$;

CREATE TABLE public.live_posts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 match_id uuid NOT NULL REFERENCES live_matches(id) ON DELETE CASCADE,
 author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 author_name text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('message','poll')),
 body text NOT NULL CHECK(char_length(btrim(body)) BETWEEN 1 AND 280),
 options jsonb NOT NULL DEFAULT '[]',
 score jsonb NOT NULL,
 closed_at timestamptz,
 deleted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((kind='message' AND options='[]'::jsonb) OR
       (kind='poll' AND char_length(body)<=140 AND jsonb_typeof(options)='array' AND jsonb_array_length(options) BETWEEN 2 AND 4))
);
CREATE INDEX live_posts_feed ON public.live_posts(match_id,sequence DESC) WHERE deleted_at IS NULL;
CREATE TABLE public.live_votes(
 post_id uuid NOT NULL REFERENCES live_posts(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 option_index integer NOT NULL CHECK(option_index BETWEEN 0 AND 3),
 PRIMARY KEY(post_id,user_id)
);
CREATE TABLE public.live_reactions(
 id uuid PRIMARY KEY,
 match_id uuid NOT NULL REFERENCES live_matches(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 emoji text NOT NULL CHECK(emoji IN ('👏','🔥','💪','❤️','😮','🎉')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX live_reactions_recent ON public.live_reactions(created_at);
ALTER TABLE live_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_reactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON live_posts,live_votes,live_reactions FROM anon,authenticated;
GRANT SELECT ON live_posts,live_reactions TO anon,authenticated;
CREATE POLICY live_posts_read ON live_posts FOR SELECT TO anon,authenticated USING(deleted_at IS NULL AND live_can_read(match_id));
CREATE POLICY live_reactions_read ON live_reactions FOR SELECT TO anon,authenticated
USING(live_can_read(match_id) AND created_at>clock_timestamp()-interval '15 seconds');
-- Aucune lecture directe des votes, aucune écriture directe du fil.

CREATE FUNCTION public.live_activity_page(p_match uuid,p_club uuid,p_before bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM live_matches m JOIN clubs c ON c.id=m.club_id WHERE m.id=p_match AND m.club_id=p_club AND c.status='active') THEN RAISE EXCEPTION 'Match introuvable.'; END IF;
 WITH page AS (
  SELECT p.* FROM live_posts p WHERE match_id=p_match AND deleted_at IS NULL
   AND (p_before IS NULL OR sequence<p_before) ORDER BY sequence DESC LIMIT 50
 ), items AS (
  SELECT p.sequence,jsonb_build_object('id',p.id,'sequence',p.sequence,'kind',p.kind,'body',p.body,
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

CREATE FUNCTION public.live_activity_command(p_match uuid,p_club uuid,p_action text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE m live_matches; p live_posts; request uuid; choices jsonb; content text; name text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Connectez-vous pour participer.' USING ERRCODE='42501'; END IF;
 SELECT lm.* INTO m FROM live_matches lm JOIN clubs c ON c.id=lm.club_id
 WHERE lm.id=p_match AND lm.club_id=p_club AND c.status='active' FOR UPDATE OF lm;
 IF NOT FOUND THEN RAISE EXCEPTION 'Match introuvable.'; END IF;
 IF p_action IN ('message','poll','close','delete') AND NOT live_can_animate(p_club) THEN
  RAISE EXCEPTION 'Seuls les membres de ce club peuvent animer le live.' USING ERRCODE='42501'; END IF;
 IF m.status<>'live' AND p_action<>'delete' THEN RAISE EXCEPTION 'Ce match n’est pas en cours.'; END IF;
 IF p_action IN ('message','poll') THEN
  request:=(p_data->>'id')::uuid; content:=btrim(p_data->>'body'); choices:=coalesce(p_data->'options','[]'::jsonb);
  IF request IS NULL OR content IS NULL OR char_length(content) NOT BETWEEN 1 AND (CASE WHEN p_action='poll' THEN 140 ELSE 280 END) THEN RAISE EXCEPTION 'Texte invalide.'; END IF;
  IF p_action='poll' THEN
   IF jsonb_typeof(choices)<>'array' OR jsonb_array_length(choices) NOT BETWEEN 2 AND 4 THEN RAISE EXCEPTION 'Choisissez 2 à 4 réponses.'; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(choices) o WHERE jsonb_typeof(o)<>'string' OR char_length(btrim(o#>>'{}')) NOT BETWEEN 1 AND 60)
    OR (SELECT count(DISTINCT lower(btrim(o#>>'{}'))) FROM jsonb_array_elements(choices) o)<>jsonb_array_length(choices)
    THEN RAISE EXCEPTION 'Les réponses doivent être distinctes et non vides.'; END IF;
   SELECT jsonb_agg(btrim(o#>>'{}')) INTO choices FROM jsonb_array_elements(choices) o;
  ELSE choices:='[]'::jsonb; END IF;
  SELECT * INTO p FROM live_posts WHERE id=request;
  IF FOUND THEN
   IF p.author_id IS DISTINCT FROM auth.uid() OR p.match_id<>p_match OR p.kind<>p_action OR p.body<>content OR p.options<>choices THEN RAISE EXCEPTION 'Publication déjà utilisée.'; END IF;
   RETURN jsonb_build_object('id',p.id);
  END IF;
  SELECT coalesce(nullif(btrim(concat_ws(' ',prenom,nom)),''),'Membre du club') INTO name FROM profiles WHERE id=auth.uid();
  INSERT INTO live_posts(id,match_id,author_id,author_name,kind,body,options,score)
  VALUES(request,p_match,auth.uid(),coalesce(name,'Membre du club'),p_action,content,choices,
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
REVOKE ALL ON FUNCTION public.live_activity_page(uuid,uuid,bigint),public.live_activity_command(uuid,uuid,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.live_activity_page(uuid,uuid,bigint) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.live_activity_command(uuid,uuid,text,jsonb) TO authenticated;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.live_posts,public.live_reactions;
 END IF;
END $$;
COMMIT;
