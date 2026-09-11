-- Responsable : source unique du prénom affiché.
-- Anciennes valeurs conservées pour audit, sans lecture ni écriture applicative.
BEGIN;
ALTER TABLE public.courses ALTER COLUMN coach_name DROP NOT NULL;
COMMENT ON COLUMN public.courses.coach_name IS 'Legacy : valeur historique conservée ; utiliser le prénom du profil owner_id pour afficher l’encadrant.';
CREATE OR REPLACE FUNCTION public.course_command_internal(p_club uuid, p_operation text, p_data jsonb, p_request_id uuid, p_scope text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c courses; r course_registrations; t course_types; old_status text; target uuid; cid uuid;
 rev integer; sex_value text; result jsonb; saved course_commands; allowed text[]; new_status text;
 capacity integer; occupied integer; now_at timestamptz; source_value text;
BEGIN
 IF NOT course_command_allowed(p_club,p_scope,p_operation,p_data) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_request_id IS NULL OR p_data IS NULL OR jsonb_typeof(p_data)<>'object' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 -- La clé est globale à l'acteur, y compris quand il administre plusieurs clubs.
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
 PERFORM 1 FROM clubs WHERE id=p_club FOR UPDATE;
 IF NOT course_command_allowed(p_club,p_scope,p_operation,p_data) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT * INTO saved FROM course_commands WHERE actor_id=auth.uid() AND request_id=p_request_id;
 IF FOUND THEN
  IF saved.club_id<>p_club OR saved.operation<>p_scope||':'||p_operation OR saved.fingerprint<>md5(p_data::text) THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  RETURN saved.result;
 END IF;
 allowed := CASE p_operation
  WHEN 'profile' THEN ARRAY['user_id','prenom','nom','sex','revision']
  WHEN 'save_type' THEN ARRAY['id','name','image_path','revision']
  WHEN 'archive_type' THEN ARRAY['id','revision'] WHEN 'delete_type' THEN ARRAY['id','revision']
  WHEN 'save_course' THEN ARRAY['id','type_id','name','starts_at','duration_minutes','capacity_female','capacity_male','owner_id','revision']
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
    IF (cid IS NULL AND nullif(p_data->>'owner_id','') IS NULL) OR
      (nullif(p_data->>'owner_id','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM club_members WHERE club_id=p_club AND user_id=(p_data->>'owner_id')::uuid))
      THEN RAISE EXCEPTION 'OWNER_REQUIRED'; END IF;
    SELECT * INTO t FROM course_types WHERE id=(p_data->>'type_id')::uuid AND club_id=p_club;
    IF NOT FOUND OR (t.archived_at IS NOT NULL AND (cid IS NULL OR c.type_id<>t.id)) THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
    IF (p_data->>'starts_at')::timestamptz<=now_at THEN RAISE EXCEPTION 'COURSE_STARTED'; END IF;
    IF c.has_registrations AND (c.starts_at IS DISTINCT FROM (p_data->>'starts_at')::timestamptz OR c.duration_minutes IS DISTINCT FROM (p_data->>'duration_minutes')::integer) THEN RAISE EXCEPTION 'SCHEDULE_LOCKED'; END IF;
    IF EXISTS(SELECT 1 FROM course_registrations WHERE course_id=cid AND status='approved' GROUP BY quota_sex
      HAVING count(*) > CASE WHEN quota_sex='female' THEN (p_data->>'capacity_female')::integer ELSE (p_data->>'capacity_male')::integer END) THEN RAISE EXCEPTION 'QUOTA_FULL'; END IF;
    IF cid IS NULL THEN
     INSERT INTO courses(club_id,type_id,name,starts_at,duration_minutes,capacity_female,capacity_male,owner_id)
     VALUES(p_club,t.id,btrim(p_data->>'name'),(p_data->>'starts_at')::timestamptz,(p_data->>'duration_minutes')::integer,(p_data->>'capacity_female')::integer,(p_data->>'capacity_male')::integer,nullif(p_data->>'owner_id','')::uuid) RETURNING * INTO c;
    ELSE
     UPDATE courses SET type_id=t.id,name=btrim(p_data->>'name'),starts_at=(p_data->>'starts_at')::timestamptz,duration_minutes=(p_data->>'duration_minutes')::integer,
      owner_id=nullif(p_data->>'owner_id','')::uuid,capacity_female=(p_data->>'capacity_female')::integer,capacity_male=(p_data->>'capacity_male')::integer,revision=revision+1,updated_at=now_at WHERE id=cid RETURNING * INTO c;
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
    IF p_scope='manage' AND (r.status<>'pending' OR coalesce(p_data->>'status','') NOT IN ('approved','denied')) THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
    new_status:=CASE WHEN p_operation='correct_quota' THEN r.status ELSE p_data->>'status' END;
    IF p_operation='set_status' AND NOT (
      (r.status='pending' AND new_status IN ('approved','denied','cancelled')) OR
      (r.status='approved' AND new_status IN ('denied','cancelled')) OR
      (r.status='denied' AND new_status='pending') OR
      (r.status='cancelled' AND new_status IN ('pending','approved'))) THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
    IF new_status IS NULL THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
   END IF;
   IF p_operation='set_status' AND new_status='denied' AND coalesce(length(btrim(p_data->>'denial_reason')),0) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
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
   source_value:=CASE WHEN p_operation='correct_quota' THEN 'quota_correction' WHEN p_scope='manage' THEN 'pwa_manager' ELSE 'admin' END;
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
 INSERT INTO course_commands(actor_id,request_id,club_id,operation,fingerprint,result) VALUES(auth.uid(),p_request_id,p_club,p_scope||':'||p_operation,md5(p_data::text),result);
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.course_page_internal(p_club uuid,p_view text,p_offset integer,p_private boolean,p_target uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM clubs WHERE id=p_club AND status='active') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_offset IS NULL OR p_offset<0 OR p_view IS NULL OR p_view NOT IN ('all','mine','manage') THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 IF (p_private OR p_view<>'all') AND auth.uid() IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 WITH matched AS (
  SELECT c.* FROM courses c WHERE c.club_id=p_club AND (p_target IS NULL OR c.id=p_target)
  AND CASE p_view
   WHEN 'all' THEN now()<c.starts_at+interval '24 hours'
   WHEN 'mine' THEN c.cancelled_at IS NULL AND c.starts_at+make_interval(mins=>c.duration_minutes)>now()
    AND EXISTS(SELECT 1 FROM course_registrations r WHERE r.course_id=c.id AND r.user_id=auth.uid() AND r.status IN ('pending','approved'))
   WHEN 'manage' THEN course_can_manage(p_club,c.id) AND c.starts_at+make_interval(mins=>c.duration_minutes)>now() END
 ), page AS (SELECT * FROM matched ORDER BY starts_at,id LIMIT 20 OFFSET p_offset)
 SELECT jsonb_build_object('server_now',now(),'total',(SELECT count(*) FROM matched),'items',coalesce(jsonb_agg(
  jsonb_build_object('id',c.id,'name',c.name,'type_name',ct.name,'image_path',ct.image_path,'owner_first_name',(SELECT nullif(btrim(p.prenom),'') FROM profiles p WHERE p.id=c.owner_id),
   'starts_at',c.starts_at,'duration_minutes',c.duration_minutes,'cancelled_at',c.cancelled_at,
   'capacity_female',c.capacity_female,'capacity_male',c.capacity_male,
   'approved_female',(SELECT count(*) FROM course_registrations r WHERE r.course_id=c.id AND r.status='approved' AND r.quota_sex='female'),
   'approved_male',(SELECT count(*) FROM course_registrations r WHERE r.course_id=c.id AND r.status='approved' AND r.quota_sex='male'))
  || CASE WHEN p_private THEN jsonb_build_object('can_manage',course_can_manage(p_club,c.id),
    'revision',CASE WHEN course_can_manage(p_club,c.id) THEN c.revision END,
    'pending_count',CASE WHEN course_can_manage(p_club,c.id) THEN (SELECT count(*) FROM course_registrations r WHERE r.course_id=c.id AND r.status='pending') END,
    'registration',(SELECT jsonb_build_object('id',r.id,'status',r.status,'quota_sex',r.quota_sex,'denial_reason',r.denial_reason,'requested_at',r.requested_at,'revision',r.revision)
      FROM course_registrations r WHERE r.course_id=c.id AND r.user_id=auth.uid())) ELSE '{}'::jsonb END
  ORDER BY c.starts_at,c.id),'[]'::jsonb)) INTO result FROM page c JOIN course_types ct ON ct.id=c.type_id;
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.course_admin_read(p_club uuid, p_kind text, p_target uuid DEFAULT NULL,
 p_search text DEFAULT '', p_offset integer DEFAULT 0, p_filter text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
 IF NOT course_is_admin(p_club) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_offset IS NULL OR p_offset<0 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 IF p_kind='types' THEN
  SELECT coalesce(jsonb_agg((to_jsonb(t) - 'coach_name') ORDER BY t.name,t.id),'[]') INTO result FROM
   (SELECT * FROM course_types WHERE club_id=p_club ORDER BY name,id LIMIT 50 OFFSET p_offset) t;
 ELSIF p_kind='courses' THEN
  SELECT coalesce(jsonb_agg((to_jsonb(t) - 'coach_name') ORDER BY t.starts_at,t.id),'[]') INTO result FROM
   (SELECT c.*, (SELECT nullif(btrim(p.prenom),'') FROM profiles p WHERE p.id=c.owner_id) owner_first_name, ct.name type_name, ct.image_path,
    (SELECT count(*) FROM course_registrations r WHERE r.course_id=c.id AND r.status='approved' AND r.quota_sex='female') approved_female,
    (SELECT count(*) FROM course_registrations r WHERE r.course_id=c.id AND r.status='approved' AND r.quota_sex='male') approved_male,
    (SELECT count(*) FROM course_registrations r WHERE r.course_id=c.id AND r.status='pending') pending_count
    FROM courses c JOIN course_types ct ON ct.id=c.type_id WHERE c.club_id=p_club
    AND (p_target IS NULL OR c.id=p_target)
    AND (p_target IS NOT NULL OR (CASE WHEN p_filter='past' THEN c.starts_at<=now() ELSE c.starts_at>now() END))
    ORDER BY c.starts_at,c.id LIMIT 50 OFFSET p_offset) t;
 ELSIF p_kind='members' THEN
  SELECT coalesce(jsonb_agg((to_jsonb(t) - 'coach_name') ORDER BY t.nom,t.prenom,t.user_id),'[]') INTO result FROM
   (SELECT m.user_id,p.prenom,p.nom,d.sex,coalesce(d.revision,0) revision,
     (length(btrim(coalesce(p.prenom,'')))>0 AND length(btrim(coalesce(p.nom,'')))>0 AND d.sex IS NOT NULL) complete
    FROM club_members m LEFT JOIN profiles p ON p.id=m.user_id LEFT JOIN profile_details d ON d.user_id=m.user_id
    WHERE m.club_id=p_club AND (p_target IS NULL OR m.user_id=p_target)
    AND concat(p.prenom,' ',p.nom) ILIKE '%'||coalesce(p_search,'')||'%'
    ORDER BY p.nom,p.prenom,m.user_id LIMIT 50 OFFSET p_offset) t;
 ELSIF p_kind='registrations' THEN
  IF NOT EXISTS(SELECT 1 FROM courses WHERE id=p_target AND club_id=p_club) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  SELECT coalesce(jsonb_agg((to_jsonb(t) - 'coach_name') ORDER BY t.requested_at,t.id),'[]') INTO result FROM
   (SELECT r.*,p.prenom,p.nom FROM course_registrations r LEFT JOIN profiles p ON p.id=r.user_id
    WHERE r.club_id=p_club AND r.course_id=p_target AND (p_filter='' OR r.status=p_filter)
    ORDER BY r.requested_at,r.id LIMIT 50 OFFSET p_offset) t;
 ELSIF p_kind='history' THEN
  SELECT coalesce(jsonb_agg((to_jsonb(t) - 'coach_name') ORDER BY t.requested_at DESC,t.id),'[]') INTO result FROM
   (SELECT r.*,c.name course_name,c.starts_at,c.cancelled_at FROM course_registrations r JOIN courses c ON c.id=r.course_id
    WHERE r.club_id=p_club AND r.user_id=p_target ORDER BY r.requested_at DESC,r.id LIMIT 50 OFFSET p_offset) t;
 ELSIF p_kind='events' THEN
  SELECT coalesce(jsonb_agg((to_jsonb(t) - 'coach_name') ORDER BY t.occurred_at DESC,t.id),'[]') INTO result FROM
   (SELECT id,from_status,to_status,occurred_at,source,quota_sex,denial_reason FROM course_registration_events
    WHERE club_id=p_club AND registration_id=p_target ORDER BY occurred_at DESC,id LIMIT 50 OFFSET p_offset) t;
 ELSE RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 RETURN result;
END $$;
COMMIT;
