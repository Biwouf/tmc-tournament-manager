-- Cours, lot BO. Appliquer après livraison d'AcceptInvitePage sans upsert de profil.
-- Aucune mutation publique : seules les RPC admin sont exposées dans ce lot.
BEGIN;
CREATE TABLE public.profile_details (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 sex text CHECK (sex IN ('female','male')), revision integer NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profile_details ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.profile_details TO authenticated;
CREATE POLICY own_details ON public.profile_details FOR SELECT TO authenticated USING (user_id=auth.uid());

CREATE TABLE public.course_types (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80), image_path text,
 archived_at timestamptz, revision integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(club_id,id)
);
ALTER TABLE public.course_types ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.course_types FROM anon, authenticated;
CREATE UNIQUE INDEX course_types_name ON public.course_types(club_id,lower(btrim(name))) WHERE archived_at IS NULL;
CREATE TABLE public.courses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
 type_id uuid NOT NULL, name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120),
 starts_at timestamptz NOT NULL, duration_minutes integer NOT NULL CHECK(duration_minutes BETWEEN 1 AND 1440),
 coach_name text NOT NULL CHECK(length(btrim(coach_name)) BETWEEN 1 AND 120),
 capacity_female integer NOT NULL CHECK(capacity_female BETWEEN 0 AND 1000),
 capacity_male integer NOT NULL CHECK(capacity_male BETWEEN 0 AND 1000),
 cancelled_at timestamptz, revision integer NOT NULL DEFAULT 0, has_registrations boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(capacity_female+capacity_male>0), UNIQUE(club_id,id),
 FOREIGN KEY(club_id,type_id) REFERENCES course_types(club_id,id)
);
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.courses FROM anon, authenticated;
CREATE INDEX courses_catalog ON courses(club_id,starts_at,id);
CREATE TABLE public.course_registrations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
 course_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 status text NOT NULL CHECK(status IN ('pending','approved','denied','cancelled')),
 quota_sex text NOT NULL CHECK(quota_sex IN ('female','male')),
 denial_reason text CHECK(length(denial_reason)<=1000), cancellation_source text,
 requested_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz,
 decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL, created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 updated_at timestamptz NOT NULL DEFAULT now(), revision integer NOT NULL DEFAULT 0,
 FOREIGN KEY(club_id,course_id) REFERENCES courses(club_id,id) ON DELETE CASCADE,
 UNIQUE(course_id,user_id)
);
ALTER TABLE public.course_registrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.course_registrations FROM anon, authenticated;
CREATE INDEX course_registration_counts ON course_registrations(course_id,status,quota_sex);
CREATE INDEX course_registration_history ON course_registrations(club_id,user_id,requested_at,id);
CREATE TABLE public.course_registration_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), registration_id uuid NOT NULL REFERENCES course_registrations(id) ON DELETE CASCADE,
 club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE, from_status text, to_status text NOT NULL,
 actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL, occurred_at timestamptz NOT NULL DEFAULT now(),
 source text NOT NULL, quota_sex text NOT NULL, denial_reason text, request_id uuid
);
ALTER TABLE public.course_registration_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.course_registration_events FROM anon, authenticated;
CREATE INDEX course_events_history ON course_registration_events(club_id,registration_id,occurred_at,id);
CREATE TABLE public.course_commands (
 actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 request_id uuid NOT NULL, club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
 operation text NOT NULL, fingerprint text NOT NULL, result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(actor_id,request_id)
);
ALTER TABLE public.course_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.course_commands FROM anon, authenticated;

CREATE FUNCTION public.course_is_admin(p_club uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM clubs WHERE id=p_club AND status='active')
 AND (public.is_super_admin() OR EXISTS(SELECT 1 FROM club_members WHERE club_id=p_club AND user_id=auth.uid() AND role='admin'))
$$;
REVOKE ALL ON FUNCTION public.course_is_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.course_is_admin(uuid) TO authenticated;

