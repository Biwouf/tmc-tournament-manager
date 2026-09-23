BEGIN;
ALTER TABLE public.team_rencontres ADD COLUMN revision integer NOT NULL DEFAULT 0,
  ADD COLUMN confirmed_at timestamptz, ADD COLUMN confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.team_match_lines ADD COLUMN revision integer NOT NULL DEFAULT 0,
  ADD COLUMN slot integer, ADD COLUMN sets jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN result_kind text CHECK (result_kind IN ('normal','wo','retired')),
  ADD COLUMN confirmed_at timestamptz;
WITH numbered AS (SELECT id,row_number() OVER(PARTITION BY rencontre_id,match_type ORDER BY ordre,created_at,id) AS n FROM team_match_lines)
UPDATE team_match_lines l SET slot=n.n FROM numbered n WHERE n.id=l.id;
ALTER TABLE public.team_match_lines ADD CONSTRAINT team_match_slot_unique UNIQUE(rencontre_id,match_type,slot),
  ADD CONSTRAINT team_match_slot_positive CHECK(slot>0);
CREATE UNIQUE INDEX team_line_live_unique ON public.team_match_lines(live_match_id) WHERE live_match_id IS NOT NULL;
ALTER TABLE public.live_matches ADD COLUMN team_match_line_id uuid REFERENCES public.team_match_lines(id) ON DELETE SET NULL,
  ADD COLUMN team_rencontre_id uuid REFERENCES public.team_rencontres(id) ON DELETE SET NULL,
  ADD COLUMN team_result_confirmed boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX live_team_line_unique ON public.live_matches(team_match_line_id) WHERE team_match_line_id IS NOT NULL;
-- Existing links are retained without guessing a missing rule or changing an old score.
UPDATE live_matches m SET team_match_line_id=l.id,team_rencontre_id=l.rencontre_id
FROM team_match_lines l WHERE l.live_match_id=m.id AND l.club_id=m.club_id;

CREATE TABLE public.team_match_commands (
 actor_id uuid NOT NULL, request_id uuid NOT NULL, club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
 rencontre_id uuid NOT NULL, operation text NOT NULL, payload jsonb NOT NULL, result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(actor_id,request_id)
);
ALTER TABLE public.team_match_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.team_match_commands FROM anon,authenticated;

CREATE FUNCTION public.team_can_score(p_club uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM clubs c WHERE c.id=p_club AND c.status='active')
 AND (EXISTS(SELECT 1 FROM club_members m WHERE m.club_id=p_club AND m.user_id=auth.uid()) OR is_super_admin())
