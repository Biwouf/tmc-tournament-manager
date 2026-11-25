-- Interview d'après-match (docs/specs/INTERVIEWS.md).
--   live_match_members — joueurs d'un live rattachés à un membre du club (égalité stricte du nom
--                        normalisé, ou member_id de la ligne de rencontre par équipes)
--   live_interviews    — une demande par joueur membre et par live joué en direct
-- À la fin d'un live : rattachement, demandes, push au joueur (file content_push_deliveries,
-- type « interview »). Les questions sont générées par l'Edge Function generate-interview,
-- les réponses publiées dans le récap du live. Rien ici ne peut faire échouer une écriture de score.
BEGIN;

-- Clé de nom : minuscules, sans accents, sans rien d'autre que [a-z0-9].
CREATE FUNCTION public.live_name_key(p_prenom text,p_nom text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT regexp_replace(translate(lower(coalesce(p_prenom,'')||coalesce(p_nom,'')),
  'àâäáãåéèêëíìîïóòôöõúùûüçñÿÀÂÄÁÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÇÑŸ',
  'aaaaaaeeeeiiiiooooouuuucnyaaaaaaeeeeiiiiooooouuuucny'),'[^a-z0-9]','','g')
$$;
REVOKE ALL ON FUNCTION public.live_name_key(text,text) FROM PUBLIC,anon,authenticated;

CREATE TABLE public.live_match_members (
  live_match_id uuid NOT NULL REFERENCES public.live_matches(id) ON DELETE CASCADE,
  side text NOT NULL CHECK (side IN ('j1','j2','j3','j4')),
  club_id uuid NOT NULL,
  member_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  PRIMARY KEY (live_match_id,side)
);
CREATE INDEX live_match_members_member ON public.live_match_members(club_id,member_id);
ALTER TABLE public.live_match_members ENABLE ROW LEVEL SECURITY;
-- Lu et écrit seulement par les fonctions ci-dessous.
REVOKE ALL ON public.live_match_members FROM PUBLIC,anon,authenticated;

CREATE TABLE public.live_interviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL,
  live_match_id uuid NOT NULL REFERENCES public.live_matches(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  side text NOT NULL CHECK (side IN ('j1','j2','j3','j4')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','ready','published','declined','removed')),
  questions jsonb NOT NULL DEFAULT '[]',
  answers jsonb NOT NULL DEFAULT '[]',
  gen_attempts integer NOT NULL DEFAULT 0,
  generated_at timestamptz,
  published_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (live_match_id,member_id)
);
CREATE INDEX live_interviews_member ON public.live_interviews(club_id,member_id,status);
CREATE INDEX live_interviews_generated ON public.live_interviews(generated_at) WHERE generated_at IS NOT NULL;
ALTER TABLE public.live_interviews ENABLE ROW LEVEL SECURITY;
-- Aucun accès direct : lecture et écriture par les RPC ci-dessous.
REVOKE ALL ON public.live_interviews FROM PUBLIC,anon,authenticated;

-- Push du joueur dans la file des actus (même réclamation, même dispatcher).
ALTER TABLE public.content_push_deliveries DROP CONSTRAINT content_push_deliveries_kind_check;
ALTER TABLE public.content_push_deliveries ADD CONSTRAINT content_push_deliveries_kind_check
  CHECK (kind IN ('actu','event','interview'));

-- Rattache les joueurs d'un live aux membres de son club. Recalculé à chaque fin de match.
CREATE FUNCTION public.live_match_resolve_members(p_match uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE m live_matches; n integer;
BEGIN
  SELECT * INTO m FROM live_matches WHERE id=p_match;
  IF NOT FOUND THEN RETURN 0; END IF;
  DELETE FROM live_match_members WHERE live_match_id=p_match;
  INSERT INTO live_match_members(live_match_id,side,club_id,member_id)
  SELECT p_match,s.side,m.club_id,r.member_id
  FROM (VALUES ('j1',m.j1_prenom,m.j1_nom),('j2',m.j2_prenom,m.j2_nom),
               ('j3',m.j3_prenom,m.j3_nom),('j4',m.j4_prenom,m.j4_nom)) s(side,prenom,nom)
  CROSS JOIN LATERAL (SELECT live_name_key(s.prenom,s.nom) k1,live_name_key(s.nom,s.prenom) k2) k
  CROSS JOIN LATERAL (SELECT coalesce(
    -- Rencontre par équipes : le member_id de la ligne fait foi.
    (SELECT (q->>'member_id')::uuid FROM team_match_lines l,jsonb_array_elements(l.joueurs_club) q
      WHERE l.id=m.team_match_line_id AND q->>'member_id' IS NOT NULL
        AND live_name_key(q->>'prenom',q->>'nom') IN (k.k1,k.k2)
        AND EXISTS(SELECT 1 FROM club_members cm WHERE cm.club_id=m.club_id AND cm.user_id=(q->>'member_id')::uuid)
      LIMIT 1),
    -- Sinon un seul membre du club au même nom ; aucun ou plusieurs : pas de rattachement.
    (SELECT CASE WHEN count(DISTINCT cm.user_id)=1 THEN (array_agg(cm.user_id))[1] END
      FROM club_members cm JOIN profiles p ON p.id=cm.user_id
      WHERE cm.club_id=m.club_id AND live_name_key(p.prenom,p.nom)<>''
        AND live_name_key(p.prenom,p.nom) IN (k.k1,k.k2))
  ) member_id) r
  WHERE k.k1<>'' AND r.member_id IS NOT NULL;
  GET DIAGNOSTICS n=ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.live_match_resolve_members(uuid) FROM PUBLIC,anon,authenticated;

-- Nom affiché d'un camp : « Prénom Nom » ou « A / B » en double.
CREATE FUNCTION public.live_interview_side_label(m live_matches,p_team text) RETURNS text
LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT CASE WHEN p_team='j1'
  THEN btrim(m.j1_prenom||' '||m.j1_nom)||coalesce(' / '||nullif(btrim(coalesce(m.j3_prenom,'')||' '||coalesce(m.j3_nom,'')),''),'')
  ELSE btrim(m.j2_prenom||' '||m.j2_nom)||coalesce(' / '||nullif(btrim(coalesce(m.j4_prenom,'')||' '||coalesce(m.j4_nom,'')),''),'') END
$$;
REVOKE ALL ON FUNCTION public.live_interview_side_label(live_matches,text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.live_interview_team(p_side text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT CASE WHEN p_side IN ('j1','j3') THEN 'j1' ELSE 'j2' END $$;

-- Fin d'un live : rattachement, demandes d'interview et push. Une erreur ici est avalée.
CREATE FUNCTION public.live_interviews_on_finish() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r record; iid uuid; team text; opponent text; pushed integer:=0; n integer;
BEGIN
  BEGIN
    PERFORM live_match_resolve_members(NEW.id);
    IF NEW.started_at IS NULL OR NOT EXISTS(SELECT 1 FROM clubs WHERE id=NEW.club_id AND status='active') THEN
      RETURN NULL;
    END IF;
    FOR r IN SELECT side,member_id FROM live_match_members WHERE live_match_id=NEW.id ORDER BY side LOOP
      iid:=NULL;
      INSERT INTO live_interviews(club_id,live_match_id,member_id,side,expires_at)
        VALUES(NEW.club_id,NEW.id,r.member_id,r.side,coalesce(NEW.finished_at,now())+interval '48 hours')
        ON CONFLICT (live_match_id,member_id) DO NOTHING RETURNING id INTO iid;
      CONTINUE WHEN iid IS NULL;
      team:=live_interview_team(r.side);
      opponent:=live_interview_side_label(NEW,CASE WHEN team='j1' THEN 'j2' ELSE 'j1' END);
      INSERT INTO content_push_deliveries(kind,content_id,subscription_id,title,body,url)
        SELECT 'interview',iid,s.id,'🎙️ Interview d''après-match',
          left('Le club veut ta réaction après '||CASE WHEN NEW.winner::text=team THEN 'ta victoire' ELSE 'ton match' END
            ||' contre '||opponent,150),
          '/interviews/'||iid
        FROM course_push_subscriptions s
        WHERE s.club_id=NEW.club_id AND s.user_id=r.member_id
        ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS n=ROW_COUNT;
      pushed:=pushed+n;
    END LOOP;
    IF pushed>0 THEN PERFORM live_push_kick(); END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'live_interviews_on_finish: %',SQLERRM;
  END;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.live_interviews_on_finish() FROM PUBLIC,anon,authenticated;

CREATE TRIGGER live_interviews_on_finish AFTER UPDATE OF status ON public.live_matches
  FOR EACH ROW WHEN (NEW.status='finished' AND OLD.status IS DISTINCT FROM 'finished')
  EXECUTE FUNCTION public.live_interviews_on_finish();

-- Résumé d'un live vu par un joueur, pour les écrans de la PWA.
CREATE FUNCTION public.live_interview_summary(i live_interviews) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE m live_matches; team text;
BEGIN
  SELECT * INTO m FROM live_matches WHERE id=i.live_match_id;
  team:=live_interview_team(i.side);
  RETURN jsonb_build_object(
    'id',i.id,'club_id',i.club_id,'live_match_id',i.live_match_id,'side',i.side,
    'status',CASE WHEN i.status IN ('pending','ready') AND i.expires_at<=now() THEN 'expired' ELSE i.status END,
    'expires_at',i.expires_at,
    'opponent',live_interview_side_label(m,CASE WHEN team='j1' THEN 'j2' ELSE 'j1' END),
    'result',CASE WHEN m.winner IS NULL THEN NULL WHEN m.winner::text=team THEN 'win' ELSE 'loss' END,
    'finished_at',m.finished_at,
    'sets',jsonb_build_array(
      jsonb_build_array(m.set1_j1,m.set1_j2),jsonb_build_array(m.set2_j1,m.set2_j2),jsonb_build_array(m.set3_j1,m.set3_j2)),
    'team',team);
END $$;
REVOKE ALL ON FUNCTION public.live_interview_summary(live_interviews) FROM PUBLIC,anon,authenticated;

-- Interviews en attente du joueur connecté dans un club.
CREATE FUNCTION public.interview_my_pending(p_club uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(live_interview_summary(i) ORDER BY i.created_at DESC),'[]'::jsonb)
 FROM live_interviews i JOIN clubs c ON c.id=i.club_id AND c.status='active'
 WHERE i.club_id=p_club AND i.member_id=auth.uid() AND i.status IN ('pending','ready') AND i.expires_at>now()
$$;
REVOKE ALL ON FUNCTION public.interview_my_pending(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.interview_my_pending(uuid) TO authenticated;

-- Une interview du joueur connecté, avec ses questions et réponses.
CREATE FUNCTION public.interview_get(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE i live_interviews;
BEGIN
  SELECT * INTO i FROM live_interviews WHERE id=p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Interview introuvable.' USING ERRCODE='P0002'; END IF;
  IF i.member_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Cette interview ne t''est pas destinée.' USING ERRCODE='42501';
  END IF;
  RETURN live_interview_summary(i)||jsonb_build_object('questions',i.questions,'answers',i.answers);
END $$;
REVOKE ALL ON FUNCTION public.interview_get(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.interview_get(uuid) TO authenticated;

-- Résultat d'un live passé du point de vue d'un joueur, pour l'historique.
CREATE FUNCTION public.live_interview_past(m live_matches,p_side text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT jsonb_build_object('source','live','date',coalesce(m.finished_at,m.match_date::timestamptz),
  'side',p_side,'match_type',m.match_type,
  'j1',jsonb_build_object('prenom',m.j1_prenom,'nom',m.j1_nom,'classement',m.j1_classement),
  'j2',jsonb_build_object('prenom',m.j2_prenom,'nom',m.j2_nom,'classement',m.j2_classement),
  'j3',CASE WHEN m.j3_nom IS NOT NULL THEN jsonb_build_object('prenom',m.j3_prenom,'nom',m.j3_nom,'classement',m.j3_classement) END,
  'j4',CASE WHEN m.j4_nom IS NOT NULL THEN jsonb_build_object('prenom',m.j4_prenom,'nom',m.j4_nom,'classement',m.j4_classement) END,
  'set1_j1',m.set1_j1,'set1_j2',m.set1_j2,'set1_tb_j1',m.set1_tb_j1,'set1_tb_j2',m.set1_tb_j2,
  'set2_j1',m.set2_j1,'set2_j2',m.set2_j2,'set2_tb_j1',m.set2_tb_j1,'set2_tb_j2',m.set2_tb_j2,
  'set3_j1',m.set3_j1,'set3_j2',m.set3_j2,'set3_tb_j1',m.set3_tb_j1,'set3_tb_j2',m.set3_tb_j2,
  'set3_format',m.set3_format,'winner',m.winner,'retired_player',m.retired_player)
$$;
REVOKE ALL ON FUNCTION public.live_interview_past(live_matches,text) FROM PUBLIC,anon,authenticated;

-- Début de génération (appelée par generate-interview avec le jeton du joueur) : contrôle les
-- droits et les plafonds AVANT l'appel payant, compte la tentative et renvoie les faits bruts.
-- Questions déjà générées : les renvoie sans nouvelle tentative.
CREATE FUNCTION public.interview_gen_begin(p_id uuid,p_global_daily_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE i live_interviews; m live_matches; team jsonb; history jsonb; team_lines jsonb; previous jsonb;
BEGIN
  SELECT * INTO i FROM live_interviews WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Interview introuvable.' USING ERRCODE='P0002'; END IF;
  IF i.member_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Cette interview ne t''est pas destinée.' USING ERRCODE='42501';
  END IF;
  IF i.status='ready' THEN RETURN jsonb_build_object('status','ready','questions',i.questions); END IF;
  IF i.status<>'pending' OR i.expires_at<=now()
     OR NOT EXISTS(SELECT 1 FROM clubs WHERE id=i.club_id AND status='active') THEN
    RAISE EXCEPTION 'Cette interview n''est plus disponible.' USING ERRCODE='P0002';
  END IF;
  IF i.gen_attempts>=3 THEN
    RAISE EXCEPTION 'Les questions n''ont pas pu être préparées. Réessaie plus tard.' USING ERRCODE='PT429';
  END IF;
  IF (SELECT count(*) FROM live_interviews WHERE generated_at>now()-interval '1 day')
     >=greatest(coalesce(p_global_daily_limit,0),0) THEN
    RAISE EXCEPTION 'Les interviews sont momentanément indisponibles. Réessaie demain.' USING ERRCODE='PT429';
  END IF;
  UPDATE live_interviews SET gen_attempts=gen_attempts+1 WHERE id=p_id;
  SELECT * INTO m FROM live_matches WHERE id=i.live_match_id;

  IF m.team_rencontre_id IS NOT NULL THEN
    SELECT jsonb_build_object('club_adverse',r.club_adverse,'score_club',r.score_club,'score_adverse',r.score_adverse,
      'competition',c.nom,'equipe',q.numero)
    INTO team FROM team_rencontres r
      LEFT JOIN team_etapes e ON e.id=r.etape_id LEFT JOIN team_equipes q ON q.id=e.equipe_id
      LEFT JOIN team_competitions c ON c.id=q.competition_id
    WHERE r.id=m.team_rencontre_id AND r.club_id=i.club_id;
  END IF;

  SELECT coalesce(jsonb_agg(h.item ORDER BY h.at DESC),'[]'::jsonb) INTO history FROM (
    SELECT live_interview_past(lm,mm.side) item,coalesce(lm.finished_at,lm.match_date::timestamptz) at
    FROM live_match_members mm JOIN live_matches lm ON lm.id=mm.live_match_id
    WHERE mm.club_id=i.club_id AND mm.member_id=i.member_id AND lm.id<>m.id AND lm.status='finished'
      AND coalesce(lm.finished_at,lm.match_date::timestamptz)<=coalesce(m.finished_at,now())
    ORDER BY at DESC LIMIT 20) h;

  SELECT coalesce(jsonb_agg(t.item ORDER BY t.at DESC),'[]'::jsonb) INTO team_lines FROM (
    SELECT jsonb_build_object('source','team','date',r.date_heure,'match_type',l.match_type,
      'joueurs_adverse',l.joueurs_adverse,'score',l.score,'gagnant',l.gagnant,'result_kind',l.result_kind,
      'club_adverse',r.club_adverse) item,r.date_heure at
    FROM team_match_lines l JOIN team_rencontres r ON r.id=l.rencontre_id
    WHERE l.club_id=i.club_id AND l.live_match_id IS NULL AND l.gagnant IS NOT NULL
      AND l.joueurs_club @> jsonb_build_array(jsonb_build_object('member_id',i.member_id))
      AND r.date_heure<=coalesce(m.finished_at,now())
    ORDER BY r.date_heure DESC LIMIT 20) t;

  SELECT coalesce(jsonb_agg(p.item ORDER BY p.at DESC),'[]'::jsonb) INTO previous FROM (
    SELECT jsonb_build_object('date',pi.published_at,'questions',pi.questions,'answers',pi.answers,
      'opponent',live_interview_side_label(pm,CASE WHEN live_interview_team(pi.side)='j1' THEN 'j2' ELSE 'j1' END)) item,
      pi.published_at at
    FROM live_interviews pi JOIN live_matches pm ON pm.id=pi.live_match_id
    WHERE pi.club_id=i.club_id AND pi.member_id=i.member_id AND pi.status='published' AND pi.id<>i.id
    ORDER BY pi.published_at DESC LIMIT 2) p;

  RETURN jsonb_build_object('status','pending','facts',jsonb_build_object(
    'side',i.side,
    'player',(SELECT jsonb_build_object('prenom',prenom,'nom',nom) FROM profiles WHERE id=i.member_id),
    'match',live_interview_past(m,i.side)||jsonb_build_object('court',m.court,'first_server',m.first_server,
      'started_at',m.started_at,'finished_at',m.finished_at,'set1_ended_at',m.set1_ended_at,'set2_ended_at',m.set2_ended_at),
    'recap',live_match_recap(m.id,m.club_id),
    'event',(SELECT jsonb_build_object('titre',e.titre) FROM events e WHERE e.id=m.event_id),
    'team',team,
    'history',history,
    'team_history',team_lines,
    'previous_interviews',previous));
END $$;
REVOKE ALL ON FUNCTION public.interview_gen_begin(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.interview_gen_begin(uuid,integer) TO authenticated;

-- Enregistre les questions générées. Réservée à l'Edge Function (service_role) : le joueur ne
-- peut pas écrire ses propres questions.
CREATE FUNCTION public.interview_gen_save(p_id uuid,p_member uuid,p_questions jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE i live_interviews; cleaned jsonb;
BEGIN
  SELECT * INTO i FROM live_interviews WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR i.member_id IS DISTINCT FROM p_member THEN
    RAISE EXCEPTION 'Interview introuvable.' USING ERRCODE='P0002';
  END IF;
  IF i.status='ready' THEN RETURN i.questions; END IF;
  IF i.status<>'pending' THEN RAISE EXCEPTION 'Cette interview n''est plus disponible.' USING ERRCODE='P0002'; END IF;
  IF jsonb_typeof(p_questions)<>'array' OR jsonb_array_length(p_questions) NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('id','q'||n,'texte',left(btrim(q #>> '{}'),300)) ORDER BY n) INTO cleaned
    FROM jsonb_array_elements(p_questions) WITH ORDINALITY x(q,n)
    WHERE jsonb_typeof(q)='string' AND btrim(q #>> '{}')<>'';
  IF cleaned IS NULL OR jsonb_array_length(cleaned)<>jsonb_array_length(p_questions) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR';
  END IF;
  UPDATE live_interviews SET questions=cleaned,status='ready',generated_at=now() WHERE id=p_id;
  RETURN cleaned;
END $$;
REVOKE ALL ON FUNCTION public.interview_gen_save(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.interview_gen_save(uuid,uuid,jsonb) TO service_role;

-- Publication des réponses : [{question_id, texte}], au moins une non vide, 1 000 caractères au plus.
CREATE FUNCTION public.interview_answer(p_id uuid,p_answers jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE i live_interviews; cleaned jsonb;
BEGIN
  SELECT * INTO i FROM live_interviews WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Interview introuvable.' USING ERRCODE='P0002'; END IF;
  IF i.member_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Cette interview ne t''est pas destinée.' USING ERRCODE='42501';
  END IF;
  IF i.status<>'ready' OR i.expires_at<=now() THEN
    RAISE EXCEPTION 'Cette interview n''est plus disponible.' USING ERRCODE='P0002';
  END IF;
  IF jsonb_typeof(p_answers)<>'array' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('question_id',q->>'id',
      'texte',coalesce(left(btrim((SELECT a->>'texte' FROM jsonb_array_elements(p_answers) a
        WHERE a->>'question_id'=q->>'id' LIMIT 1)),1000),'')) ORDER BY n),'[]'::jsonb)
    INTO cleaned FROM jsonb_array_elements(i.questions) WITH ORDINALITY x(q,n);
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(cleaned) a WHERE a->>'texte'<>'') THEN
    RAISE EXCEPTION 'Réponds au moins à une question.' USING ERRCODE='22023';
  END IF;
  UPDATE live_interviews SET answers=cleaned,status='published',published_at=now() WHERE id=p_id;
  RETURN jsonb_build_object('status','published');
END $$;
REVOKE ALL ON FUNCTION public.interview_answer(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.interview_answer(uuid,jsonb) TO authenticated;

-- « Pas de commentaire » : rien n'est publié.
CREATE FUNCTION public.interview_decline(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE live_interviews SET status='declined'
    WHERE id=p_id AND member_id=auth.uid() AND status IN ('pending','ready');
  IF NOT FOUND THEN RAISE EXCEPTION 'Cette interview n''est plus disponible.' USING ERRCODE='P0002'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.interview_decline(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.interview_decline(uuid) TO authenticated;

-- Retrait d'une interview publiée : par le joueur, un admin du club ou le super-admin.
CREATE FUNCTION public.interview_delete(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE i live_interviews;
BEGIN
  SELECT * INTO i FROM live_interviews WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR i.status<>'published' THEN RAISE EXCEPTION 'Interview introuvable.' USING ERRCODE='P0002'; END IF;
  IF NOT (i.member_id=auth.uid() OR is_super_admin() OR EXISTS(SELECT 1 FROM club_members
      WHERE club_id=i.club_id AND user_id=auth.uid() AND role='admin')) THEN
    RAISE EXCEPTION 'Seuls le joueur et les administrateurs du club peuvent retirer cette interview.' USING ERRCODE='42501';
  END IF;
  UPDATE live_interviews SET status='removed' WHERE id=p_id;
END $$;
REVOKE ALL ON FUNCTION public.interview_delete(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.interview_delete(uuid) TO authenticated;

-- Zone mixte d'un live : interviews publiées, questions passées retirées. Lecture publique.
CREATE FUNCTION public.live_match_interviews(p_match uuid,p_club uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',i.id,'side',i.side,'published_at',i.published_at,
   'player',btrim(p.prenom||' '||p.nom),
   'items',(SELECT coalesce(jsonb_agg(jsonb_build_object('question',q->>'texte','answer',a->>'texte') ORDER BY n),'[]'::jsonb)
     FROM jsonb_array_elements(i.questions) WITH ORDINALITY x(q,n)
     JOIN jsonb_array_elements(i.answers) a ON a->>'question_id'=q->>'id' AND a->>'texte'<>''),
   'can_delete',auth.uid() IS NOT NULL AND (i.member_id=auth.uid() OR is_super_admin() OR EXISTS(
     SELECT 1 FROM club_members WHERE club_id=i.club_id AND user_id=auth.uid() AND role='admin')))
   ORDER BY i.side),'[]'::jsonb)
 FROM live_interviews i
 JOIN clubs c ON c.id=i.club_id AND c.status='active'
 JOIN profiles p ON p.id=i.member_id
 WHERE i.live_match_id=p_match AND i.club_id=p_club AND i.status='published'
$$;
REVOKE ALL ON FUNCTION public.live_match_interviews(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.live_match_interviews(uuid,uuid) TO anon,authenticated;

-- Rattrapage : rattache les joueurs des lives déjà terminés (historique et continuité dès la
-- première interview). Aucune demande d'interview n'est créée pour ces matchs.
SELECT public.live_match_resolve_members(id) FROM public.live_matches WHERE status='finished';

COMMIT;
