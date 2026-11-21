-- Compo d'équipe, PR2 : team_compo_get renvoie user_id des membres à qui peut modifier la compo,
-- pour que l'éditeur renvoie la liste à team_compo_save ({user_id}). Lecteur simple : null.
-- Déployer avant la PWA. Aucun service distant modifié par la PR.
BEGIN;
CREATE OR REPLACE FUNCTION public.team_compo_get(p_club uuid,p_rencontre uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE me uuid:=auth.uid(); editor boolean; equipe uuid; fmt text; gnr text; spec integer[]; head team_match_compos;
 show_sex boolean; players jsonb; captains jsonb; updater jsonb;
BEGIN
 PERFORM team_compo_check_read(p_club,p_rencontre);
 editor:=team_can_compose(p_club,p_rencontre);
 SELECT et.equipe_id,c.format,c.genre INTO equipe,fmt,gnr FROM team_rencontres r
  JOIN team_etapes et ON et.id=r.etape_id JOIN team_equipes e ON e.id=et.equipe_id
  JOIN team_competitions c ON c.id=e.competition_id WHERE r.id=p_rencontre;
 spec:=team_format_spec(fmt);
 -- Le sexe sert à grouper en mixte et à filtrer pour qui compose ; il n'est pas exposé sinon.
 show_sex:=editor OR gnr='mixte';
 SELECT * INTO head FROM team_match_compos WHERE rencontre_id=p_rencontre;

 SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'user_id',CASE WHEN editor THEN x.user_id END,'is_guest',x.is_guest,'prenom',x.prenom,'nom',x.nom,
   'initials',upper(left(btrim(x.prenom),1)||left(btrim(x.nom),1)),'classement',x.classement,
   'is_captain',x.is_captain,'is_me',x.is_me,'sex',CASE WHEN show_sex THEN x.sex END)
   ORDER BY lower(x.nom),lower(x.prenom)),'[]') INTO players
 FROM (SELECT p.id,p.user_id,p.user_id IS NULL is_guest,
   coalesce(pr.prenom,p.guest_prenom,'') prenom,coalesce(pr.nom,p.guest_nom,'') nom,
   d.classement,coalesce(d.sex,p.guest_sex) sex,p.user_id IS NOT DISTINCT FROM me is_me,
   EXISTS(SELECT 1 FROM team_equipe_captains cap WHERE cap.equipe_id=equipe AND cap.user_id=p.user_id) is_captain
  FROM team_match_players p LEFT JOIN profiles pr ON pr.id=p.user_id LEFT JOIN profile_details d ON d.user_id=p.user_id
  WHERE p.rencontre_id=p_rencontre AND p.club_id=p_club) x;

 SELECT coalesce(jsonb_agg(jsonb_build_object('prenom',pr.prenom,'nom',pr.nom) ORDER BY pr.nom,pr.prenom),'[]') INTO captains
 FROM team_equipe_captains cap JOIN profiles pr ON pr.id=cap.user_id
 WHERE cap.equipe_id=equipe AND cap.club_id=p_club;

 IF head.updated_by IS NOT NULL AND head.revision>0 THEN
  SELECT jsonb_build_object('prenom',pr.prenom,'nom',pr.nom,'role',CASE WHEN EXISTS(SELECT 1 FROM team_equipe_captains cap
    WHERE cap.equipe_id=equipe AND cap.user_id=head.updated_by) THEN 'capitaine' ELSE 'admin' END)
   INTO updater FROM profiles pr WHERE pr.id=head.updated_by;
 END IF;

 RETURN jsonb_build_object('players',players,'captains',captains,'version',coalesce(head.revision,0),
  'updated_at',CASE WHEN head.revision>0 THEN head.updated_at END,'updated_by',updater,'can_edit',editor,
  'min_players',CASE WHEN spec IS NOT NULL THEN greatest(spec[1],2*spec[2]) END,
  'simples',spec[1],'doubles',spec[2],'format',fmt,'genre',gnr);
END $$;
COMMIT;
