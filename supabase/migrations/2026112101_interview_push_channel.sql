-- Canal de notification « Interviews » (docs/specs/INTERVIEWS.md) :
--   - préférence d'appareil notify_interviews, vraie par défaut (appareils existants compris : un
--     appareil n'est abonné que si les notifications sont autorisées au niveau du système) ;
--   - push_subscribe à 8 paramètres (p_interviews) ; l'ancienne signature reste pour les clients
--     en cache et ne touche pas à la nouvelle préférence ;
--   - le push d'interview ne vise plus que les appareils où elle est active, et ouvre le live
--     (/matches/<id>, accepté par tous les service workers déjà installés) plutôt que
--     /interviews/<id>, qu'un service worker pas encore mis à jour renverrait vers /cours.
BEGIN;

ALTER TABLE public.course_push_subscriptions
  ADD COLUMN notify_interviews boolean NOT NULL DEFAULT true;

CREATE FUNCTION public.push_subscribe(p_club uuid,p_endpoint text,p_p256dh text,p_auth text,
  p_courses boolean,p_live boolean,p_news boolean,p_interviews boolean)
RETURNS TABLE(notify_courses boolean,notify_live boolean,notify_news boolean,notify_interviews boolean)
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
      notify_courses,notify_live,notify_news,notify_interviews)
    VALUES(p_club,auth.uid(),p_endpoint,p_p256dh,p_auth,coalesce(p_courses,false),coalesce(p_live,false),
      coalesce(p_news,true),coalesce(p_interviews,true))
    ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh,auth_secret=excluded.auth_secret,
      notify_courses=coalesce(p_courses,s.notify_courses),notify_live=coalesce(p_live,s.notify_live),
      notify_news=coalesce(p_news,s.notify_news),notify_interviews=coalesce(p_interviews,s.notify_interviews),
      updated_at=now()
    RETURNING s.notify_courses,s.notify_live,s.notify_news,s.notify_interviews;
END $$;
REVOKE ALL ON FUNCTION public.push_subscribe(uuid,text,text,text,boolean,boolean,boolean,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.push_subscribe(uuid,text,text,text,boolean,boolean,boolean,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.live_interviews_on_finish() RETURNS trigger
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
          '/matches/'||NEW.id
        FROM course_push_subscriptions s
        WHERE s.club_id=NEW.club_id AND s.user_id=r.member_id AND s.notify_interviews
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

COMMIT;
