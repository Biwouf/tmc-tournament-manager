-- Web Push du Live : alerte de début de match (au choix de la personne qui démarre, vers les
-- abonnés « Live » du club), et pour les membres qui suivent un match : fins de set, fin de match
-- et publications du fil. Réutilise l'abonnement d'appareil des cours (préférences par catégorie)
-- et la fonction course-push-dispatch. Aucune écriture de score ne peut échouer à cause du push.
BEGIN;

-- Préférences par appareil. Les abonnements existants restent abonnés aux cours.
ALTER TABLE public.course_push_subscriptions
  ADD COLUMN notify_courses boolean NOT NULL DEFAULT true,
  ADD COLUMN notify_live boolean NOT NULL DEFAULT false;

-- Abonnement avec préférences explicites. NULL conserve la préférence existante (false à la création).
CREATE FUNCTION public.push_subscribe(p_club uuid,p_endpoint text,p_p256dh text,p_auth text,
  p_courses boolean,p_live boolean)
RETURNS TABLE(notify_courses boolean,notify_live boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.course_is_member(p_club) THEN RAISE EXCEPTION 'NOT_MEMBER'; END IF;
  IF p_endpoint IS NULL OR length(p_endpoint) NOT BETWEEN 20 AND 2048
     OR p_endpoint !~ '^https://[^/]+/'
     OR p_p256dh IS NULL OR length(p_p256dh) NOT BETWEEN 20 AND 256
     OR p_auth IS NULL OR length(p_auth) NOT BETWEEN 10 AND 256 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_endpoint,0));
  DELETE FROM course_push_subscriptions s WHERE s.endpoint=p_endpoint
    AND (s.user_id<>auth.uid() OR s.club_id<>p_club);
  RETURN QUERY
  INSERT INTO course_push_subscriptions AS s(club_id,user_id,endpoint,p256dh,auth_secret,
      notify_courses,notify_live)
    VALUES(p_club,auth.uid(),p_endpoint,p_p256dh,p_auth,coalesce(p_courses,false),coalesce(p_live,false))
    ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh,auth_secret=excluded.auth_secret,
      notify_courses=coalesce(p_courses,s.notify_courses),notify_live=coalesce(p_live,s.notify_live),
      updated_at=now()
    RETURNING s.notify_courses,s.notify_live;
