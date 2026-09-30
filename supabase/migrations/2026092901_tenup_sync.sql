BEGIN;
ALTER TABLE public.team_rencontres
 ADD COLUMN tenup_url text,
 ADD COLUMN tenup_side integer CHECK (tenup_side IN (0,1)),
 ADD COLUMN tenup_synced_at timestamptz,
 ADD CONSTRAINT tenup_url_valid CHECK (tenup_url ~ '^https://tenup[.]fft[.]fr/championnat/[0-9]+/division/[0-9]+/phase/[0-9]+/poule/[0-9]+/rencontre/[0-9]+$');
-- Provenance is written only by the authenticated import command, never by
-- ordinary table updates from the BO.
CREATE FUNCTION public.guard_tenup_provenance() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF current_user NOT IN ('postgres','service_role','supabase_admin') THEN
  IF TG_OP='INSERT' THEN
   IF NEW.tenup_url IS NOT NULL OR NEW.tenup_side IS NOT NULL OR NEW.tenup_synced_at IS NOT NULL THEN
    RAISE EXCEPTION 'Utilisez la synchronisation Ten’Up pour modifier la source.'; END IF;
  ELSIF NEW.tenup_url IS DISTINCT FROM OLD.tenup_url OR NEW.tenup_side IS DISTINCT FROM OLD.tenup_side OR NEW.tenup_synced_at IS DISTINCT FROM OLD.tenup_synced_at THEN
   RAISE EXCEPTION 'Utilisez la synchronisation Ten’Up pour modifier la source.';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER team_tenup_provenance BEFORE INSERT OR UPDATE ON team_rencontres FOR EACH ROW EXECUTE FUNCTION guard_tenup_provenance();
REVOKE ALL ON FUNCTION public.guard_tenup_provenance() FROM PUBLIC,anon,authenticated;
CREATE UNIQUE INDEX team_tenup_source_unique ON public.team_rencontres(club_id,tenup_url) WHERE tenup_url IS NOT NULL;
CREATE TABLE public.team_tenup_previews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
 rencontre_id uuid NOT NULL REFERENCES team_rencontres(id) ON DELETE CASCADE,
 revision integer NOT NULL, source_url text NOT NULL,
 payload jsonb, result jsonb, applied_side integer,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes'
);
CREATE INDEX team_tenup_preview_rate ON public.team_tenup_previews(actor_id,created_at);
ALTER TABLE public.team_tenup_previews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.team_tenup_previews FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.team_tenup_previews TO service_role;

