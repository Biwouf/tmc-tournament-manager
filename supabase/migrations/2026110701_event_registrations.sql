-- Inscriptions en ligne aux événements. Paiement hors périmètre.
-- Une réservation (event_bookings) appartient à un membre et regroupe ses places
-- (event_participants) : lui-même, d'autres membres inscrits d'office, des invités non membres.
-- Un membre n'occupe qu'une place par événement (UNIQUE event_id,user_id).
-- Tables privées : tout passe par les RPC ci-dessous, qui verrouillent la ligne de l'événement
-- pour sérialiser jauge et quotas.
BEGIN;

ALTER TABLE public.events
 ADD COLUMN registration_enabled boolean NOT NULL DEFAULT false,
 ADD COLUMN registration_max_per_member integer NOT NULL DEFAULT 1
  CHECK (registration_max_per_member BETWEEN 1 AND 50),
 ADD COLUMN registration_capacity integer CHECK (registration_capacity >= 1),
 ADD COLUMN registration_deadline timestamptz;

CREATE TABLE public.event_bookings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
 event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (event_id, owner_id)
);

CREATE TABLE public.event_participants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
 event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
 booking_id uuid NOT NULL REFERENCES public.event_bookings(id) ON DELETE CASCADE,
 user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
 guest_prenom text CHECK (length(btrim(guest_prenom)) BETWEEN 1 AND 100),
 guest_nom text CHECK (length(btrim(guest_nom)) BETWEEN 1 AND 100),
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT event_participants_one_person CHECK (
  (user_id IS NOT NULL AND guest_prenom IS NULL AND guest_nom IS NULL)
  OR (user_id IS NULL AND guest_prenom IS NOT NULL AND guest_nom IS NOT NULL)),
 UNIQUE (event_id, user_id)
);
CREATE INDEX event_participants_booking ON public.event_participants(booking_id);
CREATE INDEX event_bookings_club ON public.event_bookings(club_id);

ALTER TABLE public.event_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_participants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_bookings, public.event_participants FROM anon, authenticated;

-- Helpers privés.
CREATE FUNCTION public.event_is_member(p_club uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM clubs c JOIN club_members m ON m.club_id=c.id
  WHERE c.id=p_club AND c.status='active' AND m.user_id=auth.uid())
$$;
CREATE FUNCTION public.event_is_admin(p_club uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM clubs WHERE id=p_club AND status='active')
  AND (is_super_admin() OR EXISTS(SELECT 1 FROM club_members WHERE club_id=p_club AND user_id=auth.uid() AND role='admin'))
$$;
CREATE FUNCTION public.event_registration_open(e public.events) RETURNS boolean
LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT e.registration_enabled AND clock_timestamp() < coalesce(e.registration_deadline, e.date_debut)
$$;
CREATE FUNCTION public.event_booking_participants(p_booking uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',ep.id,'user_id',ep.user_id,'is_guest',ep.user_id IS NULL,
   'prenom',coalesce(ep.guest_prenom,p.prenom,''),'nom',coalesce(ep.guest_nom,p.nom,''))
  ORDER BY ep.user_id IS DISTINCT FROM b.owner_id, ep.user_id IS NULL,
   coalesce(ep.guest_nom,p.nom), coalesce(ep.guest_prenom,p.prenom), ep.id),'[]'::jsonb)
 FROM event_participants ep JOIN event_bookings b ON b.id=ep.booking_id
 LEFT JOIN profiles p ON p.id=ep.user_id WHERE ep.booking_id=p_booking
$$;

-- Écrit la réservation complète de p_owner (remplace ses places). L'appelant a verrouillé
-- l'événement. p_admin : passe outre le max par réservation (jamais la jauge).
CREATE FUNCTION public.event_booking_write(p_event public.events, p_owner uuid, p_members uuid[], p_guests jsonb, p_admin boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b event_bookings; members uuid[]; everyone uuid[]; total integer; others integer; g jsonb; taken text;
BEGIN
 members := ARRAY(SELECT DISTINCT m FROM unnest(coalesce(p_members,'{}'::uuid[])) m WHERE m IS NOT NULL AND m<>p_owner);
 everyone := p_owner || members;
 p_guests := coalesce(p_guests,'[]'::jsonb);
 IF jsonb_typeof(p_guests)<>'array' OR jsonb_array_length(p_guests)>50 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 FOR g IN SELECT value FROM jsonb_array_elements(p_guests) LOOP
  IF jsonb_typeof(g)<>'object'
    OR coalesce(length(btrim(g->>'prenom')),0) NOT BETWEEN 1 AND 100
    OR coalesce(length(btrim(g->>'nom')),0) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM unnest(everyone) u WHERE NOT EXISTS(
   SELECT 1 FROM club_members cm WHERE cm.club_id=p_event.club_id AND cm.user_id=u)) THEN RAISE EXCEPTION 'NOT_MEMBER'; END IF;
 total := cardinality(everyone) + jsonb_array_length(p_guests);
 IF NOT p_admin AND total > p_event.registration_max_per_member THEN RAISE EXCEPTION 'QUOTA_EXCEEDED'; END IF;
 SELECT * INTO b FROM event_bookings WHERE event_id=p_event.id AND owner_id=p_owner;
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

