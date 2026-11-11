-- Sections d'événement : un événement peut se découper en plusieurs temps (ex. animation avec
-- jauge puis repas sans jauge). Chaque personne inscrite choisit ses sections.
-- - event_sections : lecture publique, écriture admin/manager du club (BO).
-- - event_participant_sections : privée, écrite par les RPC d'inscription.
--   Aucune ligne pour une personne = inscrite à tout l'événement (y compris aux sections
--   ajoutées plus tard). Choisir toutes les sections revient à ne rien stocker.
-- Les RPC gardent leurs paramètres : p_member_sections (nouveau, optionnel) et la clé
-- `sections` des invités. Absents → tout l'événement : une PWA pas encore à jour continue de marcher.
BEGIN;

CREATE TABLE public.event_sections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
 event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
 titre text NOT NULL CHECK (length(btrim(titre)) BETWEEN 1 AND 100),
 position integer NOT NULL DEFAULT 0,
 heure_debut timestamptz,
 prix numeric(10,2) CHECK (prix >= 0),
 capacity integer CHECK (capacity >= 1),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX event_sections_event ON public.event_sections(event_id, position);
CREATE INDEX event_sections_club ON public.event_sections(club_id);

-- NO ACTION (vérifié en fin d'instruction) et non RESTRICT : supprimer l'événement supprime ses
-- inscriptions dans la même instruction. Une section choisie explicitement par quelqu'un ne
-- peut pas être supprimée seule (erreur 23503).
CREATE TABLE public.event_participant_sections (
 participant_id uuid NOT NULL REFERENCES public.event_participants(id) ON DELETE CASCADE,
 section_id uuid NOT NULL REFERENCES public.event_sections(id),
 PRIMARY KEY (participant_id, section_id)
);
CREATE INDEX event_participant_sections_section ON public.event_participant_sections(section_id);

ALTER TABLE public.event_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_participant_sections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_participant_sections FROM anon, authenticated;
GRANT SELECT ON public.event_sections TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.event_sections TO authenticated;

CREATE POLICY event_sections_select ON public.event_sections FOR SELECT TO anon, authenticated
 USING (is_super_admin() OR EXISTS(SELECT 1 FROM clubs c WHERE c.id=club_id AND c.status='active'));
CREATE POLICY event_sections_write ON public.event_sections FOR ALL TO authenticated
 USING (can_manage_club_content(club_id))
 WITH CHECK (can_manage_club_content(club_id)
  AND EXISTS(SELECT 1 FROM events e WHERE e.id=event_id AND e.club_id=event_sections.club_id));

-- Sections choisies par une personne. p_input NULL / JSON null → tout l'événement ({}).
-- Toutes les sections cochées → {} aussi. Tableau vide alors que l'événement a des sections → SECTION_REQUIRED.
CREATE FUNCTION public.event_section_pick(p_event uuid, p_input jsonb) RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE picked uuid[]; asked integer; total integer;
BEGIN
 IF p_input IS NULL OR jsonb_typeof(p_input)='null' THEN RETURN '{}'; END IF;
 IF jsonb_typeof(p_input)<>'array' OR EXISTS(
   SELECT 1 FROM jsonb_array_elements(p_input) v WHERE jsonb_typeof(v)<>'string') THEN
  RAISE EXCEPTION 'VALIDATION_ERROR';
 END IF;
 SELECT count(*) INTO total FROM event_sections WHERE event_id=p_event;
 SELECT count(DISTINCT v) INTO asked FROM jsonb_array_elements_text(p_input) v;
 picked := ARRAY(SELECT s.id FROM event_sections s
  WHERE s.event_id=p_event AND s.id::text IN (SELECT jsonb_array_elements_text(p_input)));
 IF cardinality(picked)<>asked THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 IF total>0 AND asked=0 THEN RAISE EXCEPTION 'SECTION_REQUIRED'; END IF;
 IF asked=total THEN RETURN '{}'; END IF;
 RETURN picked;
END $$;

-- Places prises dans une section (toute la section, ou une seule réservation).
CREATE FUNCTION public.event_section_count(p_section uuid, p_booking uuid DEFAULT NULL) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT count(*)::integer FROM event_participants ep JOIN event_sections s ON s.event_id=ep.event_id
 WHERE s.id=p_section AND (p_booking IS NULL OR ep.booking_id=p_booking)
  AND (EXISTS(SELECT 1 FROM event_participant_sections x WHERE x.participant_id=ep.id AND x.section_id=s.id)
   OR NOT EXISTS(SELECT 1 FROM event_participant_sections x WHERE x.participant_id=ep.id))
$$;

-- Ajoute `sections` à chaque place : NULL = tout l'événement, sinon ids dans l'ordre des sections.
CREATE OR REPLACE FUNCTION public.event_booking_participants(p_booking uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',ep.id,'user_id',ep.user_id,'is_guest',ep.user_id IS NULL,
   'prenom',coalesce(ep.guest_prenom,p.prenom,''),'nom',coalesce(ep.guest_nom,p.nom,''),
   'sections',(SELECT jsonb_agg(x.section_id ORDER BY s.position, s.id)
     FROM event_participant_sections x JOIN event_sections s ON s.id=x.section_id
     WHERE x.participant_id=ep.id))
  ORDER BY NOT coalesce(ep.user_id=b.owner_id,false), ep.user_id IS NULL,
   coalesce(ep.guest_nom,p.nom), coalesce(ep.guest_prenom,p.prenom), ep.id),'[]'::jsonb)
 FROM event_participants ep JOIN event_bookings b ON b.id=ep.booking_id
 LEFT JOIN profiles p ON p.id=ep.user_id WHERE ep.booking_id=p_booking
