-- Transactional course email outbox, independent of browser push subscriptions.
BEGIN;
CREATE TABLE public.course_email_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id uuid NOT NULL REFERENCES public.course_registration_events(id) ON DELETE CASCADE,
 club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 title text NOT NULL, body text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed')),
 attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 claim_token uuid, lease_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz,
 UNIQUE(event_id,user_id)
);
CREATE INDEX course_email_ready ON public.course_email_deliveries(next_attempt_at,id)
 WHERE status IN ('pending','sending');
ALTER TABLE public.course_email_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.course_email_deliveries FROM PUBLIC,anon,authenticated;
GRANT SELECT,UPDATE ON public.course_email_deliveries TO service_role;

CREATE FUNCTION public.course_email_enqueue()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE recipient uuid; course_name text; subject text; message text;
BEGIN
 IF new.to_status='pending' AND (new.from_status IS NULL OR new.from_status IN ('cancelled','denied')) THEN
   SELECT c.owner_id,c.name INTO recipient,course_name
   FROM course_registrations r JOIN courses c ON c.id=r.course_id
   WHERE r.id=new.registration_id AND c.club_id=new.club_id;
   subject:='Nouvelle demande de cours';
   message:='Une nouvelle demande a été reçue pour « '||course_name||' ». Connectez-vous à l’application du club pour la traiter.';
 ELSIF new.from_status='pending' AND new.to_status IN ('approved','denied') THEN
   SELECT r.user_id,c.name INTO recipient,course_name
   FROM course_registrations r JOIN courses c ON c.id=r.course_id
   WHERE r.id=new.registration_id AND c.club_id=new.club_id;
   subject:=CASE new.to_status WHEN 'approved' THEN 'Place accordée' ELSE 'Demande de cours refusée' END;
   message:='Votre demande pour « '||course_name||' » a été '
     ||CASE new.to_status WHEN 'approved' THEN 'acceptée. Votre place est confirmée.' ELSE 'refusée.' END
     ||' Connectez-vous à l’application du club pour consulter les détails.';
 ELSE RETURN new;
 END IF;
 IF recipient IS NULL OR course_name IS NULL THEN RETURN new; END IF;
 INSERT INTO course_email_deliveries(event_id,club_id,user_id,title,body)
 SELECT new.id,new.club_id,recipient,subject||' — '||course_name,message
 FROM clubs c JOIN club_members m ON m.club_id=c.id
 WHERE c.id=new.club_id AND c.status='active' AND m.user_id=recipient
 ON CONFLICT(event_id,user_id) DO NOTHING;
 RETURN new;
END $$;
CREATE TRIGGER course_email_event AFTER INSERT ON public.course_registration_events
FOR EACH ROW EXECUTE FUNCTION public.course_email_enqueue();
REVOKE ALL ON FUNCTION public.course_email_enqueue() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.course_email_claim(p_limit integer DEFAULT 10)
RETURNS TABLE(id uuid,claim_token uuid,user_id uuid,title text,body text,attempts integer,club_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 -- Bound retries, including crashed workers, and make expired jobs observable.
 UPDATE course_email_deliveries d SET status='failed',claim_token=NULL,lease_until=NULL
 WHERE (d.status='pending' OR (d.status='sending' AND d.lease_until<now()))
 AND (d.attempts>=5 OR d.created_at<=now()-interval '24 hours'
   OR NOT EXISTS(SELECT 1 FROM clubs c JOIN club_members m ON m.club_id=c.id
     WHERE c.id=d.club_id AND c.status='active' AND m.user_id=d.user_id));
 RETURN QUERY
 WITH picked AS (
   SELECT d.id FROM course_email_deliveries d
   WHERE (d.status='pending' AND d.next_attempt_at<=now())
      OR (d.status='sending' AND d.lease_until<now())
   ORDER BY d.next_attempt_at,d.id FOR UPDATE OF d SKIP LOCKED
   LIMIT least(greatest(p_limit,1),10)
 ), claimed AS (
   UPDATE course_email_deliveries d SET status='sending',attempts=d.attempts+1,
     claim_token=gen_random_uuid(),lease_until=now()+interval '5 minutes'
   FROM picked WHERE d.id=picked.id RETURNING d.*
 )
 SELECT d.id,d.claim_token,d.user_id,d.title,d.body,d.attempts,c.name
 FROM claimed d JOIN clubs c ON c.id=d.club_id;
END $$;
REVOKE ALL ON FUNCTION public.course_email_claim(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.course_email_claim(integer) TO service_role;
COMMIT;