-- Lecture publique : réglages, places prises, rôle et réservation de l'appelant connecté
-- (is_admin ouvre la liste des inscrits et l'ajout depuis la PWA).
-- Un membre ajouté par un autre ne voit que le nom du titulaire, pas les autres places.
CREATE FUNCTION public.event_registration_state(p_club uuid, p_event uuid) RETURNS jsonb
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

-- Membre : crée ou remplace sa réservation (lui + p_members + p_guests [{prenom,nom}]).
CREATE FUNCTION public.event_member_save(p_club uuid, p_event uuid, p_members uuid[], p_guests jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e events;
BEGIN
 IF NOT event_is_member(p_club) THEN RAISE EXCEPTION 'NOT_MEMBER'; END IF;
 SELECT * INTO e FROM events WHERE id=p_event AND club_id=p_club FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF NOT event_registration_open(e) THEN RAISE EXCEPTION 'REGISTRATION_CLOSED'; END IF;
 RETURN event_booking_write(e, auth.uid(), p_members, p_guests, false);
END $$;

-- Membre : titulaire → annule toute sa réservation ; ajouté par un autre → retire sa seule place.
CREATE FUNCTION public.event_member_cancel(p_club uuid, p_event uuid)
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
 RETURN jsonb_build_object('cancelled','self');
END $$;

-- Admin : réservations de l'événement.
CREATE FUNCTION public.event_admin_bookings(p_club uuid, p_event uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT event_is_admin(p_club) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',b.id,'owner_id',b.owner_id,'created_at',b.created_at,
   'owner_prenom',coalesce(p.prenom,''),'owner_nom',coalesce(p.nom,''),
   'participants',event_booking_participants(b.id)) ORDER BY b.created_at,b.id),'[]'::jsonb)
  FROM event_bookings b LEFT JOIN profiles p ON p.id=b.owner_id
  WHERE b.event_id=p_event AND b.club_id=p_club);
END $$;

-- Admin : ajoute des places à la réservation de p_owner (créée si besoin), même si
-- l'inscription en ligne est fermée ou le max par réservation dépassé. La jauge s'applique.
CREATE FUNCTION public.event_admin_add(p_club uuid, p_event uuid, p_owner uuid, p_members uuid[], p_guests jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e events; current_members uuid[]; current_guests jsonb;
BEGIN
 IF NOT event_is_admin(p_club) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_owner IS NULL THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 SELECT * INTO e FROM events WHERE id=p_event AND club_id=p_club FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF p_guests IS NOT NULL AND jsonb_typeof(p_guests)<>'array' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 SELECT coalesce(array_agg(ep.user_id) FILTER (WHERE ep.user_id IS NOT NULL),'{}'),
        coalesce(jsonb_agg(jsonb_build_object('prenom',ep.guest_prenom,'nom',ep.guest_nom)) FILTER (WHERE ep.user_id IS NULL),'[]')
  INTO current_members, current_guests
  FROM event_participants ep JOIN event_bookings b ON b.id=ep.booking_id
  WHERE b.event_id=e.id AND b.owner_id=p_owner;
 RETURN event_booking_write(e, p_owner, current_members || coalesce(p_members,'{}'::uuid[]),
  current_guests || coalesce(p_guests,'[]'::jsonb), true);
END $$;

-- Admin : retire une place ; retirer le titulaire annule toute sa réservation.
CREATE FUNCTION public.event_admin_remove(p_club uuid, p_participant uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ep event_participants; b event_bookings;
BEGIN
 IF NOT event_is_admin(p_club) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT * INTO ep FROM event_participants WHERE id=p_participant AND club_id=p_club;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 PERFORM 1 FROM events WHERE id=ep.event_id FOR UPDATE;
 SELECT * INTO b FROM event_bookings WHERE id=ep.booking_id;
 IF ep.user_id=b.owner_id THEN
  DELETE FROM event_bookings WHERE id=b.id;
  RETURN jsonb_build_object('removed','booking');
 END IF;
 DELETE FROM event_participants WHERE id=ep.id;
 RETURN jsonb_build_object('removed','participant');
END $$;

REVOKE ALL ON FUNCTION public.event_is_member(uuid), public.event_is_admin(uuid),
 public.event_registration_open(public.events), public.event_booking_participants(uuid),
 public.event_booking_write(public.events,uuid,uuid[],jsonb,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.event_registration_state(uuid,uuid),
 public.event_member_save(uuid,uuid,uuid[],jsonb), public.event_member_cancel(uuid,uuid),
 public.event_admin_bookings(uuid,uuid), public.event_admin_add(uuid,uuid,uuid,uuid[],jsonb),
 public.event_admin_remove(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_registration_state(uuid,uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_member_save(uuid,uuid,uuid[],jsonb), public.event_member_cancel(uuid,uuid),
 public.event_admin_bookings(uuid,uuid), public.event_admin_add(uuid,uuid,uuid,uuid[],jsonb),
 public.event_admin_remove(uuid,uuid) TO authenticated;

COMMIT;
