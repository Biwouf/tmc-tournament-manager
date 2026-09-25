-- Notifications transactionnelles des demandes d’adhésion (sans reprise historique).
BEGIN;
CREATE TABLE public.signup_email_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
 applicant_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('pending','approved','denied')),
 title text NOT NULL, body text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed')),
 attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 claim_token uuid, lease_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz,
 UNIQUE(club_id,applicant_id,kind,user_id)
);
CREATE INDEX signup_email_ready ON public.signup_email_deliveries(next_attempt_at,id)
 WHERE status IN ('pending','sending');
ALTER TABLE public.signup_email_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.signup_email_deliveries FROM PUBLIC,anon,authenticated;
GRANT SELECT,UPDATE ON public.signup_email_deliveries TO service_role;

CREATE FUNCTION public.signup_email_enqueue()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE applicant_name text; club_name text;
BEGIN
 SELECT name INTO club_name FROM clubs WHERE id=NEW.club_id AND status='active';
 IF NOT FOUND THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'pending' THEN RETURN NEW; END IF;
  SELECT nullif(btrim(concat_ws(' ',prenom,nom)),'') INTO applicant_name FROM profiles WHERE id=NEW.user_id;
  INSERT INTO signup_email_deliveries(club_id,applicant_id,user_id,kind,title,body)
  SELECT NEW.club_id,NEW.user_id,m.user_id,'pending','Nouvelle demande d’inscription — '||club_name,
   coalesce(applicant_name,'Un nouveau membre')||' a soumis une demande d’inscription au club « '||club_name
   ||' ». Connectez-vous à l’administration du club pour accepter ou refuser cette demande.'
  FROM club_members m WHERE m.club_id=NEW.club_id AND m.role='admin'
  ON CONFLICT(club_id,applicant_id,kind,user_id) DO NOTHING;
 ELSIF OLD.status='pending' AND NEW.status IN ('approved','denied') THEN
  INSERT INTO signup_email_deliveries(club_id,applicant_id,user_id,kind,title,body)
  VALUES(NEW.club_id,NEW.user_id,NEW.user_id,NEW.status,
   CASE NEW.status WHEN 'approved' THEN 'Inscription validée' ELSE 'Inscription refusée' END||' — '||club_name,
   CASE NEW.status WHEN 'approved' THEN
    'Votre demande d’inscription au club « '||club_name||' » a été acceptée. Votre compte membre est maintenant actif. Connectez-vous à l’application du club pour accéder aux services.'
   ELSE 'Votre demande d’inscription au club « '||club_name||' » a été refusée. Vous pouvez contacter le club pour obtenir davantage d’informations.' END)
  ON CONFLICT(club_id,applicant_id,kind,user_id) DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signup_email_event AFTER INSERT OR UPDATE OF status ON public.club_signup_requests
FOR EACH ROW EXECUTE FUNCTION public.signup_email_enqueue();
REVOKE ALL ON FUNCTION public.signup_email_enqueue() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.signup_email_claim(p_limit integer DEFAULT 10)
RETURNS TABLE(id uuid,claim_token uuid,user_id uuid,title text,body text,attempts integer,club_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 -- Bound retries, including crashed workers, and make expired jobs observable.
 UPDATE signup_email_deliveries d SET status='failed',claim_token=NULL,lease_until=NULL
 WHERE (d.status='pending' OR (d.status='sending' AND d.lease_until<now()))
 AND (d.attempts>=5 OR d.created_at<=now()-interval '24 hours'
   OR NOT EXISTS(SELECT 1 FROM clubs c WHERE c.id=d.club_id AND c.status='active')
   OR (d.kind='pending' AND NOT EXISTS(SELECT 1 FROM club_members m
     WHERE m.club_id=d.club_id AND m.user_id=d.user_id AND m.role='admin'))
   OR NOT EXISTS(SELECT 1 FROM club_signup_requests r
     WHERE r.club_id=d.club_id AND r.user_id=d.applicant_id AND r.status=d.kind));
 RETURN QUERY
 WITH picked AS (
   SELECT d.id FROM signup_email_deliveries d
   WHERE (d.status='pending' AND d.next_attempt_at<=now())
      OR (d.status='sending' AND d.lease_until<now())
   ORDER BY d.next_attempt_at,d.id FOR UPDATE OF d SKIP LOCKED
   LIMIT least(greatest(p_limit,1),10)
 ), claimed AS (
   UPDATE signup_email_deliveries d SET status='sending',attempts=d.attempts+1,
     claim_token=gen_random_uuid(),lease_until=now()+interval '5 minutes'
   FROM picked WHERE d.id=picked.id RETURNING d.*
 )
 SELECT d.id,d.claim_token,d.user_id,d.title,d.body,d.attempts,c.name
 FROM claimed d JOIN clubs c ON c.id=d.club_id;
END $$;
REVOKE ALL ON FUNCTION public.signup_email_claim(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.signup_email_claim(integer) TO service_role;
COMMIT;