$$;
REVOKE ALL ON FUNCTION public.team_can_score(uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.team_format_spec(p_format text) RETURNS integer[] LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE p_format WHEN '2S1D' THEN ARRAY[2,1,1] WHEN '3S1D2' THEN ARRAY[3,1,2]
 WHEN '4S1D2' THEN ARRAY[4,1,2] WHEN '4S2D' THEN ARRAY[4,2,1] END
$$;

-- One shared definition of legal set scores, used for direct entry and confirmation.
CREATE FUNCTION public.team_set_winner(a integer,b integer,super_tb boolean) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN a IS NULL OR b IS NULL OR a<0 OR b<0 THEN NULL
 WHEN super_tb AND ((greatest(a,b)=10 AND least(a,b)<=8) OR (greatest(a,b)>10 AND abs(a-b)=2))
   THEN CASE WHEN a>b THEN 'club' ELSE 'adverse' END
 WHEN NOT super_tb AND ((greatest(a,b)=6 AND least(a,b)<=4) OR (greatest(a,b)=7 AND least(a,b) IN (5,6)))
   THEN CASE WHEN a>b THEN 'club' ELSE 'adverse' END END
$$;

-- Snapshot remains immutable. A historical unknown rule can only be resolved by
-- an explicit server command; changing the competition never rewrites old matches.
CREATE OR REPLACE FUNCTION public.snapshot_team_match_rules() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE configured live_set3_format;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.club_id IS DISTINCT FROM OLD.club_id OR NEW.rencontre_id IS DISTINCT FROM OLD.rencontre_id OR NEW.match_type IS DISTINCT FROM OLD.match_type THEN
   RAISE EXCEPTION 'Le club, la rencontre et le type du match sont conservés.'; END IF;
  IF NEW.set3_format IS DISTINCT FROM OLD.set3_format AND NOT
   (OLD.set3_format IS NULL AND current_user IN ('postgres','service_role','supabase_admin')) THEN
   RAISE EXCEPTION 'La règle du troisième set est conservée avec le match.'; END IF;
  RETURN NEW;
 END IF;
 SELECT c.singles_set3_format INTO configured FROM team_rencontres r
 JOIN team_etapes e ON e.id=r.etape_id AND e.club_id=r.club_id
 JOIN team_equipes t ON t.id=e.equipe_id AND t.club_id=e.club_id
 JOIN team_competitions c ON c.id=t.competition_id AND c.club_id=t.club_id
 WHERE r.id=NEW.rencontre_id AND r.club_id=NEW.club_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Compétition de la rencontre introuvable.'; END IF;
 IF NEW.match_type='double' THEN NEW.set3_format:='super_tiebreak';
 ELSE
  IF configured IS NULL THEN RAISE EXCEPTION 'Renseignez le troisième set des simples dans la compétition.'; END IF;
  NEW.set3_format:=configured;
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION public.guard_team_line() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE spec integer[]; max_slot integer;
BEGIN
 IF TG_OP='UPDATE' THEN
  NEW.revision:=OLD.revision+1;
  IF NEW.slot IS DISTINCT FROM OLD.slot THEN RAISE EXCEPTION 'La place du match est conservée.'; END IF;
  -- Older BO forms may still edit a free-text result. It must be reviewed in the
  -- structured form before the encounter can be confirmed.
  IF current_user NOT IN ('postgres','service_role','supabase_admin') THEN
   IF NEW.live_match_id IS DISTINCT FROM OLD.live_match_id OR NEW.sets IS DISTINCT FROM OLD.sets
      OR NEW.result_kind IS DISTINCT FROM OLD.result_kind OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at THEN
    RAISE EXCEPTION 'Utilisez les commandes de la rencontre pour ce résultat.';
   END IF;
   IF NEW.score IS DISTINCT FROM OLD.score OR NEW.gagnant IS DISTINCT FROM OLD.gagnant THEN
    IF OLD.live_match_id IS NOT NULL THEN RAISE EXCEPTION 'Vérifiez ce résultat lié au Live dans la rencontre PWA.'; END IF;
    NEW.confirmed_at:=NULL; NEW.result_kind:=NULL; NEW.sets:='[]';
   END IF;
  END IF;
 ELSE
  PERFORM 1 FROM team_rencontres WHERE id=NEW.rencontre_id AND club_id=NEW.club_id FOR UPDATE;
  SELECT team_format_spec(c.format) INTO spec FROM team_rencontres r
   JOIN team_etapes e ON e.id=r.etape_id AND e.club_id=r.club_id
   JOIN team_equipes t ON t.id=e.equipe_id AND t.club_id=e.club_id
   JOIN team_competitions c ON c.id=t.competition_id AND c.club_id=t.club_id
   WHERE r.id=NEW.rencontre_id AND r.club_id=NEW.club_id;
  max_slot:=CASE WHEN NEW.match_type='simple' THEN spec[1] ELSE spec[2] END;
  IF NEW.slot IS NULL THEN
   SELECT n INTO NEW.slot FROM generate_series(1,max_slot) n WHERE NOT EXISTS
    (SELECT 1 FROM team_match_lines WHERE rencontre_id=NEW.rencontre_id AND match_type=NEW.match_type AND slot=n) ORDER BY n LIMIT 1;
  END IF;
  IF max_slot IS NULL OR NEW.slot IS NULL OR NEW.slot<1 OR NEW.slot>max_slot THEN RAISE EXCEPTION 'Aucune place disponible pour ce match.'; END IF;
  IF current_user NOT IN ('postgres','service_role','supabase_admin') THEN
   IF NEW.live_match_id IS NOT NULL THEN RAISE EXCEPTION 'Créez le live depuis la rencontre.'; END IF;
   NEW.confirmed_at:=NULL; NEW.result_kind:=NULL; NEW.sets:='[]';
  END IF;
  NEW.ordre:=NEW.slot-1; NEW.revision:=0;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER team_line_guard BEFORE INSERT OR UPDATE ON team_match_lines FOR EACH ROW EXECUTE FUNCTION guard_team_line();

CREATE FUNCTION public.guard_team_encounter() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 NEW.revision:=OLD.revision+1;
 IF current_user NOT IN ('postgres','service_role','supabase_admin') THEN
  IF NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at OR NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by THEN
   RAISE EXCEPTION 'Utilisez la confirmation de la rencontre.';
  END IF;
  IF (to_jsonb(NEW)-ARRAY['revision','updated_at','photo_urls']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['revision','updated_at','photo_urls']) THEN
   NEW.confirmed_at:=NULL; NEW.confirmed_by:=NULL;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER team_encounter_guard BEFORE UPDATE ON team_rencontres FOR EACH ROW EXECUTE FUNCTION guard_team_encounter();

CREATE TABLE public.team_match_history (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
 rencontre_id uuid NOT NULL, line_id uuid NOT NULL, actor_id uuid, before_data jsonb, after_data jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.team_match_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.team_match_history FROM anon,authenticated;

CREATE FUNCTION public.refresh_team_result() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE rid uuid; weight integer;
BEGIN
 INSERT INTO team_match_history(club_id,rencontre_id,line_id,actor_id,before_data,after_data)
 VALUES(CASE WHEN TG_OP='DELETE' THEN OLD.club_id ELSE NEW.club_id END,
 CASE WHEN TG_OP='DELETE' THEN OLD.rencontre_id ELSE NEW.rencontre_id END,
 CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END,auth.uid(),
 CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END);
 rid:=CASE WHEN TG_OP='DELETE' THEN OLD.rencontre_id ELSE NEW.rencontre_id END;
 SELECT (team_format_spec(c.format))[3] INTO weight FROM team_rencontres r
 JOIN team_etapes e ON e.id=r.etape_id JOIN team_equipes t ON t.id=e.equipe_id JOIN team_competitions c ON c.id=t.competition_id WHERE r.id=rid;
 UPDATE team_rencontres SET confirmed_at=NULL,confirmed_by=NULL,revision=revision+1,
 score_club=(SELECT coalesce(sum(CASE WHEN match_type='double' THEN weight ELSE 1 END) FILTER(WHERE gagnant='club'),0) FROM team_match_lines WHERE rencontre_id=rid),
 score_adverse=(SELECT coalesce(sum(CASE WHEN match_type='double' THEN weight ELSE 1 END) FILTER(WHERE gagnant='adverse'),0) FROM team_match_lines WHERE rencontre_id=rid)
 WHERE id=rid;
 RETURN NULL;
END $$;
CREATE TRIGGER team_result_refresh AFTER INSERT OR UPDATE OR DELETE ON team_match_lines FOR EACH ROW EXECUTE FUNCTION refresh_team_result();

CREATE OR REPLACE FUNCTION public.guard_live_match_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE caller uuid := auth.uid();
BEGIN
  IF TG_OP = 'UPDATE' THEN NEW.revision := OLD.revision + 1; END IF;
  IF TG_OP = 'INSERT' THEN NEW.revision := 0; END IF;
  -- Maintenance serveur : RLS et droits de service restent inchangés.
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF caller IS NULL THEN RAISE EXCEPTION 'Connexion requise.' USING ERRCODE = '42501'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' OR NEW.scored_by IS NOT NULL THEN
      RAISE EXCEPTION 'Créer un match en attente avant de le démarrer.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'pending' OR OLD.scored_by = caller OR public.can_manage_club_content(OLD.club_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Seul le gestionnaire ou un responsable du club peut supprimer ce match.' USING ERRCODE = '42501';
  END IF;
  IF NEW.club_id IS DISTINCT FROM OLD.club_id OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Le club et l’identifiant du match ne peuvent pas être modifiés.' USING ERRCODE = '42501';
  END IF;
  -- Préserver ON DELETE SET NULL de la FK events sans autoriser une édition du score.
  IF pg_trigger_depth() > 1 AND ((OLD.event_id IS NOT NULL AND NEW.event_id IS NULL) OR
    (OLD.team_match_line_id IS NOT NULL AND NEW.team_match_line_id IS NULL) OR
    (OLD.team_rencontre_id IS NOT NULL AND NEW.team_rencontre_id IS NULL)) AND
    (to_jsonb(NEW) - ARRAY['event_id','team_match_line_id','team_rencontre_id','revision','updated_at']) =
    (to_jsonb(OLD) - ARRAY['event_id','team_match_line_id','team_rencontre_id','revision','updated_at']) THEN RETURN NEW; END IF;
  IF OLD.scored_by = caller AND
    (NEW.scored_by = caller OR (NEW.scored_by IS NULL AND NEW.status = 'pending')) THEN RETURN NEW; END IF;

  -- Reprise explicite : aucun changement de score dans la même écriture.
  IF OLD.status IN ('live', 'finished') AND NEW.scored_by = caller AND
    (to_jsonb(NEW) - ARRAY['scored_by','revision','updated_at']) =
    (to_jsonb(OLD) - ARRAY['scored_by','revision','updated_at']) THEN RETURN NEW; END IF;
  -- Démarrage : terrain/horodatage autorisés, scores et joueurs conservés.
  IF OLD.status = 'pending' AND NEW.status = 'live' AND NEW.scored_by = caller AND
    (to_jsonb(NEW) - ARRAY['status','scored_by','court','started_at','revision','updated_at']) =
    (to_jsonb(OLD) - ARRAY['status','scored_by','court','started_at','revision','updated_at']) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Ce match est géré par un autre utilisateur. Reprenez le contrôle avant de le modifier.' USING ERRCODE = '42501';
END
$$;

CREATE FUNCTION public.guard_team_live() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.team_match_line_id IS NOT NULL AND pg_trigger_depth()=1 AND current_user NOT IN ('postgres','service_role','supabase_admin') THEN RAISE EXCEPTION 'Ce live est lié à une rencontre ; conservez-le avec son résultat.'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND pg_trigger_depth()>1 AND
  ((OLD.team_match_line_id IS NOT NULL AND NEW.team_match_line_id IS NULL) OR (OLD.team_rencontre_id IS NOT NULL AND NEW.team_rencontre_id IS NULL)) AND
  (to_jsonb(NEW)-ARRAY['team_match_line_id','team_rencontre_id','revision','updated_at']) =
  (to_jsonb(OLD)-ARRAY['team_match_line_id','team_rencontre_id','revision','updated_at']) THEN
  IF NEW.team_match_line_id IS NULL THEN NEW.team_rencontre_id:=NULL; NEW.team_result_confirmed:=false; END IF;
  RETURN NEW;
 END IF;
 IF current_user NOT IN ('postgres','service_role','supabase_admin') THEN
  IF TG_OP='INSERT' AND (NEW.team_match_line_id IS NOT NULL OR NEW.team_rencontre_id IS NOT NULL OR NEW.team_result_confirmed) THEN
   RAISE EXCEPTION 'Créez ce live depuis la rencontre.';
  END IF;
  IF TG_OP='UPDATE' THEN
   IF NEW.team_match_line_id IS DISTINCT FROM OLD.team_match_line_id OR NEW.team_rencontre_id IS DISTINCT FROM OLD.team_rencontre_id
      OR NEW.team_result_confirmed IS DISTINCT FROM OLD.team_result_confirmed THEN RAISE EXCEPTION 'Le lien à la rencontre est géré automatiquement.'; END IF;
   IF OLD.team_match_line_id IS NOT NULL AND (NEW.set3_format IS DISTINCT FROM OLD.set3_format OR NEW.match_type IS DISTINCT FROM OLD.match_type) THEN
    RAISE EXCEPTION 'Le format est fixé par la rencontre.'; END IF;
  END IF;
 END IF;
 IF TG_OP='UPDATE' AND NEW.team_match_line_id IS NOT NULL AND
  (to_jsonb(NEW)-ARRAY['revision','updated_at','scored_by','court','team_result_confirmed']) IS DISTINCT FROM
  (to_jsonb(OLD)-ARRAY['revision','updated_at','scored_by','court','team_result_confirmed']) THEN
  NEW.team_result_confirmed:=false;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER team_live_guard BEFORE INSERT OR UPDATE OR DELETE ON live_matches FOR EACH ROW EXECUTE FUNCTION guard_team_live();

CREATE FUNCTION public.invalidate_team_live_result() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.team_match_line_id IS NOT NULL AND NOT NEW.team_result_confirmed AND
  (to_jsonb(NEW)-ARRAY['revision','updated_at','scored_by','court','team_result_confirmed']) IS DISTINCT FROM
  (to_jsonb(OLD)-ARRAY['revision','updated_at','scored_by','court','team_result_confirmed']) THEN
  UPDATE team_match_lines SET confirmed_at=NULL,gagnant=NULL,score=NULL,result_kind=NULL
  WHERE id=NEW.team_match_line_id;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER team_live_result_invalidated AFTER UPDATE ON live_matches FOR EACH ROW EXECUTE FUNCTION invalidate_team_live_result();

-- Public scores, as with Live. Only the command endpoint grants member writes.
GRANT SELECT ON team_match_lines TO anon;
CREATE POLICY team_lines_public_read ON team_match_lines FOR SELECT TO anon USING
 (EXISTS(SELECT 1 FROM clubs c WHERE c.id=club_id AND c.status='active'));

CREATE FUNCTION public.team_member_search(p_club uuid,p_search text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT team_can_score(p_club) THEN RAISE EXCEPTION 'Accès membre requis.' USING ERRCODE='42501'; END IF;
 IF length(btrim(p_search))<2 THEN RETURN '[]'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(to_jsonb(found)),'[]') FROM
  (SELECT p.id,p.prenom,p.nom FROM profiles p JOIN club_members m ON m.user_id=p.id
   WHERE m.club_id=p_club AND (p.prenom||' '||p.nom) ILIKE '%'||left(p_search,80)||'%'
   ORDER BY p.nom,p.prenom LIMIT 12) found);
END $$;
REVOKE ALL ON FUNCTION public.team_member_search(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.team_member_search(uuid,text) TO authenticated;

CREATE FUNCTION public.team_match_command(p_club uuid,p_rencontre uuid,p_operation text,p_data jsonb,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
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
  IF live_id IS NOT NULL AND m.status='live' AND m.scored_by IS DISTINCT FROM auth.uid() AND coalesce((p_data->>'takeover')::boolean,false)=false THEN
   RAISE EXCEPTION 'Confirmez la reprise du live avant de saisir ce résultat.'; END IF;
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
REVOKE ALL ON FUNCTION public.guard_team_line(),public.refresh_team_result(),public.guard_team_live(),public.invalidate_team_live_result(),public.snapshot_team_match_rules(),public.guard_team_encounter() FROM PUBLIC,anon,authenticated;
COMMIT;
