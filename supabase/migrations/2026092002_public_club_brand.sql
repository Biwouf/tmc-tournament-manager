-- Identité publique identique avant/après authentification, y compris en attente.
-- Ne pas élargir les policies de lecture/écriture des paramètres complets.
BEGIN;
CREATE FUNCTION public.club_public_brand(p_club uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE brand jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM clubs WHERE id=p_club AND status='active') THEN RAISE EXCEPTION 'CLUB_UNAVAILABLE'; END IF;
 SELECT s.config->'brand' INTO brand FROM club_settings s WHERE s.club_id=p_club;
 RETURN jsonb_build_object('brand',jsonb_build_object(
  'logo',brand->>'logo','color',brand->>'color',
  'color_secondary',brand->>'color_secondary','color_accent',brand->>'color_accent'));
END $$;
REVOKE ALL ON FUNCTION public.club_public_brand(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_public_brand(uuid) TO anon,authenticated;
COMMIT;