$$;

-- Nouvelle signature : p_member_sections ({user_id: [section ids] | null}) et la clé `sections`
-- de chaque invité. Jauge de section contrôlée sur les sections occupées par la réservation.
DROP FUNCTION public.event_booking_write(public.events, uuid, uuid[], jsonb, boolean);
CREATE FUNCTION public.event_booking_write(p_event public.events, p_owner uuid, p_members uuid[],
 p_guests jsonb, p_member_sections jsonb, p_admin boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b event_bookings; members uuid[]; everyone uuid[]; total integer; others integer; g jsonb;
 taken text; pid uuid; full_section text;
BEGIN
 IF p_owner IS NULL AND NOT p_admin THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 members := ARRAY(SELECT DISTINCT m FROM unnest(coalesce(p_members,'{}'::uuid[])) m
  WHERE m IS NOT NULL AND m IS DISTINCT FROM p_owner);
 everyone := CASE WHEN p_owner IS NULL THEN members ELSE p_owner || members END;
 p_guests := coalesce(p_guests,'[]'::jsonb);
 p_member_sections := coalesce(nullif(p_member_sections,'null'::jsonb),'{}'::jsonb);
 IF jsonb_typeof(p_guests)<>'array' OR jsonb_array_length(p_guests)>50
   OR jsonb_typeof(p_member_sections)<>'object' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
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
 -- Sections des membres : réécrites à chaque enregistrement.
 DELETE FROM event_participant_sections x USING event_participants ep
  WHERE ep.id=x.participant_id AND ep.booking_id=b.id;
 INSERT INTO event_participant_sections(participant_id,section_id)
  SELECT ep.id, s FROM event_participants ep
  CROSS JOIN LATERAL unnest(event_section_pick(p_event.id, p_member_sections->(ep.user_id::text))) s
  WHERE ep.booking_id=b.id AND ep.user_id IS NOT NULL;
 FOR g IN SELECT value FROM jsonb_array_elements(p_guests) LOOP
  INSERT INTO event_participants(club_id,event_id,booking_id,guest_prenom,guest_nom)
   VALUES(p_event.club_id,p_event.id,b.id,btrim(g->>'prenom'),btrim(g->>'nom')) RETURNING id INTO pid;
  INSERT INTO event_participant_sections(participant_id,section_id)
   SELECT pid, s FROM unnest(event_section_pick(p_event.id, g->'sections')) s;
 END LOOP;
 -- Jauge des sections où la réservation a au moins une place (l'admin y est soumis aussi).
 SELECT s.titre INTO full_section FROM event_sections s
  WHERE s.event_id=p_event.id AND s.capacity IS NOT NULL
   AND event_section_count(s.id, b.id)>0 AND event_section_count(s.id)>s.capacity
  ORDER BY s.position, s.id LIMIT 1;
 IF full_section IS NOT NULL THEN RAISE EXCEPTION 'SECTION_FULL' USING DETAIL=full_section; END IF;
 RETURN jsonb_build_object('booking_id',b.id,'places',total);
END $$;

-- Ajoute la liste des sections (prix, jauge, places prises).
CREATE OR REPLACE FUNCTION public.event_registration_state(p_club uuid, p_event uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE e events; taken integer; b event_bookings; booking jsonb; sections jsonb;
BEGIN
 SELECT ev.* INTO e FROM events ev JOIN clubs c ON c.id=ev.club_id
  WHERE ev.id=p_event AND ev.club_id=p_club AND c.status='active';
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 SELECT count(*) INTO taken FROM event_participants WHERE event_id=e.id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'titre',s.titre,'heure_debut',s.heure_debut,
   'prix',s.prix,'capacity',s.capacity,'taken',event_section_count(s.id)) ORDER BY s.position, s.id),'[]'::jsonb)
  INTO sections FROM event_sections s WHERE s.event_id=e.id;
 IF auth.uid() IS NOT NULL THEN
  SELECT bk.* INTO b FROM event_participants ep JOIN event_bookings bk ON bk.id=ep.booking_id
   WHERE ep.event_id=e.id AND ep.user_id=auth.uid();
  IF FOUND THEN
   IF b.owner_id=auth.uid() THEN
    booking := jsonb_build_object('id',b.id,'is_owner',true,'participants',event_booking_participants(b.id));
   ELSE
    booking := jsonb_build_object('id',b.id,'is_owner',false,'owner_name',
     (SELECT btrim(prenom||' '||nom) FROM profiles WHERE id=b.owner_id),
     'sections',(SELECT jsonb_agg(x.section_id ORDER BY s.position, s.id)
       FROM event_participants ep JOIN event_participant_sections x ON x.participant_id=ep.id
       JOIN event_sections s ON s.id=x.section_id WHERE ep.event_id=e.id AND ep.user_id=auth.uid()));
   END IF;
  END IF;
 END IF;
 RETURN jsonb_build_object(
  'enabled',e.registration_enabled,'open',event_registration_open(e),
  'closes_at',coalesce(e.registration_deadline,e.date_debut),
  'capacity',e.registration_capacity,'taken',taken,
  'max_per_member',e.registration_max_per_member,'sections',sections,
  'is_member',event_is_member(p_club),'is_admin',event_is_admin(p_club),'booking',booking);
