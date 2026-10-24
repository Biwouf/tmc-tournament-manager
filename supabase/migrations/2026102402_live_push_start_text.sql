-- Texte de l'alerte de début : « Prénom Nom - Prénom Nom - Le match commence ! », sans le court.
-- Corrige 2026102401 (déjà appliquée en DEV). Droits inchangés (CREATE OR REPLACE).
BEGIN;

-- Nom complet d'un côté : « Prénom Nom », « Prénom Nom / Prénom Nom » en double.
CREATE FUNCTION public.live_push_full_side(m public.live_matches,side text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE side
    WHEN 'j1' THEN concat_ws(' / ',nullif(btrim(concat_ws(' ',btrim(m.j1_prenom),btrim(m.j1_nom))),''),
      nullif(btrim(concat_ws(' ',btrim(m.j3_prenom),btrim(m.j3_nom))),''))
    ELSE concat_ws(' / ',nullif(btrim(concat_ws(' ',btrim(m.j2_prenom),btrim(m.j2_nom))),''),
      nullif(btrim(concat_ws(' ',btrim(m.j4_prenom),btrim(m.j4_nom))),'')) END
$$;

-- Alerte de début, demandée par la personne qui vient de démarrer le live. Une seule par match.
CREATE OR REPLACE FUNCTION public.live_push_announce_start(p_club uuid,p_match uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE m live_matches; n integer;
BEGIN
  IF NOT live_can_animate(p_club) THEN
    RAISE EXCEPTION 'Seuls les membres de ce club peuvent gérer ce live.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO m FROM live_matches WHERE id=p_match AND club_id=p_club;
  IF NOT FOUND THEN RAISE EXCEPTION 'Match introuvable.' USING ERRCODE='P0002'; END IF;
  -- Une alerte tardive ou sur un match terminé n'aurait plus de sens.
  IF m.status<>'live' OR coalesce(m.started_at,now())<now()-interval '15 minutes' THEN RETURN 0; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('live-push-start:'||p_match,0));
  IF EXISTS(SELECT 1 FROM live_push_deliveries WHERE match_id=p_match AND dedupe_key='start') THEN RETURN 0; END IF;
  INSERT INTO live_push_deliveries(match_id,subscription_id,dedupe_key,title,body,url)
    SELECT p_match,s.id,'start','Match en direct',
      live_push_full_side(m,'j1')||' - '||live_push_full_side(m,'j2')||' - Le match commence !',
      '/matches/'||p_match
    FROM course_push_subscriptions s
    JOIN clubs c ON c.id=s.club_id AND c.status='active'
    JOIN club_members cm ON cm.club_id=s.club_id AND cm.user_id=s.user_id
    WHERE s.club_id=p_club AND s.notify_live AND s.user_id<>auth.uid()
    ON CONFLICT(subscription_id,match_id,dedupe_key) DO NOTHING;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n>0 THEN PERFORM live_push_kick(); END IF;
  RETURN n;
END $$;

COMMIT;