END $$;
REVOKE ALL ON FUNCTION public.push_subscribe(uuid,text,text,text,boolean,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.push_subscribe(uuid,text,text,text,boolean,boolean) TO authenticated;

-- Les cours ne notifient que les appareils qui ont gardé la préférence « Cours ».
CREATE OR REPLACE FUNCTION public.course_push_enqueue()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE recipient uuid; course_name text; course_id uuid;
  notification_title text; notification_body text; destination text;
BEGIN
  -- An initial or renewed request goes to the course's designated owner.
  -- A decision on a pending request goes to the member. Other transitions are silent.
  IF new.to_status='pending' AND (new.from_status IS NULL OR new.from_status IN ('cancelled','denied')) THEN
    SELECT c.owner_id,c.name,c.id INTO recipient,course_name,course_id
      FROM course_registrations r JOIN courses c ON c.id=r.course_id
      WHERE r.id=new.registration_id AND c.club_id=new.club_id;
    notification_title:='Nouvelle demande de cours';
    notification_body:='Une nouvelle demande a été reçue pour « '||course_name||' ».';
    destination:='/cours?view=manage&course='||course_id;
  ELSIF new.from_status='pending' AND new.to_status IN ('approved','denied') THEN
    SELECT r.user_id,c.name,c.id INTO recipient,course_name,course_id
      FROM course_registrations r JOIN courses c ON c.id=r.course_id
      WHERE r.id=new.registration_id AND c.club_id=new.club_id;
    notification_title:=CASE new.to_status WHEN 'approved' THEN 'Demande de cours approuvée'
      ELSE 'Demande de cours refusée' END;
    notification_body:='Votre demande pour « '||course_name||' » a été '
      ||CASE new.to_status WHEN 'approved' THEN 'approuvée.' ELSE 'refusée.' END;
    destination:='/cours?view=mine&course='||course_id;
  ELSE
    RETURN new;
  END IF;
  IF recipient IS NULL OR course_name IS NULL THEN RETURN new; END IF;
  INSERT INTO course_push_deliveries(event_id,subscription_id,title,body,url)
    SELECT new.id,s.id,notification_title,notification_body,destination
    FROM course_push_subscriptions s JOIN clubs club ON club.id=s.club_id
    JOIN club_members m ON m.club_id=s.club_id AND m.user_id=s.user_id
    WHERE s.club_id=new.club_id AND s.user_id=recipient AND club.status='active' AND s.notify_courses
    ON CONFLICT(event_id,subscription_id) DO NOTHING;
  RETURN new;
END $$;

-- Suivi d'un match par un membre : alertes livrées à tous ses appareils abonnés dans le club.
CREATE TABLE public.live_match_follows (
  match_id uuid NOT NULL REFERENCES public.live_matches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(match_id,user_id)
);
CREATE INDEX live_match_follows_user ON public.live_match_follows(club_id,user_id);
ALTER TABLE public.live_match_follows ENABLE ROW LEVEL SECURITY;
-- Aucune policy ni GRANT : accès uniquement par les RPC ci-dessous.
REVOKE ALL ON public.live_match_follows FROM PUBLIC,anon,authenticated;

CREATE TABLE public.live_push_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.live_matches(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES public.course_push_subscriptions(id) ON DELETE CASCADE,
  -- start, set1, set2, finish : une fois par match, même après correction ; post:<id> pour le fil.
  dedupe_key text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  url text NOT NULL,
  post_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claim_token uuid,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE(subscription_id,match_id,dedupe_key)
);
CREATE INDEX live_push_deliveries_ready ON public.live_push_deliveries(next_attempt_at,id)
  WHERE status IN ('pending','sending');
CREATE INDEX live_push_deliveries_match ON public.live_push_deliveries(match_id,dedupe_key);
CREATE INDEX live_push_deliveries_created ON public.live_push_deliveries(created_at);
ALTER TABLE public.live_push_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.live_push_deliveries FROM PUBLIC,anon,authenticated;
GRANT SELECT,UPDATE,DELETE ON public.live_push_deliveries TO service_role;

-- Nom affiché d'un côté : nom de famille (prénom à défaut), « A / B » en double.
CREATE FUNCTION public.live_push_side(m public.live_matches,side text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE side
    WHEN 'j1' THEN concat_ws(' / ',nullif(coalesce(nullif(btrim(m.j1_nom),''),btrim(m.j1_prenom)),''),
      nullif(coalesce(nullif(btrim(m.j3_nom),''),btrim(m.j3_prenom)),''))
    ELSE concat_ws(' / ',nullif(coalesce(nullif(btrim(m.j2_nom),''),btrim(m.j2_prenom)),''),
      nullif(coalesce(nullif(btrim(m.j4_nom),''),btrim(m.j4_prenom)),'')) END
$$;
-- Score des sets joués, du point de vue d'un côté : « 6-4 7-5 ».
CREATE FUNCTION public.live_push_score(m public.live_matches,side text,last_set integer)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT string_agg(CASE side WHEN 'j1' THEN a||'-'||b ELSE b||'-'||a END,' ' ORDER BY n)
  FROM (VALUES(1,m.set1_j1,m.set1_j2),(2,m.set2_j1,m.set2_j2),(3,m.set3_j1,m.set3_j2)) s(n,a,b)
  WHERE n<=last_set AND a IS NOT NULL AND b IS NOT NULL
$$;

-- Réveille la fonction d'envoi sans attendre le cron. Ne lève jamais : le cron rattrape.
CREATE FUNCTION public.live_push_kick()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF to_regnamespace('net') IS NULL OR to_regclass('vault.decrypted_secrets') IS NULL THEN RETURN; END IF;
  BEGIN
    EXECUTE $q$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name='course_push_project_url') || '/functions/v1/course-push-dispatch',
        headers := jsonb_build_object('Content-Type','application/json',
          'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets
            WHERE name='course_push_service_role_key'),
          'x-course-push-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets
            WHERE name='course_push_cron_secret')),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000)
      WHERE EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='course_push_project_url')$q$;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'live push kick skipped: %', SQLERRM;
  END;
