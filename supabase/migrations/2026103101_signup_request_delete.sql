-- Suppression définitive d'une demande refusée ou retirée, pour alléger la vue Membres.
-- Ne touche ni au compte Auth (partagé entre clubs) ni à club_members : la personne
-- pourra redéposer une demande, qui repartira comme une première demande.
BEGIN;
CREATE FUNCTION public.club_signup_delete(p_club uuid,p_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE current_status text;
BEGIN
 IF NOT course_is_admin(p_club) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 PERFORM 1 FROM clubs WHERE id=p_club FOR UPDATE;
 IF NOT course_is_admin(p_club) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT status INTO current_status FROM club_signup_requests WHERE club_id=p_club AND user_id=p_user FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 IF current_status NOT IN ('denied','revoked') THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
 DELETE FROM club_signup_requests WHERE club_id=p_club AND user_id=p_user;
 -- Sinon l'unicité (club, demandeur, type, destinataire) bloquerait les mails d'une nouvelle demande.
 DELETE FROM signup_email_deliveries WHERE club_id=p_club AND applicant_id=p_user;
END $$;
REVOKE ALL ON FUNCTION public.club_signup_delete(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.club_signup_delete(uuid,uuid) TO authenticated;
COMMIT;