-- Les lectures restent privées en BO. Pagination bornée ; recherche membres sans email public.
CREATE FUNCTION public.course_admin_read(p_club uuid, p_kind text, p_target uuid DEFAULT NULL,
 p_search text DEFAULT '', p_offset integer DEFAULT 0, p_filter text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
 IF NOT course_is_admin(p_club) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_offset IS NULL OR p_offset<0 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 IF p_kind='types' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.name,t.id),'[]') INTO result FROM
   (SELECT * FROM course_types WHERE club_id=p_club ORDER BY name,id LIMIT 50 OFFSET p_offset) t;
 ELSIF p_kind='courses' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.starts_at,t.id),'[]') INTO result FROM
   (SELECT c.*, ct.name type_name, ct.image_path,
    (SELECT count(*) FROM course_registrations r WHERE r.course_id=c.id AND r.status='approved' AND r.quota_sex='female') approved_female,
    (SELECT count(*) FROM course_registrations r WHERE r.course_id=c.id AND r.status='approved' AND r.quota_sex='male') approved_male,
    (SELECT count(*) FROM course_registrations r WHERE r.course_id=c.id AND r.status='pending') pending_count
    FROM courses c JOIN course_types ct ON ct.id=c.type_id WHERE c.club_id=p_club
    AND (p_target IS NULL OR c.id=p_target)
    AND (p_target IS NOT NULL OR (CASE WHEN p_filter='past' THEN c.starts_at<=now() ELSE c.starts_at>now() END))
    ORDER BY c.starts_at,c.id LIMIT 50 OFFSET p_offset) t;
 ELSIF p_kind='members' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.nom,t.prenom,t.user_id),'[]') INTO result FROM
   (SELECT m.user_id,p.prenom,p.nom,d.sex,coalesce(d.revision,0) revision,
     (length(btrim(coalesce(p.prenom,'')))>0 AND length(btrim(coalesce(p.nom,'')))>0 AND d.sex IS NOT NULL) complete
    FROM club_members m LEFT JOIN profiles p ON p.id=m.user_id LEFT JOIN profile_details d ON d.user_id=m.user_id
    WHERE m.club_id=p_club AND (p_target IS NULL OR m.user_id=p_target)
    AND concat(p.prenom,' ',p.nom) ILIKE '%'||coalesce(p_search,'')||'%'
    ORDER BY p.nom,p.prenom,m.user_id LIMIT 50 OFFSET p_offset) t;
 ELSIF p_kind='registrations' THEN
  IF NOT EXISTS(SELECT 1 FROM courses WHERE id=p_target AND club_id=p_club) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.requested_at,t.id),'[]') INTO result FROM
   (SELECT r.*,p.prenom,p.nom FROM course_registrations r LEFT JOIN profiles p ON p.id=r.user_id
    WHERE r.club_id=p_club AND r.course_id=p_target AND (p_filter='' OR r.status=p_filter)
    ORDER BY r.requested_at,r.id LIMIT 50 OFFSET p_offset) t;
 ELSIF p_kind='history' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.requested_at DESC,t.id),'[]') INTO result FROM
   (SELECT r.*,c.name course_name,c.starts_at,c.cancelled_at FROM course_registrations r JOIN courses c ON c.id=r.course_id
    WHERE r.club_id=p_club AND r.user_id=p_target ORDER BY r.requested_at DESC,r.id LIMIT 50 OFFSET p_offset) t;
 ELSIF p_kind='events' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.occurred_at DESC,t.id),'[]') INTO result FROM
   (SELECT id,from_status,to_status,occurred_at,source,quota_sex,denial_reason FROM course_registration_events
    WHERE club_id=p_club AND registration_id=p_target ORDER BY occurred_at DESC,id LIMIT 50 OFFSET p_offset) t;
 ELSE RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.course_admin_read(uuid,text,uuid,text,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.course_admin_read(uuid,text,uuid,text,integer,text) TO authenticated;

-- Une enveloppe RPC pour le BO ; whitelist de champs et droits contrôlés pour chaque action.
-- Verrou de club commun aux commandes et retraits, puis cours : sérialisation volontaire V1.
CREATE FUNCTION public.course_admin_command(p_club uuid, p_operation text, p_data jsonb, p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c courses; r course_registrations; t course_types; old_status text; target uuid; cid uuid;
 rev integer; sex_value text; result jsonb; saved course_commands; allowed text[]; new_status text;
 capacity integer; occupied integer; now_at timestamptz; source_value text;
BEGIN
 IF NOT course_is_admin(p_club) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_request_id IS NULL OR p_data IS NULL OR jsonb_typeof(p_data)<>'object' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 -- La clé est globale à l'acteur, y compris quand il administre plusieurs clubs.
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
 PERFORM 1 FROM clubs WHERE id=p_club FOR UPDATE;
 IF NOT course_is_admin(p_club) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT * INTO saved FROM course_commands WHERE actor_id=auth.uid() AND request_id=p_request_id;
 IF FOUND THEN
  IF saved.club_id<>p_club OR saved.operation<>p_operation OR saved.fingerprint<>md5(p_data::text) THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  RETURN saved.result;
 END IF;
 allowed := CASE p_operation
  WHEN 'profile' THEN ARRAY['user_id','prenom','nom','sex','revision']
  WHEN 'save_type' THEN ARRAY['id','name','image_path','revision']
  WHEN 'archive_type' THEN ARRAY['id','revision'] WHEN 'delete_type' THEN ARRAY['id','revision']
  WHEN 'save_course' THEN ARRAY['id','type_id','name','starts_at','duration_minutes','coach_name','capacity_female','capacity_male','revision']
  WHEN 'cancel_course' THEN ARRAY['id','revision'] WHEN 'delete_course' THEN ARRAY['id','revision']
  WHEN 'add_registration' THEN ARRAY['course_id','user_id','status']
  WHEN 'set_status' THEN ARRAY['id','status','denial_reason','revision']
  WHEN 'correct_quota' THEN ARRAY['id','revision'] ELSE NULL END;
 IF allowed IS NULL OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE NOT k=ANY(allowed)) THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 target := nullif(p_data->>'id','')::uuid; rev := (p_data->>'revision')::integer;
 now_at := clock_timestamp();
 IF p_operation='profile' THEN
  target := (p_data->>'user_id')::uuid;
  IF NOT EXISTS(SELECT 1 FROM club_members WHERE club_id=p_club AND user_id=target) THEN RAISE EXCEPTION 'NOT_MEMBER'; END IF;
  IF coalesce(length(btrim(p_data->>'prenom')),0) NOT BETWEEN 1 AND 100
    OR coalesce(length(btrim(p_data->>'nom')),0) NOT BETWEEN 1 AND 100
    OR coalesce(p_data->>'sex','') NOT IN ('female','male') THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  INSERT INTO profile_details(user_id) VALUES(target) ON CONFLICT DO NOTHING;
  SELECT revision INTO capacity FROM profile_details WHERE user_id=target FOR UPDATE;
  IF rev IS DISTINCT FROM capacity THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
  INSERT INTO profiles(id,prenom,nom) VALUES(target,btrim(p_data->>'prenom'),btrim(p_data->>'nom'))
   ON CONFLICT(id) DO UPDATE SET prenom=excluded.prenom,nom=excluded.nom;
  UPDATE profile_details SET sex=p_data->>'sex',revision=revision+1,updated_at=now_at WHERE user_id=target;
  result:=jsonb_build_object('id',target,'revision',capacity+1);
 ELSIF p_operation IN ('save_type','archive_type','delete_type') THEN
  IF target IS NOT NULL THEN
   SELECT * INTO t FROM course_types WHERE id=target AND club_id=p_club FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
   IF rev IS DISTINCT FROM t.revision THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
  ELSIF p_operation<>'save_type' THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF p_operation='save_type' THEN
   IF coalesce(length(btrim(p_data->>'name')),0) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
   IF nullif(p_data->>'image_path','') IS NOT NULL AND (p_data->>'image_path' NOT LIKE p_club::text||'/course-types/%'
      OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='course-type-images' AND name=p_data->>'image_path')) THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
   IF target IS NULL THEN
    INSERT INTO course_types(club_id,name,image_path) VALUES(p_club,btrim(p_data->>'name'),nullif(p_data->>'image_path','')) RETURNING * INTO t;
   ELSE
    UPDATE course_types SET name=btrim(p_data->>'name'),image_path=nullif(p_data->>'image_path',''),revision=revision+1,updated_at=now_at WHERE id=target RETURNING * INTO t;
   END IF;
  ELSIF p_operation='archive_type' THEN
   UPDATE course_types SET archived_at=now_at,revision=revision+1,updated_at=now_at WHERE id=target RETURNING * INTO t;
  ELSE
   IF EXISTS(SELECT 1 FROM courses WHERE type_id=target) THEN RAISE EXCEPTION 'TYPE_IN_USE'; END IF;
   DELETE FROM course_types WHERE id=target;
  END IF;
  result:=jsonb_build_object('id',t.id,'revision',t.revision);
 ELSE
  IF p_operation='add_registration' THEN cid:=(p_data->>'course_id')::uuid;
  ELSIF p_operation IN ('set_status','correct_quota') THEN
   SELECT * INTO r FROM course_registrations WHERE id=target AND club_id=p_club;
   IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
   cid:=r.course_id;
  ELSE cid:=target; END IF;
  IF cid IS NOT NULL THEN
   SELECT * INTO c FROM courses WHERE id=cid AND club_id=p_club FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
   now_at:=clock_timestamp();
   IF c.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'COURSE_CANCELLED'; END IF;
   IF c.starts_at<=now_at THEN RAISE EXCEPTION 'COURSE_STARTED'; END IF;
  ELSIF p_operation<>'save_course' THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF p_operation IN ('save_course','cancel_course','delete_course') THEN
   IF cid IS NOT NULL AND rev IS DISTINCT FROM c.revision THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
   IF p_operation='save_course' THEN
    SELECT * INTO t FROM course_types WHERE id=(p_data->>'type_id')::uuid AND club_id=p_club;
    IF NOT FOUND OR (t.archived_at IS NOT NULL AND (cid IS NULL OR c.type_id<>t.id)) THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
    IF (p_data->>'starts_at')::timestamptz<=now_at THEN RAISE EXCEPTION 'COURSE_STARTED'; END IF;
    IF c.has_registrations AND (c.starts_at IS DISTINCT FROM (p_data->>'starts_at')::timestamptz OR c.duration_minutes IS DISTINCT FROM (p_data->>'duration_minutes')::integer) THEN RAISE EXCEPTION 'SCHEDULE_LOCKED'; END IF;
    IF EXISTS(SELECT 1 FROM course_registrations WHERE course_id=cid AND status='approved' GROUP BY quota_sex
      HAVING count(*) > CASE WHEN quota_sex='female' THEN (p_data->>'capacity_female')::integer ELSE (p_data->>'capacity_male')::integer END) THEN RAISE EXCEPTION 'QUOTA_FULL'; END IF;
    IF cid IS NULL THEN
     INSERT INTO courses(club_id,type_id,name,starts_at,duration_minutes,coach_name,capacity_female,capacity_male)
     VALUES(p_club,t.id,btrim(p_data->>'name'),(p_data->>'starts_at')::timestamptz,(p_data->>'duration_minutes')::integer,btrim(p_data->>'coach_name'),(p_data->>'capacity_female')::integer,(p_data->>'capacity_male')::integer) RETURNING * INTO c;
    ELSE
     UPDATE courses SET type_id=t.id,name=btrim(p_data->>'name'),starts_at=(p_data->>'starts_at')::timestamptz,duration_minutes=(p_data->>'duration_minutes')::integer,
      coach_name=btrim(p_data->>'coach_name'),capacity_female=(p_data->>'capacity_female')::integer,capacity_male=(p_data->>'capacity_male')::integer,revision=revision+1,updated_at=now_at WHERE id=cid RETURNING * INTO c;
    END IF;
   ELSIF p_operation='delete_course' THEN
    IF c.has_registrations THEN RAISE EXCEPTION 'COURSE_HAS_HISTORY'; END IF;
    DELETE FROM courses WHERE id=cid;
   ELSE
    INSERT INTO course_registration_events(registration_id,club_id,from_status,to_status,actor_id,source,quota_sex,request_id)
     SELECT id,club_id,status,'cancelled',auth.uid(),'course_cancelled',quota_sex,p_request_id FROM course_registrations WHERE course_id=cid AND status IN ('pending','approved');
    UPDATE course_registrations SET status='cancelled',cancellation_source='course_cancelled',denial_reason=NULL,revision=revision+1,updated_at=now_at WHERE course_id=cid AND status IN ('pending','approved');
    UPDATE courses SET cancelled_at=now_at,revision=revision+1,updated_at=now_at WHERE id=cid RETURNING * INTO c;
   END IF;
   result:=jsonb_build_object('id',c.id,'revision',c.revision);
  ELSE
   IF p_operation='add_registration' THEN
    r.user_id:=(p_data->>'user_id')::uuid; new_status:=p_data->>'status';
    IF coalesce(new_status,'') NOT IN ('pending','approved') THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
    IF EXISTS(SELECT 1 FROM course_registrations WHERE course_id=cid AND user_id=r.user_id) THEN RAISE EXCEPTION 'ALREADY_REGISTERED'; END IF;
   ELSE
    SELECT * INTO r FROM course_registrations WHERE id=target FOR UPDATE;
    IF rev IS DISTINCT FROM r.revision THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
    old_status:=r.status;
    new_status:=CASE WHEN p_operation='correct_quota' THEN r.status ELSE p_data->>'status' END;
    IF p_operation='set_status' AND NOT (
      (r.status='pending' AND new_status IN ('approved','denied','cancelled')) OR
      (r.status='approved' AND new_status IN ('denied','cancelled')) OR
      (r.status='denied' AND new_status='pending') OR
      (r.status='cancelled' AND new_status IN ('pending','approved'))) THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
    IF new_status IS NULL THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
   END IF;
   IF new_status IN ('pending','approved') OR p_operation='correct_quota' THEN
    IF NOT EXISTS(SELECT 1 FROM club_members WHERE club_id=p_club AND user_id=r.user_id) THEN RAISE EXCEPTION 'NOT_MEMBER'; END IF;
    SELECT d.sex INTO sex_value FROM profiles p JOIN profile_details d ON d.user_id=p.id WHERE p.id=r.user_id AND length(btrim(p.prenom))>0 AND length(btrim(p.nom))>0;
    IF sex_value IS NULL THEN RAISE EXCEPTION 'PROFILE_INCOMPLETE'; END IF;
   END IF;
   IF p_operation='add_registration' OR p_operation='correct_quota' OR old_status IN ('cancelled','denied') THEN r.quota_sex:=sex_value; END IF;
   IF new_status='approved' THEN
    capacity:=CASE WHEN r.quota_sex='female' THEN c.capacity_female ELSE c.capacity_male END;
    SELECT count(*) INTO occupied FROM course_registrations WHERE course_id=cid AND status='approved' AND quota_sex=r.quota_sex AND (target IS NULL OR id<>target);
    IF occupied>=capacity THEN RAISE EXCEPTION 'QUOTA_FULL'; END IF;
   END IF;
   source_value:=CASE WHEN p_operation='correct_quota' THEN 'quota_correction' ELSE 'admin' END;
   IF p_operation='add_registration' THEN
    INSERT INTO course_registrations(club_id,course_id,user_id,status,quota_sex,created_by,decided_at,decided_by)
     VALUES(p_club,cid,r.user_id,new_status,r.quota_sex,auth.uid(),CASE WHEN new_status='approved' THEN now_at END,CASE WHEN new_status='approved' THEN auth.uid() END) RETURNING * INTO r;
   ELSIF p_operation='correct_quota' THEN
    UPDATE course_registrations SET quota_sex=r.quota_sex,revision=revision+1,updated_at=now_at WHERE id=target RETURNING * INTO r;
   ELSE
    UPDATE course_registrations SET status=new_status,quota_sex=r.quota_sex,
     denial_reason=CASE WHEN new_status='denied' THEN nullif(btrim(p_data->>'denial_reason'),'') END,
     cancellation_source=CASE WHEN new_status='cancelled' THEN 'admin' END,
     requested_at=CASE WHEN old_status IN ('cancelled','denied') AND new_status IN ('pending','approved') THEN now_at ELSE requested_at END,
     decided_at=CASE WHEN new_status IN ('approved','denied') THEN now_at END,
     decided_by=CASE WHEN new_status IN ('approved','denied') THEN auth.uid() END,
     revision=revision+1,updated_at=now_at WHERE id=target RETURNING * INTO r;
   END IF;
   INSERT INTO course_registration_events(registration_id,club_id,from_status,to_status,actor_id,source,quota_sex,denial_reason,request_id)
    VALUES(r.id,p_club,old_status,r.status,auth.uid(),source_value,r.quota_sex,r.denial_reason,p_request_id);
   UPDATE courses SET has_registrations=true WHERE id=cid;
   result:=jsonb_build_object('id',r.id,'revision',r.revision);
  END IF;
 END IF;
 INSERT INTO course_commands(actor_id,request_id,club_id,operation,fingerprint,result) VALUES(auth.uid(),p_request_id,p_club,p_operation,md5(p_data::text),result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.course_admin_command(uuid,text,jsonb,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.course_admin_command(uuid,text,jsonb,uuid) TO authenticated;

CREATE FUNCTION public.course_member_removed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM 1 FROM clubs WHERE id=OLD.club_id FOR UPDATE;
 IF NOT FOUND THEN RETURN OLD; END IF; -- suppression du club parent en cascade
 PERFORM 1 FROM courses WHERE club_id=OLD.club_id AND starts_at>clock_timestamp() ORDER BY id FOR UPDATE;
 INSERT INTO course_registration_events(registration_id,club_id,from_status,to_status,source,quota_sex)
  SELECT r.id,r.club_id,r.status,'cancelled','membership_removed',r.quota_sex FROM course_registrations r JOIN courses c ON c.id=r.course_id
   WHERE r.club_id=OLD.club_id AND r.user_id=OLD.user_id AND c.starts_at>clock_timestamp() AND r.status IN ('pending','approved');
 UPDATE course_registrations r SET status='cancelled',denial_reason=NULL,cancellation_source='membership_removed',revision=r.revision+1,updated_at=clock_timestamp()
  FROM courses c WHERE c.id=r.course_id AND r.club_id=OLD.club_id AND r.user_id=OLD.user_id AND c.starts_at>clock_timestamp() AND r.status IN ('pending','approved');
 RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.course_member_removed() FROM PUBLIC;
CREATE TRIGGER course_member_removed BEFORE DELETE ON club_members FOR EACH ROW EXECUTE FUNCTION public.course_member_removed();

-- Identité désormais administrée ; ne jamais rétablir les GRANT de table qui ouvriraient is_super_admin.
REVOKE INSERT, UPDATE ON profiles FROM authenticated;
REVOKE INSERT(id,prenom,nom), UPDATE(id,prenom,nom) ON profiles FROM authenticated;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 VALUES('course-type-images','course-type-images',true,5242880,ARRAY['image/jpeg','image/png','image/webp']);
CREATE POLICY course_images_insert ON storage.objects FOR INSERT TO authenticated
 WITH CHECK(bucket_id='course-type-images' AND EXISTS(SELECT 1 FROM clubs c WHERE storage.objects.name LIKE c.id::text||'/course-types/%' AND public.course_is_admin(c.id)));
-- DELETE vérifie la référence via un helper privé à la place d'une lecture client des types.
CREATE FUNCTION public.course_image_unused(p_name text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT NOT EXISTS(SELECT 1 FROM course_types WHERE image_path=p_name)
$$;
REVOKE ALL ON FUNCTION public.course_image_unused(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.course_image_unused(text) TO authenticated;
CREATE POLICY course_images_delete ON storage.objects FOR DELETE TO authenticated
 USING(bucket_id='course-type-images' AND EXISTS(SELECT 1 FROM clubs c WHERE storage.objects.name LIKE c.id::text||'/course-types/%' AND public.course_is_admin(c.id)) AND public.course_image_unused(name));
CREATE POLICY course_images_select ON storage.objects FOR SELECT TO authenticated
 USING(bucket_id='course-type-images' AND EXISTS(SELECT 1 FROM clubs c WHERE storage.objects.name LIKE c.id::text||'/course-types/%' AND public.course_is_admin(c.id)));
COMMIT;
