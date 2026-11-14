-- SaaS S8 — « Publier le site » : un admin du club ouvre (ou referme) sa vitrine aux moteurs.
--
-- `clubs.site_published` (S2) n'est pas modifiable par `authenticated` (grants par colonne) :
-- la vitrine pose `noindex` tant que le site n'est pas prêt OU pas publié. Cette RPC est le
-- seul chemin d'écriture côté navigateur. Publier un site incomplet reste sans effet sur
-- l'indexation (double condition de `web/src/server/render.tsx`) : rien à vérifier ici.
--
-- Garde : admin du club actif, ou super-admin (même garde que `post_gen_is_admin`).
-- Ne touche ni à `plan` ni à `status`. Erreurs : 42501 (droits), P0002 (club introuvable).
-- Jamais SQLSTATE 40001 (PostgREST le rejoue à l'infini).

CREATE OR REPLACE FUNCTION public.club_set_site_published(p_club uuid, p_published boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_published IS NULL THEN
    RAISE EXCEPTION 'Valeur de publication manquante.' USING ERRCODE = '22004';
  END IF;
  IF auth.uid() IS NULL OR NOT (public.is_super_admin() OR EXISTS (
    SELECT 1 FROM public.club_members m JOIN public.clubs c ON c.id = m.club_id
     WHERE m.club_id = p_club AND m.user_id = auth.uid() AND m.role = 'admin' AND c.status = 'active'))
  THEN
    RAISE EXCEPTION 'Réservé aux administrateurs du club.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.clubs SET site_published = p_published WHERE id = p_club AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Club introuvable.' USING ERRCODE = 'P0002';
  END IF;
  RETURN p_published;
END $$;

REVOKE ALL ON FUNCTION public.club_set_site_published(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_set_site_published(uuid, boolean) TO authenticated;