-- Only the server can attach the fetched sheet. A caller cannot label arbitrary
-- client JSON as a Ten'Up result; the UI only supplies a preview id and a side.
CREATE FUNCTION public.team_tenup_begin(p_club uuid,p_rencontre uuid,p_url text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r team_rencontres; pid uuid;
BEGIN
 IF NOT team_can_score(p_club) THEN RAISE EXCEPTION 'Accès membre requis.' USING ERRCODE='42501'; END IF;
 IF p_url IS NULL OR length(p_url)>500 OR p_url !~ '^https://tenup[.]fft[.]fr/championnat/[0-9]+/division/[0-9]+/phase/[0-9]+/poule/[0-9]+/rencontre/[0-9]+$' THEN RAISE EXCEPTION 'Lien de rencontre Ten’Up invalide.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('tenup:'||auth.uid()::text,0));
 DELETE FROM team_tenup_previews WHERE actor_id=auth.uid() AND created_at<now()-interval '1 day';
 IF (SELECT count(*) FROM team_tenup_previews WHERE actor_id=auth.uid() AND created_at>now()-interval '1 minute')>=3 THEN
  RAISE EXCEPTION 'Trop de demandes. Réessayez dans une minute.'; END IF;
 SELECT * INTO r FROM team_rencontres WHERE id=p_rencontre AND club_id=p_club;
 IF NOT FOUND THEN RAISE EXCEPTION 'Rencontre introuvable.'; END IF;
 IF r.wo THEN RAISE EXCEPTION 'Cette rencontre est déclarée WO.'; END IF;
 IF r.tenup_url IS NOT NULL AND r.tenup_url<>p_url THEN RAISE EXCEPTION 'Cette rencontre est déjà associée à un autre lien Ten’Up.'; END IF;
 IF EXISTS(SELECT 1 FROM team_rencontres WHERE club_id=p_club AND tenup_url=p_url AND id<>p_rencontre) THEN
  RAISE EXCEPTION 'Cette feuille Ten’Up est déjà associée à une autre rencontre.'; END IF;
 INSERT INTO team_tenup_previews(actor_id,club_id,rencontre_id,revision,source_url)
 VALUES(auth.uid(),p_club,p_rencontre,r.revision,p_url) RETURNING id INTO pid;
 RETURN jsonb_build_object('id',pid);
END $$;

CREATE FUNCTION public.team_tenup_players_key(players jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT string_agg(regexp_replace(translate(lower(btrim(coalesce(value->>'prenom','')||' '||coalesce(value->>'nom',''))),
 'àâäéèêëîïôöùûüç','aaaeeeeiioouuuc'),'[^a-z0-9]','','g'),'|' ORDER BY
 regexp_replace(translate(lower(btrim(coalesce(value->>'prenom','')||' '||coalesce(value->>'nom',''))),'àâäéèêëîïôöùûüç','aaaeeeeiioouuuc'),'[^a-z0-9]','','g'))
 FROM jsonb_array_elements(players)
$$;

CREATE FUNCTION public.team_tenup_apply(p_preview uuid,p_side integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE preview team_tenup_previews; r team_rencontres; l team_match_lines; comp team_competitions;
 item jsonb; aplayers jsonb; bplayers jsonb; scores jsonb; response jsonb;
 spec integer[]; imported integer:=0; skipped integer:=0; source_club integer:=0; source_adv integer:=0;
 wins_a integer; wins_b integer; setrow jsonb; i integer; winner text; mode live_set3_format;
 expected_count integer; line_id uuid; new_line boolean; protect_total boolean; notes jsonb:='[]';
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
 IF r.revision IS DISTINCT FROM preview.revision THEN RAISE EXCEPTION 'La rencontre a changé. Relancez la synchronisation.' USING ERRCODE='40001'; END IF;
 IF r.wo THEN RAISE EXCEPTION 'Cette rencontre est déclarée WO.'; END IF;
 IF r.tenup_url IS NOT NULL AND (r.tenup_url<>preview.source_url OR r.tenup_side IS DISTINCT FROM p_side) THEN
  RAISE EXCEPTION 'La feuille ou l’équipe ne correspond pas à la précédente synchronisation.'; END IF;
 IF (r.date_heure AT TIME ZONE 'Europe/Paris')::date IS DISTINCT FROM (preview.payload->>'date')::date THEN
  RAISE EXCEPTION 'La date Ten’Up ne correspond pas à celle de la rencontre. Vérifiez le lien ou corrigez la date.'; END IF;
 SELECT c.* INTO comp FROM team_etapes e JOIN team_equipes t ON t.id=e.equipe_id AND t.club_id=e.club_id
 JOIN team_competitions c ON c.id=t.competition_id AND c.club_id=t.club_id WHERE e.id=r.etape_id AND e.club_id=r.club_id;
 spec:=team_format_spec(comp.format); expected_count:=spec[1]+spec[2];
 protect_total:=(r.score_club IS NOT NULL OR r.score_adverse IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM team_match_lines WHERE rencontre_id=r.id);
 IF spec IS NULL OR jsonb_typeof(preview.payload->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(preview.payload->'lines')<>expected_count THEN
  RAISE EXCEPTION 'Le format Ten’Up ne correspond pas à la compétition.'; END IF;
 IF (SELECT count(DISTINCT ((v->>'match_type')||':'||(v->>'slot'))) FROM jsonb_array_elements(preview.payload->'lines') v)<>expected_count THEN
  RAISE EXCEPTION 'La feuille contient des matchs en double.'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(preview.payload->'lines') LOOP
  IF item->>'match_type' IS NULL OR item->>'match_type' NOT IN ('simple','double') OR (item->>'slot')::integer IS NULL OR
   (item->>'slot')::integer NOT BETWEEN 1 AND (CASE WHEN item->>'match_type'='simple' THEN spec[1] ELSE spec[2] END) THEN
   RAISE EXCEPTION 'Les places des matchs ne correspondent pas à la compétition.'; END IF;
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
   IF winner IS NULL OR i>2 OR wins_a=2 OR wins_b=2 THEN RAISE EXCEPTION 'Un score Ten’Up est incomplet ou incompatible avec les règles de la compétition.'; END IF;
   IF winner='club' THEN wins_a:=wins_a+1; ELSE wins_b:=wins_b+1; END IF; i:=i+1;
  END LOOP;
  IF wins_a<>2 AND wins_b<>2 THEN RAISE EXCEPTION 'La feuille Ten’Up contient un match non terminé.'; END IF;
  IF wins_a=2 THEN source_club:=source_club+CASE WHEN item->>'match_type'='double' THEN spec[3] ELSE 1 END;
  ELSE source_adv:=source_adv+CASE WHEN item->>'match_type'='double' THEN spec[3] ELSE 1 END; END IF;
  SELECT * INTO l FROM team_match_lines WHERE rencontre_id=r.id AND club_id=r.club_id AND match_type=item->>'match_type' AND slot=(item->>'slot')::integer;
  new_line:=NOT FOUND;
  -- Never change an existing result or any linked live, even an unfinished one.
  IF NOT new_line AND (l.live_match_id IS NOT NULL OR l.score IS NOT NULL OR l.gagnant IS NOT NULL OR l.confirmed_at IS NOT NULL OR l.sets<>'[]' OR
    team_tenup_players_key(l.joueurs_club) IS DISTINCT FROM team_tenup_players_key(aplayers) OR
    team_tenup_players_key(l.joueurs_adverse) IS DISTINCT FROM team_tenup_players_key(bplayers)) THEN
   skipped:=skipped+1;
   notes:=notes||jsonb_build_array(jsonb_build_object('match_type',l.match_type,'slot',l.slot,'reason','Résultat, suivi ou composition existant conservé.'));
   CONTINUE;
  END IF;
  IF new_line THEN
   response:=team_match_command(r.club_id,r.id,'create',jsonb_build_object('match_type',item->>'match_type','slot',item->'slot','joueurs_club',aplayers,'joueurs_adverse',bplayers),gen_random_uuid());
   line_id:=(response->>'id')::uuid;
   SELECT * INTO l FROM team_match_lines WHERE id=line_id;
  END IF;
  IF l.set3_format IS DISTINCT FROM mode THEN RAISE EXCEPTION 'La règle conservée avec un match diffère de la compétition. Vérifiez ce match manuellement.'; END IF;
  PERFORM team_match_command(r.club_id,r.id,'result',jsonb_build_object('id',l.id,'revision',l.revision,'kind','normal','sets',scores),gen_random_uuid());
  imported:=imported+1;
 END LOOP;
 IF source_club IS DISTINCT FROM (preview.payload->'scores'->>p_side)::integer OR source_adv IS DISTINCT FROM (preview.payload->'scores'->>(1-p_side))::integer THEN
  RAISE EXCEPTION 'Le total Ten’Up ne correspond pas aux matchs ou au barème de la compétition.'; END IF;
 IF protect_total AND (r.score_club IS DISTINCT FROM source_club OR r.score_adverse IS DISTINCT FROM source_adv) THEN
  RAISE EXCEPTION 'Un score global différent est déjà saisi. Vérifiez-le manuellement avant l’import.'; END IF;
 -- Full imports can use the existing encounter confirmation. Partial imports
 -- remain provisional until a member has reconciled all preserved results.
 IF skipped=0 THEN
  SELECT * INTO r FROM team_rencontres WHERE id=r.id;
  PERFORM team_match_command(r.club_id,r.id,'confirm',jsonb_build_object('revision',r.revision),gen_random_uuid());
 END IF;
 UPDATE team_rencontres SET tenup_url=preview.source_url,tenup_side=p_side,tenup_synced_at=now() WHERE id=r.id;
 response:=jsonb_build_object('imported',imported,'preserved',skipped,'notes',notes,'confirmed',skipped=0);
 UPDATE team_tenup_previews SET result=response,applied_side=p_side WHERE id=preview.id;
 RETURN response;
END $$;
REVOKE ALL ON FUNCTION public.team_tenup_begin(uuid,uuid,text),public.team_tenup_apply(uuid,integer),public.team_tenup_players_key(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.team_tenup_begin(uuid,uuid,text),public.team_tenup_apply(uuid,integer) TO authenticated;
COMMIT;
