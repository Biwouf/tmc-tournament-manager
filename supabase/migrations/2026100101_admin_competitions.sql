-- Compétitions à nom libre ; Ten’Up préremplit un brouillon validé par l'administrateur.
BEGIN;
ALTER TABLE public.team_competitions DROP CONSTRAINT team_competitions_nom_check;
ALTER TABLE public.team_competitions ADD CONSTRAINT team_competitions_nom_check
  CHECK (char_length(nom) BETWEEN 1 AND 160 AND nom ~ '[^[:space:]]');
ALTER TABLE public.team_competitions ADD COLUMN tenup_url text
  CHECK (tenup_url ~ '^https://tenup[.]fft[.]fr/championnat/[0-9]+([?]division=[0-9]+&phase=[0-9]+&poule=[0-9]+)?$' AND length(tenup_url) <= 500);
-- La fiche du championnat est commune aux filtres de division/phase/poule.
CREATE UNIQUE INDEX team_competition_tenup_source_unique
  ON public.team_competitions(club_id, saison_id, split_part(tenup_url, '?', 1)) WHERE tenup_url IS NOT NULL;

CREATE TABLE public.team_tenup_competition_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX team_tenup_competition_request_rate ON public.team_tenup_competition_requests(actor_id, created_at);
ALTER TABLE public.team_tenup_competition_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.team_tenup_competition_requests FROM PUBLIC, anon, authenticated;

-- Contrôle avec le JWT de l'appelant, avant toute extraction facturée par le worker.
CREATE FUNCTION public.team_tenup_competition_begin(p_club uuid, p_saison uuid, p_url text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_manage_club_content(p_club) THEN
    RAISE EXCEPTION 'Administration du club requise.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM team_saisons WHERE id = p_saison AND club_id = p_club) THEN
    RAISE EXCEPTION 'Saison introuvable pour ce club.';
  END IF;
  IF p_url IS NULL OR length(p_url) > 500 OR p_url !~ '^https://tenup[.]fft[.]fr/championnat/[0-9]+([?]division=[0-9]+&phase=[0-9]+&poule=[0-9]+)?$' THEN
    RAISE EXCEPTION 'Lien de championnat Ten’Up invalide.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('tenup-competition:' || auth.uid()::text, 0));
  DELETE FROM team_tenup_competition_requests WHERE actor_id = auth.uid() AND created_at < now() - interval '1 day';
  IF (SELECT count(*) FROM team_tenup_competition_requests WHERE actor_id = auth.uid() AND created_at > now() - interval '1 minute') >= 3 THEN
    RAISE EXCEPTION 'Trop de demandes Ten’Up. Réessayez dans une minute.';
  END IF;
  INSERT INTO team_tenup_competition_requests(actor_id) VALUES(auth.uid());
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.team_tenup_competition_begin(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_tenup_competition_begin(uuid, uuid, text) TO authenticated;
COMMIT;
