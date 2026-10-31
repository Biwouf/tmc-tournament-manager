-- Web Push des actus et événements : à la publication d'une actu ou à la création d'un événement,
-- l'admin peut prévenir les appareils du club dont la préférence « Actus et événements » est active.
-- Réutilise l'abonnement d'appareil, le réveil pg_net et la fonction course-push-dispatch.
BEGIN;

-- Active d'office, pour les appareils existants comme pour les nouveaux.
ALTER TABLE public.course_push_subscriptions
  ADD COLUMN notify_news boolean NOT NULL DEFAULT true;

-- Abonnement avec les trois préférences. NULL conserve la préférence existante ; à la création,
-- Cours et Live sont fausses et Actus vraie. L'ancienne signature reste pour les clients en cache.
CREATE FUNCTION public.push_subscribe(p_club uuid,p_endpoint text,p_p256dh text,p_auth text,
  p_courses boolean,p_live boolean,p_news boolean)
RETURNS TABLE(notify_courses boolean,notify_live boolean,notify_news boolean)
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
      notify_courses,notify_live,notify_news)
    VALUES(p_club,auth.uid(),p_endpoint,p_p256dh,p_auth,coalesce(p_courses,false),coalesce(p_live,false),
      coalesce(p_news,true))
    ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh,auth_secret=excluded.auth_secret,
      notify_courses=coalesce(p_courses,s.notify_courses),notify_live=coalesce(p_live,s.notify_live),
      notify_news=coalesce(p_news,s.notify_news),updated_at=now()
    RETURNING s.notify_courses,s.notify_live,s.notify_news;
END $$;
REVOKE ALL ON FUNCTION public.push_subscribe(uuid,text,text,text,boolean,boolean,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.push_subscribe(uuid,text,text,text,boolean,boolean,boolean) TO authenticated;

CREATE TABLE public.content_push_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('actu','event')),
  -- Pas de clé étrangère : actus et événements vivent dans deux tables.
  content_id uuid NOT NULL,
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
  UNIQUE(subscription_id,kind,content_id)
);
CREATE INDEX content_push_deliveries_ready ON public.content_push_deliveries(next_attempt_at,id)
  WHERE status IN ('pending','sending');
CREATE INDEX content_push_deliveries_content ON public.content_push_deliveries(kind,content_id);
CREATE INDEX content_push_deliveries_created ON public.content_push_deliveries(created_at);
ALTER TABLE public.content_push_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.content_push_deliveries FROM PUBLIC,anon,authenticated;
GRANT SELECT,UPDATE,DELETE ON public.content_push_deliveries TO service_role;

-- Annonce demandée par l'admin qui vient de publier l'actu ou de créer l'événement.
-- Une seule par contenu ; une actu doit être publiée. Renvoie le nombre d'appareils prévenus.
CREATE FUNCTION public.content_push_announce(p_club uuid,p_kind text,p_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE content_title text; notification_title text; notification_body text; destination text; n integer;
BEGIN
  IF NOT can_manage_club_content(p_club) THEN
    RAISE EXCEPTION 'Seuls les gestionnaires du club peuvent envoyer cette notification.' USING ERRCODE='42501';
  END IF;
  IF p_kind='actu' THEN
    SELECT a.titre INTO content_title FROM actus a WHERE a.id=p_id AND a.club_id=p_club AND a.published;
    notification_title:='Nouvelle actu';
    notification_body:=left(btrim(content_title),150);
    destination:='/actus/'||p_id;
  ELSIF p_kind='event' THEN
    SELECT e.titre,left(btrim(e.titre),120)||' · '
        ||to_char(e.date_debut AT TIME ZONE 'Europe/Paris','DD/MM "à" HH24"h"MI')
      INTO content_title,notification_body
      FROM events e WHERE e.id=p_id AND e.club_id=p_club;
    notification_title:='Nouvel événement';
    destination:='/evenements/'||p_id;
  ELSE
    RAISE EXCEPTION 'VALIDATION_ERROR';
  END IF;
  IF content_title IS NULL THEN RAISE EXCEPTION 'Contenu introuvable.' USING ERRCODE='P0002'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('content-push:'||p_kind||':'||p_id,0));
  IF EXISTS(SELECT 1 FROM content_push_deliveries WHERE kind=p_kind AND content_id=p_id) THEN RETURN 0; END IF;
  INSERT INTO content_push_deliveries(kind,content_id,subscription_id,title,body,url)
    SELECT p_kind,p_id,s.id,notification_title,notification_body,destination
    FROM course_push_subscriptions s
    JOIN clubs c ON c.id=s.club_id AND c.status='active'
    JOIN club_members cm ON cm.club_id=s.club_id AND cm.user_id=s.user_id
    WHERE s.club_id=p_club AND s.notify_news AND s.user_id<>auth.uid()
    ON CONFLICT(subscription_id,kind,content_id) DO NOTHING;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n>0 THEN PERFORM live_push_kick(); END IF;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.content_push_announce(uuid,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.content_push_announce(uuid,text,uuid) TO authenticated;

-- Réclamation. Une annonce de plus de 24 h n'est plus envoyée.
CREATE FUNCTION public.content_push_claim(p_limit integer DEFAULT 100)
RETURNS TABLE(id uuid,claim_token uuid,subscription_id uuid,endpoint text,p256dh text,
  auth_secret text,title text,body text,url text,tag text,ttl integer,attempts integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
#variable_conflict use_column
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR';
  END IF;
  DELETE FROM content_push_deliveries d WHERE d.created_at<now()-interval '7 days'
    AND d.status IN ('sent','failed');
  UPDATE content_push_deliveries d SET status='failed',claim_token=NULL,lease_until=NULL
    WHERE (d.status='pending' OR (d.status='sending' AND d.lease_until<now()))
      AND (d.created_at<=now()-interval '24 hours' OR d.attempts>=5);
  RETURN QUERY
  WITH picked AS (
    SELECT d.id FROM content_push_deliveries d
      JOIN course_push_subscriptions s ON s.id=d.subscription_id
      JOIN clubs c ON c.id=s.club_id AND c.status='active'
      JOIN club_members m ON m.club_id=s.club_id AND m.user_id=s.user_id
    WHERE ((d.status='pending' AND d.next_attempt_at<=now())
      OR (d.status='sending' AND d.lease_until<now()))
      AND d.created_at>now()-interval '24 hours' AND d.attempts<5
    ORDER BY d.next_attempt_at,d.id FOR UPDATE OF d SKIP LOCKED
    LIMIT p_limit
  ), claimed AS (
    UPDATE content_push_deliveries d SET status='sending',attempts=d.attempts+1,
      claim_token=gen_random_uuid(),lease_until=now()+interval '5 minutes'
    FROM picked WHERE d.id=picked.id RETURNING d.*
  )
  SELECT d.id,d.claim_token,d.subscription_id,s.endpoint,s.p256dh,s.auth_secret,
    d.title,d.body,d.url,d.kind||'-'||d.content_id,86400,d.attempts
  FROM claimed d JOIN course_push_subscriptions s ON s.id=d.subscription_id;
END $$;
REVOKE ALL ON FUNCTION public.content_push_claim(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.content_push_claim(integer) TO service_role;

COMMIT;
