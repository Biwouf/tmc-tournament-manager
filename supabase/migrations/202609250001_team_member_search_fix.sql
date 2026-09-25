-- Avoid collision with the implicit PL/pgSQL FOUND variable.
CREATE OR REPLACE FUNCTION public.team_member_search(p_club uuid,p_search text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT team_can_score(p_club) THEN RAISE EXCEPTION 'Accès membre requis.' USING ERRCODE='42501'; END IF;
 IF length(btrim(p_search))<2 THEN RETURN '[]'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(to_jsonb(candidate)),'[]') FROM
  (SELECT p.id,p.prenom,p.nom FROM profiles p JOIN club_members m ON m.user_id=p.id
   WHERE m.club_id=p_club AND (p.prenom||' '||p.nom) ILIKE '%'||left(p_search,80)||'%'
   ORDER BY p.nom,p.prenom LIMIT 12) candidate);
END $$;
REVOKE ALL ON FUNCTION public.team_member_search(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.team_member_search(uuid,text) TO authenticated;

