-- Les résultats des lives d’équipes suivent aussi les droits partagés des membres.
-- Conserve les verrous, révisions, règles, confirmations et clés de requête existants.
BEGIN;
CREATE OR REPLACE FUNCTION public.team_match_command(p_club uuid,p_rencontre uuid,p_operation text,p_data jsonb,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r team_rencontres; l team_match_lines; m live_matches; c team_competitions; saved team_match_commands;
 spec integer[]; output jsonb; players jsonb; player jsonb; n integer; i integer; a integer; b integer; w text;
 wins_club integer:=0; wins_adv integer:=0; winner_value text; score_value text:=''; kind text; scores jsonb; s jsonb;
 line_id uuid; live_id uuid; mode_value live_set3_format;
BEGIN
 IF NOT team_can_score(p_club) THEN RAISE EXCEPTION 'Accès membre requis.' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_data IS NULL OR jsonb_typeof(p_data)<>'object' THEN RAISE EXCEPTION 'Commande invalide.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
 SELECT * INTO saved FROM team_match_commands WHERE actor_id=auth.uid() AND request_id=p_request_id;
 IF FOUND THEN
  IF saved.club_id<>p_club OR saved.rencontre_id<>p_rencontre OR saved.operation<>p_operation OR saved.payload<>p_data THEN RAISE EXCEPTION 'Identifiant de commande déjà utilisé.'; END IF;
  RETURN saved.result;
 END IF;
 -- Lock order: live -> line -> encounter (also used by the Live invalidation trigger).
 IF p_operation='confirm' THEN
  PERFORM 1 FROM live_matches WHERE team_rencontre_id=p_rencontre AND club_id=p_club ORDER BY id FOR UPDATE;
  PERFORM 1 FROM team_match_lines WHERE rencontre_id=p_rencontre AND club_id=p_club ORDER BY id FOR UPDATE;
 ELSIF p_operation<>'create' THEN
  line_id:=(p_data->>'id')::uuid;
  SELECT live_match_id INTO live_id FROM team_match_lines WHERE id=line_id AND rencontre_id=p_rencontre AND club_id=p_club;
  IF NOT FOUND THEN RAISE EXCEPTION 'Match introuvable.'; END IF;
  IF live_id IS NOT NULL THEN SELECT * INTO m FROM live_matches WHERE id=live_id AND club_id=p_club FOR UPDATE; END IF;
  SELECT * INTO l FROM team_match_lines WHERE id=line_id AND rencontre_id=p_rencontre AND club_id=p_club FOR UPDATE;
  IF l.revision IS DISTINCT FROM (p_data->>'revision')::integer OR l.live_match_id IS DISTINCT FROM live_id THEN
   RAISE EXCEPTION 'Le match a changé. Rechargez la rencontre avant de réessayer.' USING ERRCODE='40001'; END IF;
  IF live_id IS NOT NULL AND m.revision IS DISTINCT FROM (p_data->>'live_revision')::integer THEN
   RAISE EXCEPTION 'Le live a changé. Rechargez son score avant de réessayer.' USING ERRCODE='40001'; END IF;
 END IF;
 SELECT * INTO r FROM team_rencontres WHERE id=p_rencontre AND club_id=p_club FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Rencontre introuvable.'; END IF;
 IF NOT team_can_score(p_club) THEN RAISE EXCEPTION 'Accès membre requis.' USING ERRCODE='42501'; END IF;
 SELECT comp.* INTO c FROM team_etapes e JOIN team_equipes t ON t.id=e.equipe_id AND t.club_id=e.club_id
 JOIN team_competitions comp ON comp.id=t.competition_id AND comp.club_id=t.club_id WHERE e.id=r.etape_id AND e.club_id=p_club;
 IF NOT FOUND THEN RAISE EXCEPTION 'Compétition introuvable.'; END IF;
 spec:=team_format_spec(c.format);
 IF r.wo THEN RAISE EXCEPTION 'Cette rencontre est déclarée WO. Corrigez-la dans son administration avant de composer les matchs.'; END IF;

 IF p_operation='create' THEN
  IF p_data->>'match_type' NOT IN ('simple','double') OR p_data->>'match_type' IS NULL THEN RAISE EXCEPTION 'Type de match invalide.'; END IF;
  n:=CASE WHEN p_data->>'match_type'='double' THEN 2 ELSE 1 END;
  FOREACH kind IN ARRAY ARRAY['joueurs_club','joueurs_adverse'] LOOP
   players:=p_data->kind;
   IF jsonb_typeof(players) IS DISTINCT FROM 'array' OR jsonb_array_length(players)<>n THEN RAISE EXCEPTION 'Composition incomplète.'; END IF;
   FOR player IN SELECT value FROM jsonb_array_elements(players) LOOP
    IF length(btrim(coalesce(player->>'prenom','')||' '||coalesce(player->>'nom','')))=0 OR length(player::text)>1000
      OR length(btrim(coalesce(player->>'classement','')))=0 THEN RAISE EXCEPTION 'Nom et classement requis.'; END IF;
    IF kind='joueurs_club' AND player->>'member_id' IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM club_members WHERE club_id=p_club AND user_id=(player->>'member_id')::uuid) THEN RAISE EXCEPTION 'Membre du club introuvable.'; END IF;
   END LOOP;
  END LOOP;
  INSERT INTO team_match_lines(club_id,rencontre_id,match_type,slot,joueurs_club,joueurs_adverse)
   VALUES(p_club,p_rencontre,p_data->>'match_type',(p_data->>'slot')::integer,p_data->'joueurs_club',p_data->'joueurs_adverse') RETURNING * INTO l;
 ELSIF p_operation='resolve_rule' THEN
  IF l.set3_format IS NOT NULL THEN RAISE EXCEPTION 'La règle est déjà définie.'; END IF;
  mode_value:=(p_data->>'set3_format')::live_set3_format;
  IF mode_value IS NULL OR (l.match_type='double' AND mode_value<>'super_tiebreak') THEN RAISE EXCEPTION 'Règle invalide.'; END IF;
  IF live_id IS NOT NULL THEN
   IF m.set3_format IS NOT NULL AND m.set3_format<>mode_value THEN RAISE EXCEPTION 'Le live possède déjà une autre règle.'; END IF;
   UPDATE live_matches SET set3_format=mode_value WHERE id=live_id;
  END IF;
  UPDATE team_match_lines SET set3_format=mode_value WHERE id=l.id RETURNING * INTO l;
 ELSIF p_operation='start_live' THEN
  IF l.set3_format IS NULL THEN RAISE EXCEPTION 'Précisez la règle de ce match historique avant de lancer le live.'; END IF;
  IF l.result_kind='wo' THEN RAISE EXCEPTION 'Corrigez le résultat WO avant de lancer le live.'; END IF;
  IF live_id IS NULL THEN
   IF l.score IS NOT NULL AND jsonb_array_length(l.sets)=0 THEN RAISE EXCEPTION 'Vérifiez le score historique dans Saisir le résultat avant de lancer le live.'; END IF;
   INSERT INTO live_matches(club_id,match_date,match_type,j1_prenom,j1_nom,j1_classement,j1_club,j2_prenom,j2_nom,j2_classement,j2_club,
    j3_prenom,j3_nom,j3_classement,j4_prenom,j4_nom,j4_classement,set3_format,team_match_line_id,team_rencontre_id,status,scored_by,started_at,
    set1_j1,set1_j2,set1_tb_j1,set1_tb_j2,set2_j1,set2_j2,set2_tb_j1,set2_tb_j2,set3_j1,set3_j2,set3_tb_j1,set3_tb_j2)
   VALUES(p_club,(r.date_heure AT TIME ZONE 'Europe/Paris')::date,l.match_type::live_match_type,
    coalesce(l.joueurs_club->0->>'prenom',''),coalesce(l.joueurs_club->0->>'nom',''),coalesce(l.joueurs_club->0->>'classement','NC'),(SELECT name FROM clubs WHERE id=p_club),
    coalesce(l.joueurs_adverse->0->>'prenom',''),coalesce(l.joueurs_adverse->0->>'nom',''),coalesce(l.joueurs_adverse->0->>'classement','NC'),r.club_adverse,
    l.joueurs_club->1->>'prenom',l.joueurs_club->1->>'nom',l.joueurs_club->1->>'classement',l.joueurs_adverse->1->>'prenom',l.joueurs_adverse->1->>'nom',l.joueurs_adverse->1->>'classement',
    l.set3_format,l.id,r.id,'live',auth.uid(),now(),
    (l.sets->0->>'club')::smallint,(l.sets->0->>'adverse')::smallint,(l.sets->0->>'tb_club')::smallint,(l.sets->0->>'tb_adverse')::smallint,
    (l.sets->1->>'club')::smallint,(l.sets->1->>'adverse')::smallint,(l.sets->1->>'tb_club')::smallint,(l.sets->1->>'tb_adverse')::smallint,
    (l.sets->2->>'club')::smallint,(l.sets->2->>'adverse')::smallint,(l.sets->2->>'tb_club')::smallint,(l.sets->2->>'tb_adverse')::smallint) RETURNING * INTO m;
   UPDATE team_match_lines SET live_match_id=m.id,gagnant=NULL,confirmed_at=NULL,result_kind=NULL WHERE id=l.id RETURNING * INTO l;
  ELSE
   IF m.set3_format IS DISTINCT FROM l.set3_format THEN
    IF m.set3_format IS NOT NULL THEN RAISE EXCEPTION 'La règle du live diffère de celle du match.'; END IF;
    UPDATE live_matches SET set3_format=l.set3_format WHERE id=m.id RETURNING * INTO m;
   END IF;
   -- Opening an existing live never steals it or reopens a completed match.
   IF m.status='pending' THEN UPDATE live_matches SET status='live',scored_by=auth.uid(),started_at=coalesce(started_at,now()) WHERE id=m.id RETURNING * INTO m; END IF;
  END IF;
 ELSIF p_operation='result' THEN
  kind:=p_data->>'kind'; scores:=p_data->'sets';
  IF kind IS NULL OR kind NOT IN ('normal','wo','retired') OR jsonb_typeof(scores) IS DISTINCT FROM 'array' OR jsonb_array_length(scores)>3 THEN RAISE EXCEPTION 'Résultat invalide.'; END IF;
  IF kind='normal' AND l.set3_format IS NULL THEN RAISE EXCEPTION 'Précisez la règle du troisième set.'; END IF;
  IF kind='wo' AND jsonb_array_length(scores)<>0 THEN RAISE EXCEPTION 'Un WO ne comporte pas de score.'; END IF;
  FOR i IN 0..jsonb_array_length(scores)-1 LOOP
   s:=scores->i;
   IF jsonb_typeof(s->'club') IS DISTINCT FROM 'number' OR jsonb_typeof(s->'adverse') IS DISTINCT FROM 'number'
    OR (s->>'club') !~ '^[0-9]+$' OR (s->>'adverse') !~ '^[0-9]+$' THEN RAISE EXCEPTION 'Score numérique entier requis.'; END IF;
   a:=(s->>'club')::integer; b:=(s->>'adverse')::integer;
   IF a>32767 OR b>32767 OR (i<2 AND greatest(a,b)>7) OR (i=2 AND l.set3_format='normal' AND greatest(a,b)>7) THEN RAISE EXCEPTION 'Score hors limites.'; END IF;
   IF wins_club=2 OR wins_adv=2 OR (i=2 AND (wins_club<>1 OR wins_adv<>1)) THEN RAISE EXCEPTION 'Sets incohérents.'; END IF;
   w:=team_set_winner(a,b,i=2 AND l.set3_format='super_tiebreak');
   IF w IS NULL AND (kind='normal' OR i<jsonb_array_length(scores)-1) THEN RAISE EXCEPTION 'Set incomplet ou invalide.'; END IF;
   IF w IS NULL AND kind='retired' AND NOT (
    CASE WHEN i=2 AND l.set3_format='super_tiebreak' THEN greatest(a,b)<10 OR abs(a-b)<=1
    ELSE greatest(a,b)<=5 OR (greatest(a,b)=6 AND least(a,b)>=5) END
   ) THEN RAISE EXCEPTION 'Score impossible au moment de l’abandon.'; END IF;
   IF w='club' THEN wins_club:=wins_club+1; ELSIF w='adverse' THEN wins_adv:=wins_adv+1; END IF;
   IF s->>'tb_club' IS NOT NULL OR s->>'tb_adverse' IS NOT NULL THEN
    IF s->>'tb_club' IS NULL OR s->>'tb_adverse' IS NULL OR (s->>'tb_club') !~ '^[0-9]+$' OR (s->>'tb_adverse') !~ '^[0-9]+$'
     OR greatest((s->>'tb_club')::integer,(s->>'tb_adverse')::integer)>32767
     OR (i=2 AND l.set3_format='super_tiebreak') THEN RAISE EXCEPTION 'Tie-break incohérent.'; END IF;
    IF a=6 AND b=6 AND kind='retired' THEN
     IF NOT (greatest((s->>'tb_club')::integer,(s->>'tb_adverse')::integer)<7 OR abs((s->>'tb_club')::integer-(s->>'tb_adverse')::integer)<=1) THEN RAISE EXCEPTION 'Tie-break déjà terminé.'; END IF;
    ELSIF greatest(a,b)<>7 OR least(a,b)<>6
     OR NOT ((greatest((s->>'tb_club')::integer,(s->>'tb_adverse')::integer)=7 AND least((s->>'tb_club')::integer,(s->>'tb_adverse')::integer)<=5)
       OR (greatest((s->>'tb_club')::integer,(s->>'tb_adverse')::integer)>7 AND abs((s->>'tb_club')::integer-(s->>'tb_adverse')::integer)=2))
     OR (a>b) IS DISTINCT FROM ((s->>'tb_club')::integer>(s->>'tb_adverse')::integer) THEN RAISE EXCEPTION 'Tie-break incohérent.'; END IF;
   END IF;
   score_value:=score_value||CASE WHEN i>0 THEN ' ' ELSE '' END||a||'-'||b;
  END LOOP;
  IF kind='normal' THEN
   IF wins_club<>2 AND wins_adv<>2 THEN RAISE EXCEPTION 'Un vainqueur est requis.'; END IF;
   winner_value:=CASE WHEN wins_club=2 THEN 'club' ELSE 'adverse' END;
  ELSE
   winner_value:=p_data->>'winner';
   IF winner_value IS NULL OR winner_value NOT IN ('club','adverse') THEN RAISE EXCEPTION 'Indiquez le vainqueur.'; END IF;
   IF kind='retired' AND (wins_club=2 OR wins_adv=2) THEN RAISE EXCEPTION 'Le score indique un match déjà terminé.'; END IF;
   score_value:=btrim(score_value||' '||CASE WHEN kind='wo' THEN 'WO' ELSE 'AB.' END);
  END IF;
  IF live_id IS NOT NULL THEN
   UPDATE live_matches SET
    set1_j1=(scores->0->>'club')::smallint,set1_j2=(scores->0->>'adverse')::smallint,set1_tb_j1=(scores->0->>'tb_club')::smallint,set1_tb_j2=(scores->0->>'tb_adverse')::smallint,
    set2_j1=(scores->1->>'club')::smallint,set2_j2=(scores->1->>'adverse')::smallint,set2_tb_j1=(scores->1->>'tb_club')::smallint,set2_tb_j2=(scores->1->>'tb_adverse')::smallint,
    set3_j1=(scores->2->>'club')::smallint,set3_j2=(scores->2->>'adverse')::smallint,set3_tb_j1=(scores->2->>'tb_club')::smallint,set3_tb_j2=(scores->2->>'tb_adverse')::smallint,
    status='finished',winner=CASE WHEN winner_value='club' THEN 'j1' ELSE 'j2' END::live_match_winner,
    retired_player=CASE WHEN kind='retired' THEN CASE WHEN winner_value='club' THEN 'j2' ELSE 'j1' END::live_match_winner ELSE NULL END,
    finished_at=coalesce(finished_at,now()),scored_by=auth.uid() WHERE id=m.id;
   UPDATE live_matches SET team_result_confirmed=true WHERE id=m.id;
  END IF;
  UPDATE team_match_lines SET gagnant=winner_value,score=score_value,sets=scores,result_kind=kind,confirmed_at=now() WHERE id=l.id RETURNING * INTO l;
 ELSIF p_operation='confirm' THEN
  IF r.revision IS DISTINCT FROM (p_data->>'revision')::integer THEN RAISE EXCEPTION 'La rencontre a changé. Vérifiez le récapitulatif.' USING ERRCODE='40001'; END IF;
  IF (SELECT count(*) FROM team_match_lines WHERE rencontre_id=r.id)<>spec[1]+spec[2]
   OR (SELECT count(*) FROM team_match_lines WHERE rencontre_id=r.id AND match_type='simple' AND slot BETWEEN 1 AND spec[1] AND gagnant IS NOT NULL AND confirmed_at IS NOT NULL)<>spec[1]
   OR (SELECT count(*) FROM team_match_lines WHERE rencontre_id=r.id AND match_type='double' AND slot BETWEEN 1 AND spec[2] AND gagnant IS NOT NULL AND confirmed_at IS NOT NULL)<>spec[2]
   THEN RAISE EXCEPTION 'Tous les matchs prévus doivent avoir un résultat validé, WO compris.'; END IF;
  UPDATE team_rencontres SET confirmed_at=now(),confirmed_by=auth.uid(),revision=revision+1 WHERE id=r.id;
 ELSE RAISE EXCEPTION 'Commande inconnue.';
 END IF;
 output:=jsonb_build_object('id',l.id,'live_match_id',coalesce(l.live_match_id,m.id),'rencontre_id',r.id);
 INSERT INTO team_match_commands(actor_id,request_id,club_id,rencontre_id,operation,payload,result)
 VALUES(auth.uid(),p_request_id,p_club,p_rencontre,p_operation,p_data,output);
 RETURN output;
END $$;
REVOKE ALL ON FUNCTION public.team_match_command(uuid,uuid,text,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.team_match_command(uuid,uuid,text,jsonb,uuid) TO authenticated;
COMMIT;