END $$;
REVOKE ALL ON FUNCTION public.live_push_kick() FROM PUBLIC,anon,authenticated;

-- Alerte de livraison à tous les appareils des suiveurs d'un match (sauf l'auteur éventuel).
CREATE FUNCTION public.live_push_to_followers(p_match uuid,p_key text,p_title text,p_body text,p_skip uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE n integer;
BEGIN
  INSERT INTO live_push_deliveries(match_id,subscription_id,dedupe_key,title,body,url)
    SELECT p_match,s.id,p_key,p_title,p_body,'/matches/'||p_match
    FROM live_match_follows f
    JOIN course_push_subscriptions s ON s.club_id=f.club_id AND s.user_id=f.user_id
    JOIN clubs c ON c.id=f.club_id AND c.status='active'
    JOIN club_members cm ON cm.club_id=f.club_id AND cm.user_id=f.user_id
    WHERE f.match_id=p_match AND f.user_id IS DISTINCT FROM p_skip
    ON CONFLICT(subscription_id,match_id,dedupe_key) DO NOTHING;
  GET DIAGNOSTICS n=ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.live_push_to_followers(uuid,text,text,text,uuid) FROM PUBLIC,anon,authenticated;

-- Fin de set / fin de match. Le WHEN du trigger écarte les écritures de score ordinaires.
CREATE FUNCTION public.live_push_on_match()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE n integer:=0; title text; body text; winner_side text; loser_side text; last_set integer;
BEGIN
  IF NEW.status='finished' AND OLD.status<>'finished' THEN
    winner_side:=coalesce(NEW.winner::text,'j1');
    loser_side:=CASE winner_side WHEN 'j1' THEN 'j2' ELSE 'j1' END;
    title:='Match terminé';
    body:=CASE WHEN NEW.winner IS NULL
      THEN live_push_side(NEW,'j1')||' – '||live_push_side(NEW,'j2')||' : '||coalesce(live_push_score(NEW,'j1',3),'')
      ELSE 'Victoire de '||live_push_side(NEW,winner_side)||' face à '||live_push_side(NEW,loser_side)
        ||coalesce(' : '||live_push_score(NEW,winner_side,3),'')
        ||CASE WHEN NEW.retired_player IS NOT NULL THEN ' (abandon)' ELSE '' END END;
    n:=live_push_to_followers(NEW.id,'finish',title,btrim(body),NULL);
  ELSIF NEW.status='live' THEN
    IF OLD.set2_ended_at IS NULL AND NEW.set2_ended_at IS NOT NULL THEN last_set:=2;
    ELSIF OLD.set1_ended_at IS NULL AND NEW.set1_ended_at IS NOT NULL THEN last_set:=1;
    END IF;
    IF last_set IS NOT NULL THEN
      title:='Fin du '||CASE last_set WHEN 1 THEN '1er' ELSE '2e' END||' set';
      body:=live_push_side(NEW,'j1')||' '||coalesce(live_push_score(NEW,'j1',last_set),'')
        ||' '||live_push_side(NEW,'j2');
      n:=live_push_to_followers(NEW.id,'set'||last_set,title,body,NULL);
    END IF;
  END IF;
  IF n>0 THEN PERFORM live_push_kick(); END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.live_push_on_match() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER live_push_match AFTER UPDATE ON public.live_matches
FOR EACH ROW WHEN (
  (NEW.status='finished' AND OLD.status<>'finished')
  OR (OLD.set1_ended_at IS NULL AND NEW.set1_ended_at IS NOT NULL)
  OR (OLD.set2_ended_at IS NULL AND NEW.set2_ended_at IS NOT NULL))
EXECUTE FUNCTION public.live_push_on_match();

-- Publication du fil. Une alerte encore en attente pour cet appareil et ce match est regroupée.
CREATE FUNCTION public.live_push_on_post()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE m live_matches; title text; body text; n integer;
BEGIN
  SELECT * INTO m FROM live_matches WHERE id=NEW.match_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  title:=live_push_side(m,'j1')||' – '||live_push_side(m,'j2');
  body:=CASE NEW.kind
    WHEN 'poll' THEN 'Nouveau sondage : '||left(NEW.body,120)
    WHEN 'photo' THEN NEW.author_name||' a publié une photo'||coalesce(' : '||left(nullif(btrim(NEW.body),''),100),'')
    ELSE NEW.author_name||' : '||left(NEW.body,120) END;
  UPDATE live_push_deliveries d SET post_count=d.post_count+1,
      body=(d.post_count+1)||' nouvelles publications dans le fil'
    FROM live_match_follows f JOIN course_push_subscriptions s ON s.club_id=f.club_id AND s.user_id=f.user_id
    WHERE f.match_id=NEW.match_id AND f.user_id IS DISTINCT FROM NEW.author_id
      AND d.subscription_id=s.id AND d.match_id=NEW.match_id AND d.dedupe_key LIKE 'post:%'
      AND d.status='pending' AND d.attempts=0;
  INSERT INTO live_push_deliveries(match_id,subscription_id,dedupe_key,title,body,url,post_count)
    SELECT NEW.match_id,s.id,'post:'||NEW.id,title,body,'/matches/'||NEW.match_id,1
    FROM live_match_follows f
    JOIN course_push_subscriptions s ON s.club_id=f.club_id AND s.user_id=f.user_id
    JOIN clubs c ON c.id=f.club_id AND c.status='active'
    JOIN club_members cm ON cm.club_id=f.club_id AND cm.user_id=f.user_id
    WHERE f.match_id=NEW.match_id AND f.user_id IS DISTINCT FROM NEW.author_id
      AND NOT EXISTS(SELECT 1 FROM live_push_deliveries d WHERE d.subscription_id=s.id
        AND d.match_id=NEW.match_id AND d.dedupe_key LIKE 'post:%' AND d.status='pending' AND d.attempts=0)
    ON CONFLICT(subscription_id,match_id,dedupe_key) DO NOTHING;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n>0 THEN PERFORM live_push_kick(); END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.live_push_on_post() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER live_push_post AFTER INSERT ON public.live_posts
FOR EACH ROW WHEN (NEW.deleted_at IS NULL) EXECUTE FUNCTION public.live_push_on_post();

-- Alerte de début, demandée par la personne qui vient de démarrer le live. Une seule par match.
CREATE FUNCTION public.live_push_announce_start(p_club uuid,p_match uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE m live_matches; n integer;
BEGIN
  IF NOT live_can_animate(p_club) THEN
    RAISE EXCEPTION 'Seuls les membres de ce club peuvent gérer ce live.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO m FROM live_matches WHERE id=p_match AND club_id=p_club;
  IF NOT FOUND THEN RAISE EXCEPTION 'Match introuvable.' USING ERRCODE='P0002'; END IF;
  -- Une alerte tardive ou sur un match terminé n'aurait plus de sens.
  IF m.status<>'live' OR coalesce(m.started_at,now())<now()-interval '15 minutes' THEN RETURN 0; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('live-push-start:'||p_match,0));
  IF EXISTS(SELECT 1 FROM live_push_deliveries WHERE match_id=p_match AND dedupe_key='start') THEN RETURN 0; END IF;
  INSERT INTO live_push_deliveries(match_id,subscription_id,dedupe_key,title,body,url)
    SELECT p_match,s.id,'start','Match en direct',
      live_push_side(m,'j1')||' – '||live_push_side(m,'j2')||' : le match a commencé'
        ||coalesce(' (court '||nullif(btrim(m.court),'')||')','')||'.',
      '/matches/'||p_match
    FROM course_push_subscriptions s
    JOIN clubs c ON c.id=s.club_id AND c.status='active'
    JOIN club_members cm ON cm.club_id=s.club_id AND cm.user_id=s.user_id
    WHERE s.club_id=p_club AND s.notify_live AND s.user_id<>auth.uid()
    ON CONFLICT(subscription_id,match_id,dedupe_key) DO NOTHING;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n>0 THEN PERFORM live_push_kick(); END IF;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.live_push_announce_start(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.live_push_announce_start(uuid,uuid) TO authenticated;

CREATE FUNCTION public.live_follow(p_club uuid,p_match uuid,p_on boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM club_members cm JOIN clubs c ON c.id=cm.club_id AND c.status='active'
      WHERE cm.club_id=p_club AND cm.user_id=auth.uid()) THEN
    RAISE EXCEPTION 'NOT_MEMBER' USING ERRCODE='42501';
  END IF;
  IF p_on IS NOT TRUE THEN
    DELETE FROM live_match_follows WHERE match_id=p_match AND user_id=auth.uid();
    RETURN false;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM live_matches WHERE id=p_match AND club_id=p_club AND status<>'finished') THEN
    RAISE EXCEPTION 'Ce match ne peut plus être suivi.' USING ERRCODE='P0002';
  END IF;
  INSERT INTO live_match_follows(match_id,user_id,club_id) VALUES(p_match,auth.uid(),p_club)
    ON CONFLICT DO NOTHING;
  RETURN true;
END $$;
CREATE FUNCTION public.live_my_follows(p_club uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT f.match_id FROM live_match_follows f WHERE f.club_id=p_club AND f.user_id=auth.uid()
$$;
REVOKE ALL ON FUNCTION public.live_follow(uuid,uuid,boolean),public.live_my_follows(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.live_follow(uuid,uuid,boolean),public.live_my_follows(uuid) TO authenticated;

-- Un membre retiré ne suit plus rien dans ce club.
CREATE FUNCTION public.live_push_on_membership_deleted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  DELETE FROM live_match_follows WHERE club_id=old.club_id AND user_id=old.user_id;
  RETURN old;
END $$;
CREATE TRIGGER live_push_membership_deleted AFTER DELETE ON public.club_members
FOR EACH ROW EXECUTE FUNCTION public.live_push_on_membership_deleted();
REVOKE ALL ON FUNCTION public.live_push_on_membership_deleted() FROM PUBLIC,anon,authenticated;

-- Réclamation des alertes Live. Une alerte de plus de 30 minutes n'a plus d'intérêt.
CREATE FUNCTION public.live_push_claim(p_limit integer DEFAULT 100)
RETURNS TABLE(id uuid,claim_token uuid,subscription_id uuid,endpoint text,p256dh text,
  auth_secret text,title text,body text,url text,tag text,ttl integer,attempts integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
#variable_conflict use_column
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR';
  END IF;
  DELETE FROM live_push_deliveries d WHERE d.created_at<now()-interval '3 days'
    AND d.status IN ('sent','failed');
  UPDATE live_push_deliveries d SET status='failed',claim_token=NULL,lease_until=NULL
    WHERE (d.status='pending' OR (d.status='sending' AND d.lease_until<now()))
      AND (d.created_at<=now()-interval '30 minutes' OR d.attempts>=5);
  RETURN QUERY
  WITH picked AS (
    SELECT d.id FROM live_push_deliveries d
      JOIN course_push_subscriptions s ON s.id=d.subscription_id
      JOIN clubs c ON c.id=s.club_id AND c.status='active'
      JOIN club_members m ON m.club_id=s.club_id AND m.user_id=s.user_id
    WHERE ((d.status='pending' AND d.next_attempt_at<=now())
      OR (d.status='sending' AND d.lease_until<now()))
      AND d.created_at>now()-interval '30 minutes' AND d.attempts<5
    ORDER BY d.next_attempt_at,d.id FOR UPDATE OF d SKIP LOCKED
    LIMIT p_limit
  ), claimed AS (
    UPDATE live_push_deliveries d SET status='sending',attempts=d.attempts+1,
      claim_token=gen_random_uuid(),lease_until=now()+interval '5 minutes'
    FROM picked WHERE d.id=picked.id RETURNING d.*
  )
  SELECT d.id,d.claim_token,d.subscription_id,s.endpoint,s.p256dh,s.auth_secret,
    d.title,d.body,d.url,
    CASE WHEN d.dedupe_key LIKE 'post:%' THEN 'live-post-'||d.match_id ELSE 'live-'||d.id END,
    CASE WHEN d.dedupe_key LIKE 'post:%' THEN 600 WHEN d.dedupe_key='finish' THEN 3600 ELSE 900 END,
    d.attempts
  FROM claimed d JOIN course_push_subscriptions s ON s.id=d.subscription_id;
END $$;
REVOKE ALL ON FUNCTION public.live_push_claim(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.live_push_claim(integer) TO service_role;

COMMIT;
