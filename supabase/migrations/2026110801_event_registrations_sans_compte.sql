-- Inscriptions aux événements : groupes saisis par un admin pour des personnes sans compte.
-- - Une réservation peut n'avoir aucun titulaire (owner_id NULL) : créée par un admin,
--   elle contient des personnes sans compte (prénom + nom) et éventuellement des membres avec compte.
-- Seul un admin crée une réservation sans titulaire ; une personne sans compte ne peut pas
-- s'inscrire elle-même (il faut être connecté et membre).
BEGIN;

ALTER TABLE public.event_bookings ALTER COLUMN owner_id DROP NOT NULL;

-- Titulaire en tête : la comparaison à un owner_id NULL ne doit pas faire passer les
-- personnes sans compte devant les membres.
CREATE OR REPLACE FUNCTION public.event_booking_participants(p_booking uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',ep.id,'user_id',ep.user_id,'is_guest',ep.user_id IS NULL,
   'prenom',coalesce(ep.guest_prenom,p.prenom,''),'nom',coalesce(ep.guest_nom,p.nom,''))
  ORDER BY NOT coalesce(ep.user_id=b.owner_id,false), ep.user_id IS NULL,
   coalesce(ep.guest_nom,p.nom), coalesce(ep.guest_prenom,p.prenom), ep.id),'[]'::jsonb)
 FROM event_participants ep JOIN event_bookings b ON b.id=ep.booking_id
 LEFT JOIN profiles p ON p.id=ep.user_id WHERE ep.booking_id=p_booking
$$;

-- p_owner NULL (admin) : nouvelle réservation sans titulaire, jamais fusionnée.
CREATE OR REPLACE FUNCTION public.event_booking_write(p_event public.events, p_owner uuid, p_members uuid[], p_guests jsonb, p_admin boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b event_bookings; members uuid[]; everyone uuid[]; total integer; others integer; g jsonb; taken text;
BEGIN
 IF p_owner IS NULL AND NOT p_admin THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 members := ARRAY(SELECT DISTINCT m FROM unnest(coalesce(p_members,'{}'::uuid[])) m
  WHERE m IS NOT NULL AND m IS DISTINCT FROM p_owner);
 everyone := CASE WHEN p_owner IS NULL THEN members ELSE p_owner || members END;
 p_guests := coalesce(p_guests,'[]'::jsonb);
 IF jsonb_typeof(p_guests)<>'array' OR jsonb_array_length(p_guests)>50 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 FOR g IN SELECT value FROM jsonb_array_elements(p_guests) LOOP
  IF jsonb_typeof(g)<>'object'
    OR coalesce(length(btrim(g->>'prenom')),0) NOT BETWEEN 1 AND 100
    OR coalesce(length(btrim(g->>'nom')),0) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 END LOOP;
 total := cardinality(everyone) + jsonb_array_length(p_guests);
 IF total=0 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(everyone) u WHERE NOT EXISTS(
   SELECT 1 FROM club_members cm WHERE cm.club_id=p_event.club_id AND cm.user_id=u)) THEN RAISE EXCEPTION 'NOT_MEMBER'; END IF;
 IF NOT p_admin AND total > p_event.registration_max_per_member THEN RAISE EXCEPTION 'QUOTA_EXCEEDED'; END IF;
 IF p_owner IS NOT NULL THEN
  SELECT * INTO b FROM event_bookings WHERE event_id=p_event.id AND owner_id=p_owner;
 END IF;
 SELECT string_agg(btrim(coalesce(p.prenom,'')||' '||coalesce(p.nom,'')),', ') INTO taken
  FROM event_participants ep LEFT JOIN profiles p ON p.id=ep.user_id
  WHERE ep.event_id=p_event.id AND ep.user_id=ANY(everyone) AND ep.booking_id IS DISTINCT FROM b.id;
 IF taken IS NOT NULL THEN RAISE EXCEPTION 'ALREADY_REGISTERED' USING DETAIL=taken; END IF;
 SELECT count(*) INTO others FROM event_participants WHERE event_id=p_event.id AND booking_id IS DISTINCT FROM b.id;
 IF p_event.registration_capacity IS NOT NULL AND others+total>p_event.registration_capacity THEN RAISE EXCEPTION 'EVENT_FULL'; END IF;
 IF b.id IS NULL THEN
  INSERT INTO event_bookings(club_id,event_id,owner_id,created_by)
   VALUES(p_event.club_id,p_event.id,p_owner,auth.uid()) RETURNING * INTO b;
 ELSE
  UPDATE event_bookings SET updated_at=clock_timestamp() WHERE id=b.id;
 END IF;
 DELETE FROM event_participants WHERE booking_id=b.id AND (user_id IS NULL OR NOT user_id=ANY(everyone));
 INSERT INTO event_participants(club_id,event_id,booking_id,user_id)
  SELECT p_event.club_id,p_event.id,b.id,u FROM unnest(everyone) u
  ON CONFLICT (event_id,user_id) DO NOTHING;
 INSERT INTO event_participants(club_id,event_id,booking_id,guest_prenom,guest_nom)
  SELECT p_event.club_id,p_event.id,b.id,btrim(value->>'prenom'),btrim(value->>'nom') FROM jsonb_array_elements(p_guests);
 RETURN jsonb_build_object('booking_id',b.id,'places',total);
