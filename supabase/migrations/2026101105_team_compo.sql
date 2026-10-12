-- Saisie de la compo des simples en une fois (PWA) : liste des membres pour le rapprochement
-- des noms scannés, création atomique des simples et mise à jour du classement des membres.
BEGIN;
CREATE OR REPLACE FUNCTION public.team_member_roster(p_club uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT team_can_score(p_club) THEN RAISE EXCEPTION 'Accès membre requis.' USING ERRCODE='42501'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(to_jsonb(candidate) ORDER BY candidate.nom,candidate.prenom),'[]') FROM
  (SELECT p.id,p.prenom,p.nom,d.classement FROM club_members m JOIN profiles p ON p.id=m.user_id
   LEFT JOIN profile_details d ON d.user_id=m.user_id
   WHERE m.club_id=p_club AND length(btrim(p.prenom||p.nom))>0) candidate);
END $$;
REVOKE ALL ON FUNCTION public.team_member_roster(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.team_member_roster(uuid) TO authenticated;

-- Chaque simple passe par team_match_command (mêmes contrôles, historique et rejeu) avec une clé
-- dérivée de la clé de la compo : un rejeu réseau renvoie les mêmes matchs, une erreur annule tout.
CREATE OR REPLACE FUNCTION public.team_compo_command(p_club uuid,p_rencontre uuid,p_data jsonb,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s jsonb; created jsonb; ids jsonb:='[]'; rank text; member uuid; updated integer:=0;
BEGIN
 IF NOT team_can_score(p_club) THEN RAISE EXCEPTION 'Accès membre requis.' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_data IS NULL OR jsonb_typeof(p_data->'simples') IS DISTINCT FROM 'array'
  OR jsonb_array_length(p_data->'simples') NOT BETWEEN 1 AND 12 THEN RAISE EXCEPTION 'Composition invalide.'; END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(p_data->'simples') ORDER BY (value->>'slot')::integer LOOP
  created:=team_match_command(p_club,p_rencontre,'create',jsonb_build_object('match_type','simple','slot',(s->>'slot')::integer,
   'joueurs_club',jsonb_build_array(s->'joueur_club'),'joueurs_adverse',jsonb_build_array(s->'joueur_adverse')),
   md5(p_request_id::text||':simple:'||(s->>'slot')::integer)::uuid);
  ids:=ids||jsonb_build_array(created->'id');
  -- team_match_command a déjà vérifié que member_id est un membre du club.
  member:=(s->'joueur_club'->>'member_id')::uuid; rank:=s->'joueur_club'->>'classement';
  IF member IS NOT NULL AND coalesce((s->>'update_classement')::boolean,false) AND rank IN
   ('NC','40','30/5','30/4','30/3','30/2','30/1','30','15/5','15/4','15/3','15/2','15/1','15','5/6','4/6','3/6','2/6','1/6','0','-2/6','-4/6','-15') THEN
   INSERT INTO profile_details(user_id,classement) VALUES(member,rank)
   ON CONFLICT(user_id) DO UPDATE SET classement=excluded.classement,revision=profile_details.revision+1,updated_at=now()
   WHERE profile_details.classement IS DISTINCT FROM excluded.classement;
   IF FOUND THEN updated:=updated+1; END IF;
  END IF;
 END LOOP;
 RETURN jsonb_build_object('ids',ids,'classements_mis_a_jour',updated);
END $$;
REVOKE ALL ON FUNCTION public.team_compo_command(uuid,uuid,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.team_compo_command(uuid,uuid,jsonb,uuid) TO authenticated;

COMMIT;
