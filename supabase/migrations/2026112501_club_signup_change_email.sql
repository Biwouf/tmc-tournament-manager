-- Onboarding P2 (retours PR #277, B1) — corriger son e-mail avant l'activation du club.
-- Spec SAAS_ONBOARDING.md §14.9.
--
-- `club_self_serve_create` refuse un second compte sur un club `pending` (PT410 / PT409) : une
-- adresse mal tapée bloquait le fondateur jusqu'à la purge à 7 jours. `club_self_serve_change_email`
-- remplace l'admin du club en attente. Appelée par `club-signup` SEULEMENT sur présentation du jeton
-- signé remis à la création (le slug seul ne suffit pas) ; service role seulement.
--   - club introuvable, déjà activé ou hors self-serve → PT409 ; compte absent → PT400 ;
--   - `clubs.created_at` repart de maintenant : la preuve d'activation (`amr`, §5.2) doit être
--     postérieure au rattachement, pas seulement à la création (sinon une session ouverte entre les
--     deux par le titulaire de la nouvelle adresse activerait un club qu'il n'a pas demandé) ;
--   - renvoie les comptes à supprimer : mêmes conditions que `club_self_serve_purge`.
-- Idempotente (même adresse : aucun changement). Jamais de SQLSTATE 40001.
--
-- Rollback : DROP FUNCTION public.club_self_serve_change_email(uuid, text, text);
BEGIN;

CREATE OR REPLACE FUNCTION public.club_self_serve_change_email(p_club uuid, p_slug text, p_email text)
  RETURNS SETOF uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  account uuid;
  previous uuid[];
BEGIN
  SELECT u.id INTO account FROM auth.users u WHERE lower(u.email) = lower(btrim(p_email)) LIMIT 1;
  IF account IS NULL THEN RAISE EXCEPTION 'ACCOUNT_MISSING' USING ERRCODE = 'PT400'; END IF;
  -- Le verrou sérialise avec l'activation et la purge : l'un ou l'autre, jamais les deux.
  PERFORM 1 FROM public.clubs c
   WHERE c.id = p_club AND c.slug = p_slug AND c.status = 'pending' AND c.created_via = 'self_serve'
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CLUB_NOT_PENDING' USING ERRCODE = 'PT409'; END IF;
  SELECT coalesce(array_agg(m.user_id), '{}') INTO previous
    FROM public.club_members m WHERE m.club_id = p_club AND m.user_id <> account;
  IF previous = '{}' AND EXISTS (SELECT 1 FROM public.club_members m
       WHERE m.club_id = p_club AND m.user_id = account AND m.role = 'admin') THEN
    RETURN;
  END IF;

  -- Le nouvel admin d'abord : le club n'est jamais sans administrateur (`protect_last_club_admin`).
  INSERT INTO public.club_members (club_id, user_id, role) VALUES (p_club, account, 'admin')
    ON CONFLICT (club_id, user_id) DO UPDATE SET role = 'admin';
  DELETE FROM public.club_members m WHERE m.club_id = p_club AND m.user_id <> account;
  UPDATE public.clubs SET created_at = now() WHERE id = p_club;

  RETURN QUERY SELECT u.id FROM auth.users u
   WHERE u.id = ANY (previous)
     AND u.raw_app_meta_data ->> 'created_via' = 'club_signup'
     AND NOT EXISTS (SELECT 1 FROM public.club_members m WHERE m.user_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM public.club_signup_requests r WHERE r.user_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id AND p.is_super_admin);
END $$;

REVOKE ALL ON FUNCTION public.club_self_serve_change_email(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_self_serve_change_email(uuid, text, text) TO service_role;

COMMIT;
