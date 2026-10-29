-- Abandons dans l'import Ten'Up : une ligne de la feuille peut porter
-- `retired` ('a' ou 'b', côté du joueur qui abandonne, lu sur le badge « A »).
-- Elle est enregistrée en résultat 'retired' (score suivi de « AB. »), vainqueur
-- = l'autre côté ; le dernier set peut être inachevé, et un match déjà gagné en
-- deux sets est refusé. Le reste de team_tenup_apply est inchangé
-- (cf. 2026101106_tenup_overwrite.sql).
BEGIN;
CREATE OR REPLACE FUNCTION public.team_tenup_apply(p_preview uuid,p_side integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE preview team_tenup_previews; r team_rencontres; l team_match_lines; m live_matches; comp team_competitions;
 item jsonb; aplayers jsonb; bplayers jsonb; scores jsonb; response jsonb; source_date date; opponent text;
 spec integer[]; imported integer:=0; source_club integer:=0; source_adv integer:=0;
 wins_a integer; wins_b integer; setrow jsonb; i integer; winner text; mode live_set3_format;
 expected_count integer; line_id uuid; retired text;
BEGIN
 SELECT * INTO preview FROM team_tenup_previews WHERE id=p_preview AND actor_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Aperçu introuvable.'; END IF;
 IF NOT team_can_score(preview.club_id) THEN RAISE EXCEPTION 'Accès membre requis.' USING ERRCODE='42501'; END IF;
 IF p_side IS NULL OR p_side NOT IN (0,1) THEN RAISE EXCEPTION 'Choisissez votre équipe.'; END IF;
 IF preview.result IS NOT NULL THEN
  IF preview.applied_side<>p_side THEN RAISE EXCEPTION 'Cet aperçu a déjà été validé pour une autre équipe.'; END IF;
  RETURN preview.result;
 END IF;
 IF preview.expires_at<now() OR preview.payload IS NULL THEN RAISE EXCEPTION 'Aperçu expiré ou indisponible. Relancez la synchronisation.'; END IF;
 -- Same order as team_match_command and live-score writes.
 PERFORM 1 FROM live_matches WHERE team_rencontre_id=preview.rencontre_id AND club_id=preview.club_id ORDER BY id FOR UPDATE;
 PERFORM 1 FROM team_match_lines WHERE rencontre_id=preview.rencontre_id AND club_id=preview.club_id ORDER BY id FOR UPDATE;
 SELECT * INTO r FROM team_rencontres WHERE id=preview.rencontre_id AND club_id=preview.club_id FOR UPDATE;
 IF NOT team_can_score(preview.club_id) THEN RAISE EXCEPTION 'Accès membre requis.' USING ERRCODE='42501'; END IF;
 IF r.revision IS DISTINCT FROM preview.revision THEN RAISE EXCEPTION 'La rencontre a changé. Relancez la synchronisation.' USING ERRCODE='PT409'; END IF;
 IF r.wo THEN RAISE EXCEPTION 'Cette rencontre est déclarée WO.'; END IF;
 IF r.tenup_url IS NOT NULL AND (r.tenup_url<>preview.source_url OR r.tenup_side IS DISTINCT FROM p_side) THEN
  RAISE EXCEPTION 'La feuille ou l’équipe ne correspond pas à la précédente synchronisation.'; END IF;
 source_date:=(preview.payload->>'date')::date;
 opponent:=nullif(btrim(preview.payload->'teams'->>(1-p_side)),'');
 IF source_date IS NULL OR opponent IS NULL THEN RAISE EXCEPTION 'La feuille Ten’Up est incomplète.'; END IF;
 SELECT c.* INTO comp FROM team_etapes e JOIN team_equipes t ON t.id=e.equipe_id AND t.club_id=e.club_id
 JOIN team_competitions c ON c.id=t.competition_id AND c.club_id=t.club_id WHERE e.id=r.etape_id AND e.club_id=r.club_id;
 spec:=team_format_spec(comp.format); expected_count:=spec[1]+spec[2];
 IF spec IS NULL OR jsonb_typeof(preview.payload->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(preview.payload->'lines')<>expected_count THEN
  RAISE EXCEPTION 'Le format Ten’Up ne correspond pas à la compétition.'; END IF;
 IF (SELECT count(DISTINCT ((v->>'match_type')||':'||(v->>'slot'))) FROM jsonb_array_elements(preview.payload->'lines') v)<>expected_count THEN
  RAISE EXCEPTION 'La feuille contient des matchs en double.'; END IF;
 -- Date (heure de Paris conservée) et adversaire officiels.
 IF (r.date_heure AT TIME ZONE 'Europe/Paris')::date IS DISTINCT FROM source_date OR r.club_adverse IS DISTINCT FROM opponent THEN
  UPDATE team_rencontres SET date_heure=(source_date+(date_heure AT TIME ZONE 'Europe/Paris')::time) AT TIME ZONE 'Europe/Paris',
   club_adverse=opponent WHERE id=r.id RETURNING * INTO r;
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(preview.payload->'lines') LOOP
  IF item->>'match_type' IS NULL OR item->>'match_type' NOT IN ('simple','double') OR (item->>'slot')::integer IS NULL OR
   (item->>'slot')::integer NOT BETWEEN 1 AND (CASE WHEN item->>'match_type'='simple' THEN spec[1] ELSE spec[2] END) THEN
   RAISE EXCEPTION 'Les places des matchs ne correspondent pas à la compétition.'; END IF;
  -- Abandon : côté (a/b) du joueur qui abandonne ; le dernier set peut être inachevé.
  retired:=item->>'retired';
  IF retired IS NOT NULL AND retired NOT IN ('a','b') THEN RAISE EXCEPTION 'Un résultat Ten’Up n’est pas reconnu.'; END IF;
  aplayers:=item->CASE WHEN p_side=0 THEN 'players_a' ELSE 'players_b' END;
  bplayers:=item->CASE WHEN p_side=0 THEN 'players_b' ELSE 'players_a' END;
  SELECT coalesce(jsonb_agg(jsonb_build_object('club',s->CASE WHEN p_side=0 THEN 'a' ELSE 'b' END,
   'adverse',s->CASE WHEN p_side=0 THEN 'b' ELSE 'a' END,
   'tb_club',s->CASE WHEN p_side=0 THEN 'tb_a' ELSE 'tb_b' END,
   'tb_adverse',s->CASE WHEN p_side=0 THEN 'tb_b' ELSE 'tb_a' END) ORDER BY ord),'[]') INTO scores
   FROM jsonb_array_elements(item->'sets') WITH ORDINALITY x(s,ord);
  mode:=CASE WHEN item->>'match_type'='double' THEN 'super_tiebreak'::live_set3_format ELSE comp.singles_set3_format END;
  IF mode IS NULL THEN RAISE EXCEPTION 'Renseignez le troisième set des simples dans la compétition.'; END IF;
  wins_a:=0; wins_b:=0; i:=0;
  FOR setrow IN SELECT value FROM jsonb_array_elements(scores) LOOP
   winner:=team_set_winner((setrow->>'club')::integer,(setrow->>'adverse')::integer,i=2 AND mode='super_tiebreak');
   IF (winner IS NULL AND (retired IS NULL OR i<jsonb_array_length(scores)-1)) OR i>2 OR wins_a=2 OR wins_b=2 THEN RAISE EXCEPTION 'Un score Ten’Up est incomplet ou incompatible avec les règles de la compétition.'; END IF;
   IF winner='club' THEN wins_a:=wins_a+1; ELSIF winner='adverse' THEN wins_b:=wins_b+1; END IF; i:=i+1;
  END LOOP;
  IF retired IS NULL THEN
   IF wins_a<>2 AND wins_b<>2 THEN RAISE EXCEPTION 'La feuille Ten’Up contient un match non terminé.'; END IF;
   winner:=CASE WHEN wins_a=2 THEN 'club' ELSE 'adverse' END;
  ELSE
   IF wins_a=2 OR wins_b=2 THEN RAISE EXCEPTION 'Un score Ten’Up est incomplet ou incompatible avec les règles de la compétition.'; END IF;
   winner:=CASE WHEN (retired='a')=(p_side=0) THEN 'adverse' ELSE 'club' END;
  END IF;
  IF winner='club' THEN source_club:=source_club+CASE WHEN item->>'match_type'='double' THEN spec[3] ELSE 1 END;
  ELSE source_adv:=source_adv+CASE WHEN item->>'match_type'='double' THEN spec[3] ELSE 1 END; END IF;
  SELECT * INTO l FROM team_match_lines WHERE rencontre_id=r.id AND club_id=r.club_id AND match_type=item->>'match_type' AND slot=(item->>'slot')::integer;
  IF NOT FOUND THEN
   response:=team_match_command(r.club_id,r.id,'create',jsonb_build_object('match_type',item->>'match_type','slot',item->'slot','joueurs_club',aplayers,'joueurs_adverse',bplayers),gen_random_uuid());
   line_id:=(response->>'id')::uuid;
   SELECT * INTO l FROM team_match_lines WHERE id=line_id;
  ELSE
   -- Composition officielle ; le lien membre suit le même joueur.
   SELECT coalesce(jsonb_agg(p||coalesce((SELECT jsonb_build_object('member_id',q->'member_id') FROM jsonb_array_elements(l.joueurs_club) q
     WHERE q->>'member_id' IS NOT NULL AND team_tenup_players_key(jsonb_build_array(q))=team_tenup_players_key(jsonb_build_array(p)) LIMIT 1),'{}') ORDER BY ord),'[]')
    INTO aplayers FROM jsonb_array_elements(aplayers) WITH ORDINALITY x(p,ord);
   UPDATE team_match_lines SET joueurs_club=aplayers,joueurs_adverse=bplayers,set3_format=coalesce(set3_format,mode)
    WHERE id=l.id AND (joueurs_club IS DISTINCT FROM aplayers OR joueurs_adverse IS DISTINCT FROM bplayers OR set3_format IS NULL);
   IF l.live_match_id IS NOT NULL THEN
    UPDATE live_matches SET match_date=source_date,j2_club=opponent,
     j1_prenom=coalesce(aplayers->0->>'prenom',''),j1_nom=coalesce(aplayers->0->>'nom',''),j1_classement=coalesce(aplayers->0->>'classement','NC'),
     j2_prenom=coalesce(bplayers->0->>'prenom',''),j2_nom=coalesce(bplayers->0->>'nom',''),j2_classement=coalesce(bplayers->0->>'classement','NC'),
     j3_prenom=aplayers->1->>'prenom',j3_nom=aplayers->1->>'nom',j3_classement=aplayers->1->>'classement',
     j4_prenom=bplayers->1->>'prenom',j4_nom=bplayers->1->>'nom',j4_classement=bplayers->1->>'classement'
     WHERE id=l.live_match_id;
   END IF;
   -- Les mises à jour ci-dessus changent les révisions (ligne et live).
   SELECT * INTO l FROM team_match_lines WHERE id=l.id;
  END IF;
  IF l.set3_format IS DISTINCT FROM mode THEN RAISE EXCEPTION 'La règle conservée avec un match diffère de la compétition. Vérifiez ce match manuellement.'; END IF;
  IF l.live_match_id IS NOT NULL THEN SELECT * INTO m FROM live_matches WHERE id=l.live_match_id; END IF;
  PERFORM team_match_command(r.club_id,r.id,'result',jsonb_build_object('id',l.id,'revision',l.revision,'kind',CASE WHEN retired IS NULL THEN 'normal' ELSE 'retired' END,'sets',scores)||
   CASE WHEN retired IS NOT NULL THEN jsonb_build_object('winner',winner) ELSE '{}' END||
   CASE WHEN l.live_match_id IS NOT NULL THEN jsonb_build_object('live_revision',m.revision) ELSE '{}' END,gen_random_uuid());
  imported:=imported+1;
 END LOOP;
 IF source_club IS DISTINCT FROM (preview.payload->'scores'->>p_side)::integer OR source_adv IS DISTINCT FROM (preview.payload->'scores'->>(1-p_side))::integer THEN
  RAISE EXCEPTION 'Le total Ten’Up ne correspond pas aux matchs ou au barème de la compétition.'; END IF;
 SELECT * INTO r FROM team_rencontres WHERE id=r.id;
 PERFORM team_match_command(r.club_id,r.id,'confirm',jsonb_build_object('revision',r.revision),gen_random_uuid());
 UPDATE team_rencontres SET tenup_url=preview.source_url,tenup_side=p_side,tenup_synced_at=now() WHERE id=r.id;
 response:=jsonb_build_object('imported',imported,'preserved',0,'notes','[]'::jsonb,'confirmed',true);
 UPDATE team_tenup_previews SET result=response,applied_side=p_side WHERE id=preview.id;
 RETURN response;
END $$;
COMMIT;
