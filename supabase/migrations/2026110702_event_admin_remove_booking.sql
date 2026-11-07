-- Inscriptions aux événements : suppression d'un groupe (réservation entière) par un admin.
-- Séparée de 2026110701, déjà appliquée sans cette fonction.
BEGIN;

-- Admin : supprime une réservation entière (titulaire + toutes ses places).
CREATE FUNCTION public.event_admin_remove_booking(p_club uuid, p_booking uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b event_bookings; places integer;
BEGIN
 IF NOT event_is_admin(p_club) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT * INTO b FROM event_bookings WHERE id=p_booking AND club_id=p_club;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 PERFORM 1 FROM events WHERE id=b.event_id FOR UPDATE;
 SELECT count(*) INTO places FROM event_participants WHERE booking_id=b.id;
 DELETE FROM event_bookings WHERE id=b.id;
 RETURN jsonb_build_object('removed','booking','places',places);
END $$;

REVOKE ALL ON FUNCTION public.event_admin_remove_booking(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_admin_remove_booking(uuid,uuid) TO authenticated;

COMMIT;
