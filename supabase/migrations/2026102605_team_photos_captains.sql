-- Photos de rencontre depuis la PWA : admins et capitaines de l'équipe ajoutent, chacun ne
-- retire que ses propres photos (l'admin garde la main sur toutes depuis le BO).
-- Chemin imposé : <club_id>/<rencontre_id>/<user_id>-<horodatage>.jpg ; l'auteur se lit dans le nom
-- de fichier et le propriétaire Storage (owner_id) le confirme.
BEGIN;

-- Chemin d'une photo déposée par l'appelant pour une rencontre où il a le droit d'écrire.
CREATE OR REPLACE FUNCTION public.team_photo_path_ok(object_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE parts text[] := string_to_array(object_name, '/');
BEGIN
  IF auth.uid() IS NULL OR array_length(parts, 1) <> 3
     OR parts[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR parts[2] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR left(parts[3], 37) <> auth.uid()::text || '-' THEN
    RETURN false;
  END IF;
  RETURN public.team_can_reschedule(parts[1]::uuid, parts[2]::uuid);
END $$;
REVOKE ALL ON FUNCTION public.team_photo_path_ok(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_photo_path_ok(text) TO authenticated;

-- Policies permissives : s'ajoutent à celles des admins (can_write_club_object).
DROP POLICY IF EXISTS team_match_photos_captain_write ON storage.objects;
CREATE POLICY team_match_photos_captain_write ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'team-match-photos' AND public.team_photo_path_ok(name));

DROP POLICY IF EXISTS team_match_photos_captain_delete ON storage.objects;
CREATE POLICY team_match_photos_captain_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'team-match-photos' AND owner_id = auth.uid()::text AND public.team_photo_path_ok(name));

-- Chemin Storage d'une URL publique du bucket (NULL si l'URL n'en vient pas).
CREATE OR REPLACE FUNCTION public.team_photo_path(p_url text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT substring(p_url FROM '/storage/v1/object/public/team-match-photos/([^?#]+)$')
$$;

CREATE OR REPLACE FUNCTION public.team_rencontre_add_photos(p_club uuid, p_rencontre uuid, p_urls text[])
RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u text; path text; result text[];
BEGIN
  IF auth.uid() IS NULL OR NOT public.team_can_reschedule(p_club, p_rencontre) THEN
    RAISE EXCEPTION 'Seul un administrateur ou un capitaine de l''équipe peut ajouter des photos.' USING ERRCODE = '42501';
  END IF;
  FOREACH u IN ARRAY coalesce(p_urls, '{}') LOOP
    path := public.team_photo_path(u);
    IF path IS NULL OR path NOT LIKE p_club || '/' || p_rencontre || '/' || auth.uid() || '-%'
       OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'team-match-photos'
                        AND o.name = path AND o.owner_id = auth.uid()::text) THEN
      RAISE EXCEPTION 'Photo inconnue.' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  UPDATE public.team_rencontres r
     SET photo_urls = r.photo_urls || ARRAY(SELECT x FROM unnest(p_urls) x WHERE NOT x = ANY(r.photo_urls))
   WHERE r.id = p_rencontre AND r.club_id = p_club
  RETURNING r.photo_urls INTO result;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rencontre introuvable.' USING ERRCODE = 'P0002'; END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.team_rencontre_add_photos(uuid, uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_rencontre_add_photos(uuid, uuid, text[]) TO authenticated;

-- Retire l'URL de la rencontre ; le client supprime ensuite le fichier (policy owner).
CREATE OR REPLACE FUNCTION public.team_rencontre_remove_photo(p_club uuid, p_rencontre uuid, p_url text)
RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result text[];
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.can_manage_club_content(p_club)
    OR (public.team_can_reschedule(p_club, p_rencontre)
        AND coalesce(public.team_photo_path(p_url), '') LIKE p_club || '/' || p_rencontre || '/' || auth.uid() || '-%')
  ) THEN
    RAISE EXCEPTION 'Vous ne pouvez retirer que vos propres photos.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.team_rencontres r SET photo_urls = array_remove(r.photo_urls, p_url)
   WHERE r.id = p_rencontre AND r.club_id = p_club
  RETURNING r.photo_urls INTO result;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rencontre introuvable.' USING ERRCODE = 'P0002'; END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.team_rencontre_remove_photo(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_rencontre_remove_photo(uuid, uuid, text) TO authenticated;

COMMIT;