END $$;

-- Réservation sans titulaire : un membre avec compte qui y figure voit « inscrit par le club »
-- (owner_name NULL).
CREATE OR REPLACE FUNCTION public.event_registration_state(p_club uuid, p_event uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE e events; taken integer; b event_bookings; booking jsonb;
BEGIN
 SELECT ev.* INTO e FROM events ev JOIN clubs c ON c.id=ev.club_id
  WHERE ev.id=p_event AND ev.club_id=p_club AND c.status='active';
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 SELECT count(*) INTO taken FROM event_participants WHERE event_id=e.id;
 IF auth.uid() IS NOT NULL THEN
  SELECT bk.* INTO b FROM event_participants ep JOIN event_bookings bk ON bk.id=ep.booking_id
   WHERE ep.event_id=e.id AND ep.user_id=auth.uid();
  IF FOUND THEN
   IF b.owner_id=auth.uid() THEN
    booking := jsonb_build_object('id',b.id,'is_owner',true,'participants',event_booking_participants(b.id));
   ELSE
    booking := jsonb_build_object('id',b.id,'is_owner',false,'owner_name',
     (SELECT btrim(prenom||' '||nom) FROM profiles WHERE id=b.owner_id));
   END IF;
  END IF;
 END IF;
 RETURN jsonb_build_object(
  'enabled',e.registration_enabled,'open',event_registration_open(e),
  'closes_at',coalesce(e.registration_deadline,e.date_debut),
  'capacity',e.registration_capacity,'taken',taken,
  'max_per_member',e.registration_max_per_member,
  'is_member',event_is_member(p_club),'is_admin',event_is_admin(p_club),'booking',booking);
END $$;

-- Le dernier participant d'une réservation sans titulaire qui se retire la supprime.
CREATE OR REPLACE FUNCTION public.event_member_cancel(p_club uuid, p_event uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e events; ep event_participants; b event_bookings;
BEGIN
 IF NOT event_is_member(p_club) THEN RAISE EXCEPTION 'NOT_MEMBER'; END IF;
 SELECT * INTO e FROM events WHERE id=p_event AND club_id=p_club FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF NOT event_registration_open(e) THEN RAISE EXCEPTION 'REGISTRATION_CLOSED'; END IF;
 SELECT * INTO ep FROM event_participants WHERE event_id=e.id AND user_id=auth.uid();
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_REGISTERED'; END IF;
 SELECT * INTO b FROM event_bookings WHERE id=ep.booking_id;
 IF b.owner_id=auth.uid() THEN
  DELETE FROM event_bookings WHERE id=b.id;
  RETURN jsonb_build_object('cancelled','booking');
 END IF;
 DELETE FROM event_participants WHERE id=ep.id;
 DELETE FROM event_bookings WHERE id=b.id AND NOT EXISTS(SELECT 1 FROM event_participants WHERE booking_id=b.id);
 RETURN jsonb_build_object('cancelled','self');
END $$;

-- Admin : p_owner NULL → nouvelle réservation sans titulaire (personnes nommées et/ou membres).
CREATE OR REPLACE FUNCTION public.event_admin_add(p_club uuid, p_event uuid, p_owner uuid, p_members uuid[], p_guests jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e events; current_members uuid[]; current_guests jsonb;
BEGIN
 IF NOT event_is_admin(p_club) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT * INTO e FROM events WHERE id=p_event AND club_id=p_club FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF p_guests IS NOT NULL AND jsonb_typeof(p_guests)<>'array' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 IF p_owner IS NULL THEN
  RETURN event_booking_write(e, NULL, p_members, p_guests, true);
 END IF;
 SELECT coalesce(array_agg(ep.user_id) FILTER (WHERE ep.user_id IS NOT NULL),'{}'),
        coalesce(jsonb_agg(jsonb_build_object('prenom',ep.guest_prenom,'nom',ep.guest_nom)) FILTER (WHERE ep.user_id IS NULL),'[]')
  INTO current_members, current_guests
  FROM event_participants ep JOIN event_bookings b ON b.id=ep.booking_id
  WHERE b.event_id=e.id AND b.owner_id=p_owner;
 RETURN event_booking_write(e, p_owner, current_members || coalesce(p_members,'{}'::uuid[]),
  current_guests || coalesce(p_guests,'[]'::jsonb), true);
END $$;

-- Admin : retirer le dernier participant d'une réservation (sans titulaire) la supprime aussi.
CREATE OR REPLACE FUNCTION public.event_admin_remove(p_club uuid, p_participant uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ep event_participants; b event_bookings;
BEGIN
 IF NOT event_is_admin(p_club) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT * INTO ep FROM event_participants WHERE id=p_participant AND club_id=p_club;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 PERFORM 1 FROM events WHERE id=ep.event_id FOR UPDATE;
 SELECT * INTO b FROM event_bookings WHERE id=ep.booking_id;
 IF ep.user_id=b.owner_id OR NOT EXISTS(
   SELECT 1 FROM event_participants WHERE booking_id=b.id AND id<>ep.id) THEN
  DELETE FROM event_bookings WHERE id=b.id;
  RETURN jsonb_build_object('removed','booking');
 END IF;
 DELETE FROM event_participants WHERE id=ep.id;
 RETURN jsonb_build_object('removed','participant');
END $$;

COMMIT;