END $$;

DROP FUNCTION public.event_member_save(uuid, uuid, uuid[], jsonb);
CREATE FUNCTION public.event_member_save(p_club uuid, p_event uuid, p_members uuid[], p_guests jsonb,
 p_member_sections jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e events;
BEGIN
 IF NOT event_is_member(p_club) THEN RAISE EXCEPTION 'NOT_MEMBER'; END IF;
 SELECT * INTO e FROM events WHERE id=p_event AND club_id=p_club FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF NOT event_registration_open(e) THEN RAISE EXCEPTION 'REGISTRATION_CLOSED'; END IF;
 RETURN event_booking_write(e, auth.uid(), p_members, p_guests, p_member_sections, false);
END $$;

-- Admin : les places déjà présentes gardent leurs sections ; p_member_sections et la clé
-- `sections` des invités s'appliquent aux personnes ajoutées.
DROP FUNCTION public.event_admin_add(uuid, uuid, uuid, uuid[], jsonb);
CREATE FUNCTION public.event_admin_add(p_club uuid, p_event uuid, p_owner uuid, p_members uuid[], p_guests jsonb,
 p_member_sections jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e events; current_members uuid[]; current_guests jsonb; current_sections jsonb;
BEGIN
 IF NOT event_is_admin(p_club) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT * INTO e FROM events WHERE id=p_event AND club_id=p_club FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF p_guests IS NOT NULL AND jsonb_typeof(p_guests)<>'array' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 p_member_sections := nullif(p_member_sections,'null'::jsonb);
 IF p_member_sections IS NOT NULL AND jsonb_typeof(p_member_sections)<>'object' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 IF p_owner IS NULL THEN
  RETURN event_booking_write(e, NULL, p_members, p_guests, p_member_sections, true);
 END IF;
 SELECT coalesce(array_agg(ep.user_id) FILTER (WHERE ep.user_id IS NOT NULL),'{}'),
        coalesce(jsonb_agg(jsonb_build_object('prenom',ep.guest_prenom,'nom',ep.guest_nom,'sections',
          (SELECT jsonb_agg(x.section_id) FROM event_participant_sections x WHERE x.participant_id=ep.id)))
          FILTER (WHERE ep.user_id IS NULL),'[]'),
        coalesce(jsonb_object_agg(ep.user_id::text,
          (SELECT jsonb_agg(x.section_id) FROM event_participant_sections x WHERE x.participant_id=ep.id))
          FILTER (WHERE ep.user_id IS NOT NULL),'{}')
  INTO current_members, current_guests, current_sections
  FROM event_participants ep JOIN event_bookings b ON b.id=ep.booking_id
  WHERE b.event_id=e.id AND b.owner_id=p_owner;
 RETURN event_booking_write(e, p_owner, current_members || coalesce(p_members,'{}'::uuid[]),
  current_guests || coalesce(p_guests,'[]'::jsonb),
  current_sections || coalesce(p_member_sections,'{}'::jsonb), true);
END $$;

REVOKE ALL ON FUNCTION public.event_section_pick(uuid,jsonb), public.event_section_count(uuid,uuid),
 public.event_booking_write(public.events,uuid,uuid[],jsonb,jsonb,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.event_member_save(uuid,uuid,uuid[],jsonb,jsonb),
 public.event_admin_add(uuid,uuid,uuid,uuid[],jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_member_save(uuid,uuid,uuid[],jsonb,jsonb),
 public.event_admin_add(uuid,uuid,uuid,uuid[],jsonb,jsonb) TO authenticated;

COMMIT;
