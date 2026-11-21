-- Onboarding « effet wahou », W1 — la story vidéo en vedette dans l'étape « Vos affiches ».
-- Brief `SAAS_11_onboarding_tenup` §13.2. Quatre événements du navigateur en plus de ceux de P0
-- (`2026111502_onboarding_events.sql`) :
--   - `video_previewed`      aperçu animé vu 3 s (valide l'étape), sans propriété ;
--   - `video_exported`       `{ seconds, ms, bytes }` : durée de la vidéo, temps d'encodage, poids
--                            (entiers ≥ 0) ;
--   - `video_shared`         `{ method: 'share' | 'download' }` ;
--   - `video_export_failed`  `{ reason: 'encode' | 'share' }`.
-- Comme pour P0 : jamais d'e-mail, de nom de club ni de message d'erreur brut en propriété.
-- Aucun MP4 n'est stocké (W1b abandonné le 19/11/2026).
-- Jamais SQLSTATE 40001 (PostgREST le rejoue à l'infini).

ALTER TABLE public.onboarding_events DROP CONSTRAINT IF EXISTS onboarding_events_name_check;
ALTER TABLE public.onboarding_events ADD CONSTRAINT onboarding_events_name_check CHECK (name IN (
  'club_activated', 'teams_import_started', 'teams_imported', 'poster_generated',
  'app_shared', 'site_published', 'first_steps_finished',
  'video_previewed', 'video_exported', 'video_shared', 'video_export_failed'));

-- Même contrat que P0 : true si l'événement est écrit, false pour un club qui n'est pas
-- self-serve. Erreurs : 42501 (droits), 22023 (nom ou propriétés invalides).
CREATE OR REPLACE FUNCTION public.onboarding_event_log(p_club uuid, p_name text, p_props jsonb DEFAULT '{}'::jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_self_serve boolean;
  v_props jsonb := coalesce(p_props, '{}'::jsonb);
  v_keys text[];
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.club_members m JOIN public.clubs c ON c.id = m.club_id
     WHERE m.club_id = p_club AND m.user_id = auth.uid() AND m.role = 'admin' AND c.status = 'active')
  THEN
    RAISE EXCEPTION 'Réservé aux administrateurs du club.' USING ERRCODE = '42501';
  END IF;
  IF p_name IS NULL OR p_name NOT IN ('teams_import_started', 'teams_imported', 'poster_generated', 'app_shared', 'first_steps_finished',
    'video_previewed', 'video_exported', 'video_shared', 'video_export_failed') THEN
    RAISE EXCEPTION 'Événement inconnu.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_props) <> 'object' THEN
    RAISE EXCEPTION 'Propriétés invalides.' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(k ORDER BY k) INTO v_keys FROM jsonb_object_keys(v_props) k;
  IF p_name = 'teams_imported' THEN
    IF v_keys IS DISTINCT FROM ARRAY['count']
       OR jsonb_typeof(v_props -> 'count') <> 'number' OR (v_props ->> 'count') !~ '^[0-9]{1,4}$' THEN
      RAISE EXCEPTION 'Propriétés invalides.' USING ERRCODE = '22023';
    END IF;
  ELSIF p_name = 'video_exported' THEN
    IF v_keys IS DISTINCT FROM ARRAY['bytes', 'ms', 'seconds']
       OR EXISTS (SELECT 1 FROM jsonb_each(v_props) e WHERE jsonb_typeof(e.value) <> 'number' OR (e.value #>> '{}') !~ '^[0-9]{1,10}$') THEN
      RAISE EXCEPTION 'Propriétés invalides.' USING ERRCODE = '22023';
    END IF;
  ELSIF p_name = 'video_shared' THEN
    IF v_keys IS DISTINCT FROM ARRAY['method'] OR (v_props -> 'method') NOT IN ('"share"'::jsonb, '"download"'::jsonb) THEN
      RAISE EXCEPTION 'Propriétés invalides.' USING ERRCODE = '22023';
    END IF;
  ELSIF p_name = 'video_export_failed' THEN
    IF v_keys IS DISTINCT FROM ARRAY['reason'] OR (v_props -> 'reason') NOT IN ('"encode"'::jsonb, '"share"'::jsonb) THEN
      RAISE EXCEPTION 'Propriétés invalides.' USING ERRCODE = '22023';
    END IF;
  ELSIF v_props <> '{}'::jsonb THEN
    RAISE EXCEPTION 'Propriétés invalides.' USING ERRCODE = '22023';
  END IF;
  SELECT c.created_via = 'self_serve' INTO v_self_serve FROM public.clubs c WHERE c.id = p_club;
  IF NOT v_self_serve THEN RETURN false; END IF;
  INSERT INTO public.onboarding_events (club_id, name, props) VALUES (p_club, p_name, v_props);
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.onboarding_event_log(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.onboarding_event_log(uuid, text, jsonb) TO authenticated;
