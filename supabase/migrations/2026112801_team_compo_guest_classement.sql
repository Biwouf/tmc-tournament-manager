-- Compo d'équipe : classement (facultatif) d'un invité, saisi à l'ajout et modifiable ensuite.
-- team_compo_get renvoie le classement de l'invité dans `classement` (comme pour un membre).
-- team_compo_save accepte `classement` sur un nouvel invité et sur un invité déjà présent ({id, classement}) ;
-- un {id} sans la clé `classement` (client pas à jour) garde la valeur enregistrée.
-- Déployer avant le BO et la PWA. Aucun service distant modifié par la PR.
BEGIN;

ALTER TABLE public.team_match_players ADD COLUMN guest_classement text
 CONSTRAINT team_match_players_guest_classement_check CHECK (guest_classement IS NULL OR is_tennis_ranking(guest_classement)),
 ADD CONSTRAINT team_match_players_guest_classement_member CHECK (user_id IS NULL OR guest_classement IS NULL);

-- Reprise de 2026111902 : seul le classement de l'invité s'ajoute (coalesce avec profile_details).
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
   coalesce(d.classement,p.guest_classement) classement,coalesce(d.sex,p.guest_sex) sex,p.user_id IS NOT DISTINCT FROM me is_me,
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

-- Reprise de 2026111901 : `classement` facultatif sur un invité (nouveau ou déjà présent).
-- p_players : [{user_id}] membre, [{id, classement?}] invité déjà présent, [{prenom, nom?, sex?, classement?}] nouvel invité.
CREATE OR REPLACE FUNCTION public.team_compo_save(p_club uuid,p_rencontre uuid,p_players jsonb,p_version integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE me uuid:=auth.uid(); current_rev integer; author text; item jsonb; member uuid; guest uuid;
 g_prenom text; g_nom text; g_sex text; g_rank text; key text; label text;
 keep_users uuid[]:='{}'; keep_guests uuid[]:='{}'; keys text[]:='{}'; new_guests jsonb:='[]'; rank_updates jsonb:='[]';
BEGIN
 PERFORM team_compo_check_read(p_club,p_rencontre);
 IF NOT team_can_compose(p_club,p_rencontre) THEN RAISE EXCEPTION 'COMPO_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_players IS NULL OR jsonb_typeof(p_players)<>'array' THEN RAISE EXCEPTION 'COMPO_INVALID' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(p_players)>30 THEN RAISE EXCEPTION 'COMPO_TOO_LARGE' USING ERRCODE='22023'; END IF;

 -- Verrou de l'en-tête : deux enregistrements simultanés se sérialisent, le second voit la nouvelle révision.
 INSERT INTO team_match_compos(rencontre_id,club_id) VALUES(p_rencontre,p_club) ON CONFLICT DO NOTHING;
 SELECT revision INTO current_rev FROM team_match_compos WHERE rencontre_id=p_rencontre FOR UPDATE;
 IF current_rev<>coalesce(p_version,0) THEN
  SELECT btrim(coalesce(pr.prenom,'')) INTO author FROM team_match_compos h JOIN profiles pr ON pr.id=h.updated_by
   WHERE h.rencontre_id=p_rencontre;
  RAISE EXCEPTION 'COMPO_STALE' USING ERRCODE='PT409',DETAIL=coalesce(author,'');
 END IF;

 FOR item IN SELECT value FROM jsonb_array_elements(p_players) LOOP
  IF jsonb_typeof(item)<>'object' THEN RAISE EXCEPTION 'COMPO_INVALID' USING ERRCODE='22023'; END IF;
  IF item ? 'user_id' THEN
   member:=(item->>'user_id')::uuid;
   SELECT btrim(coalesce(pr.prenom,'')||' '||coalesce(pr.nom,'')) INTO label FROM club_members m
    JOIN profiles pr ON pr.id=m.user_id WHERE m.club_id=p_club AND m.user_id=member;
   IF NOT FOUND THEN RAISE EXCEPTION 'PLAYER_NOT_MEMBER' USING ERRCODE='22023'; END IF;
   IF member=ANY(keep_users) THEN RAISE EXCEPTION 'DUPLICATE_PLAYER' USING ERRCODE='23505',DETAIL=label; END IF;
   keep_users:=keep_users||member;
  ELSE
   g_rank:=nullif(btrim(coalesce(item->>'classement','')),'');
   IF g_rank IS NOT NULL AND NOT is_tennis_ranking(g_rank) THEN RAISE EXCEPTION 'COMPO_INVALID' USING ERRCODE='22023'; END IF;
   IF item ? 'id' THEN
    guest:=(item->>'id')::uuid;
    SELECT guest_prenom,guest_nom INTO g_prenom,g_nom FROM team_match_players
     WHERE id=guest AND rencontre_id=p_rencontre AND club_id=p_club AND user_id IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'COMPO_INVALID' USING ERRCODE='22023'; END IF;
    IF guest=ANY(keep_guests) THEN
     RAISE EXCEPTION 'DUPLICATE_PLAYER' USING ERRCODE='23505',DETAIL=btrim(g_prenom||' '||coalesce(g_nom,''));
    END IF;
    keep_guests:=keep_guests||guest;
    IF item ? 'classement' THEN rank_updates:=rank_updates||jsonb_build_object('id',guest,'classement',g_rank); END IF;
   ELSE
    g_prenom:=btrim(coalesce(item->>'prenom','')); g_nom:=nullif(btrim(coalesce(item->>'nom','')),'');
    g_sex:=nullif(item->>'sex','');
    IF length(g_prenom) NOT BETWEEN 1 AND 100 OR coalesce(length(g_nom),0)>100
     OR (g_sex IS NOT NULL AND g_sex NOT IN ('female','male')) THEN
     RAISE EXCEPTION 'COMPO_INVALID' USING ERRCODE='22023';
    END IF;
    new_guests:=new_guests||jsonb_build_object('prenom',g_prenom,'nom',g_nom,'sex',g_sex,'classement',g_rank);
   END IF;
   key:=team_compo_name_key(g_prenom)||'|'||team_compo_name_key(g_nom);
   IF key=ANY(keys) THEN
    RAISE EXCEPTION 'DUPLICATE_PLAYER' USING ERRCODE='23505',DETAIL=btrim(g_prenom||' '||coalesce(g_nom,''));
   END IF;
   keys:=keys||key;
  END IF;
 END LOOP;

 DELETE FROM team_match_players WHERE rencontre_id=p_rencontre AND club_id=p_club
  AND NOT (coalesce(user_id=ANY(keep_users),false) OR id=ANY(keep_guests));
 UPDATE team_match_players p SET guest_classement=u->>'classement' FROM jsonb_array_elements(rank_updates) u
  WHERE p.id=(u->>'id')::uuid AND p.guest_classement IS DISTINCT FROM u->>'classement';
 INSERT INTO team_match_players(club_id,rencontre_id,user_id,added_by)
  SELECT p_club,p_rencontre,u,me FROM unnest(keep_users) u ON CONFLICT (rencontre_id,user_id) DO NOTHING;
 INSERT INTO team_match_players(club_id,rencontre_id,guest_prenom,guest_nom,guest_sex,guest_classement,added_by)
  SELECT p_club,p_rencontre,g->>'prenom',g->>'nom',g->>'sex',g->>'classement',me FROM jsonb_array_elements(new_guests) g;
 UPDATE team_match_compos SET revision=revision+1,updated_at=now(),updated_by=me WHERE rencontre_id=p_rencontre;

 RETURN team_compo_get(p_club,p_rencontre);
END $$;

COMMIT;
