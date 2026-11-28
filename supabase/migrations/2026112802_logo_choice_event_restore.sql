-- Remet l'événement `logo_choice` dans `onboarding_events_name_check`.
-- En PROD, `2026111903_onboarding_video_events.sql` (liste fixe) a été appliquée après
-- `2026112001_logo_variants.sql` (qui ajoutait `logo_choice`) et l'a retiré : toute inscription
-- Ten'Up avec logo échouait (`club_self_serve_create` → 500), le 28/11/2026.
-- Même bloc que `2026112001` : la liste en place est reprise, sans effet si `logo_choice` y est.
-- Jamais SQLSTATE 40001 (PostgREST le rejoue à l'infini).
DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conrelid = 'public.onboarding_events'::regclass AND conname = 'onboarding_events_name_check';
  IF def IS NULL OR position('logo_choice' IN def) > 0 THEN RETURN; END IF;
  IF position('ARRAY[' IN def) = 0 THEN RAISE EXCEPTION 'onboarding_events_name_check inattendue : %', def; END IF;
  ALTER TABLE public.onboarding_events DROP CONSTRAINT onboarding_events_name_check;
  EXECUTE 'ALTER TABLE public.onboarding_events ADD CONSTRAINT onboarding_events_name_check '
    || replace(def, 'ARRAY[', 'ARRAY[''logo_choice''::text, ');
END $$;
