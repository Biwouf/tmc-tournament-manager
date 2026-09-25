-- Web Push for course requests. A delivery is created only for a device that opted in
-- before the event, and only after the course command has committed successfully.
BEGIN;

CREATE TABLE public.course_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE CHECK (length(endpoint) BETWEEN 20 AND 2048),
  p256dh text NOT NULL CHECK (length(p256dh) BETWEEN 20 AND 256),
  auth_secret text NOT NULL CHECK (length(auth_secret) BETWEEN 10 AND 256),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX course_push_subscriptions_recipient ON public.course_push_subscriptions(club_id,user_id);
ALTER TABLE public.course_push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.course_push_subscriptions FROM PUBLIC,anon,authenticated;

CREATE TABLE public.course_push_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.course_registration_events(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES public.course_push_subscriptions(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  url text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claim_token uuid,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE(event_id,subscription_id)
);
CREATE INDEX course_push_deliveries_ready ON public.course_push_deliveries(next_attempt_at,id)
  WHERE status IN ('pending','sending');
ALTER TABLE public.course_push_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.course_push_deliveries FROM PUBLIC,anon,authenticated;

-- The endpoint is a capability URL. Never expose it through the Data API.
CREATE FUNCTION public.course_push_subscribe(p_club uuid,p_endpoint text,p_p256dh text,p_auth text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.course_is_member(p_club) THEN RAISE EXCEPTION 'NOT_MEMBER'; END IF;
  IF p_endpoint IS NULL OR length(p_endpoint) NOT BETWEEN 20 AND 2048
     OR p_endpoint !~ '^https://[^/]+/'
     OR p_p256dh IS NULL OR length(p_p256dh) NOT BETWEEN 20 AND 256
     OR p_auth IS NULL OR length(p_auth) NOT BETWEEN 10 AND 256 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_endpoint,0));
  -- A device may change account or club. Remove the old user's queued messages.
  DELETE FROM course_push_subscriptions WHERE endpoint=p_endpoint
    AND (user_id<>auth.uid() OR club_id<>p_club);
  INSERT INTO course_push_subscriptions(club_id,user_id,endpoint,p256dh,auth_secret)
    VALUES(p_club,auth.uid(),p_endpoint,p_p256dh,p_auth)
    ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh,
      auth_secret=excluded.auth_secret,updated_at=now();
END $$;
CREATE FUNCTION public.course_push_unsubscribe(p_club uuid,p_endpoint text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  DELETE FROM course_push_subscriptions
   WHERE club_id=p_club AND user_id=auth.uid() AND endpoint=p_endpoint
$$;
REVOKE ALL ON FUNCTION public.course_push_subscribe(uuid,text,text,text),
  public.course_push_unsubscribe(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.course_push_subscribe(uuid,text,text,text),
  public.course_push_unsubscribe(uuid,text) TO authenticated;

CREATE FUNCTION public.course_push_on_membership_deleted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  DELETE FROM course_push_subscriptions WHERE club_id=old.club_id AND user_id=old.user_id;
  RETURN old;
END $$;
CREATE TRIGGER course_push_membership_deleted AFTER DELETE ON public.club_members
FOR EACH ROW EXECUTE FUNCTION public.course_push_on_membership_deleted();
REVOKE ALL ON FUNCTION public.course_push_on_membership_deleted() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.course_push_enqueue()
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
    WHERE s.club_id=new.club_id AND s.user_id=recipient AND club.status='active'
    ON CONFLICT(event_id,subscription_id) DO NOTHING;
  RETURN new;
END $$;
CREATE TRIGGER course_push_event AFTER INSERT ON public.course_registration_events
FOR EACH ROW EXECUTE FUNCTION public.course_push_enqueue();
REVOKE ALL ON FUNCTION public.course_push_enqueue() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.course_push_claim(p_limit integer DEFAULT 30)
RETURNS TABLE(id uuid,claim_token uuid,subscription_id uuid,endpoint text,p256dh text,
  auth_secret text,title text,body text,url text,attempts integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR';
  END IF;
  -- Release exhausted or expired work, including workers interrupted on attempt five.
  UPDATE course_push_deliveries d SET status='failed',claim_token=NULL,lease_until=NULL
    WHERE (d.status='pending' OR (d.status='sending' AND d.lease_until<now()))
      AND (d.created_at<=now()-interval '24 hours' OR d.attempts>=5);
  RETURN QUERY
  WITH picked AS (
    SELECT d.id FROM course_push_deliveries d
      JOIN course_push_subscriptions s ON s.id=d.subscription_id
      JOIN clubs c ON c.id=s.club_id AND c.status='active'
      JOIN club_members m ON m.club_id=s.club_id AND m.user_id=s.user_id
    WHERE ((d.status='pending' AND d.next_attempt_at<=now())
      OR (d.status='sending' AND d.lease_until<now()))
      AND d.created_at>now()-interval '24 hours' AND d.attempts<5
    ORDER BY d.next_attempt_at,d.id FOR UPDATE OF d SKIP LOCKED
    LIMIT least(greatest(p_limit,1),100)
  ), claimed AS (
    UPDATE course_push_deliveries d SET status='sending',attempts=d.attempts+1,
      claim_token=gen_random_uuid(),lease_until=now()+interval '5 minutes'
    FROM picked WHERE d.id=picked.id RETURNING d.*
  )
  SELECT d.id,d.claim_token,d.subscription_id,s.endpoint,s.p256dh,s.auth_secret,
    d.title,d.body,d.url,d.attempts
  FROM claimed d JOIN course_push_subscriptions s ON s.id=d.subscription_id;
END $$;
REVOKE ALL ON FUNCTION public.course_push_claim(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.course_push_claim(integer) TO service_role;
GRANT SELECT,UPDATE,DELETE ON public.course_push_deliveries,
  public.course_push_subscriptions TO service_role;

COMMIT;
