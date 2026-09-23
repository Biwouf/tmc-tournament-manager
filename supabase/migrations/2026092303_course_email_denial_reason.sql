-- Include the refusal reason from the decision event in the applicant email.
BEGIN;
CREATE OR REPLACE FUNCTION public.course_email_enqueue()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE recipient uuid; course_name text; subject text; message text; requester_name text;
BEGIN
 IF new.to_status='pending' AND (new.from_status IS NULL OR new.from_status IN ('cancelled','denied')) THEN
   SELECT c.owner_id,c.name,
     coalesce(nullif(btrim(concat_ws(' ',nullif(btrim(p.prenom),''),nullif(btrim(p.nom),''))),''),'Un membre')
   INTO recipient,course_name,requester_name
   FROM course_registrations r JOIN courses c ON c.id=r.course_id
   LEFT JOIN profiles p ON p.id=r.user_id
   WHERE r.id=new.registration_id AND c.club_id=new.club_id;
   subject:='Nouvelle demande de cours';
   message:=requester_name||' a demandé une place pour le cours « '||course_name||' ». Connectez-vous à l’application du club pour la traiter.';
 ELSIF new.from_status='pending' AND new.to_status IN ('approved','denied') THEN
   SELECT r.user_id,c.name INTO recipient,course_name
   FROM course_registrations r JOIN courses c ON c.id=r.course_id
   WHERE r.id=new.registration_id AND c.club_id=new.club_id;
   subject:=CASE new.to_status WHEN 'approved' THEN 'Place accordée' ELSE 'Demande de cours refusée' END;
   message:='Votre demande pour « '||course_name||' » a été '
     ||CASE new.to_status WHEN 'approved' THEN 'acceptée. Votre place est confirmée.' ELSE 'refusée.' END
     ||CASE WHEN new.to_status='denied' AND nullif(btrim(new.denial_reason),'') IS NOT NULL
       THEN E'\n\nMotif du refus : '||btrim(new.denial_reason) ELSE '' END
     ||E'\n\nConnectez-vous à l’application du club pour consulter les détails.';
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
COMMIT;
