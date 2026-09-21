-- La composition (2S1D, etc.) ne permet pas de déduire la règle sportive.
-- NULL signale explicitement une compétition historique à configurer.
BEGIN;
ALTER TABLE public.team_competitions
  ADD COLUMN singles_set3_format public.live_set3_format;
ALTER TABLE public.team_match_lines
  ADD COLUMN set3_format public.live_set3_format;

-- Pour l'historique, seule une règle déjà enregistrée dans un live est fiable.
UPDATE public.team_match_lines AS line
SET set3_format = live.set3_format
FROM public.live_matches AS live
WHERE live.id = line.live_match_id AND live.club_id = line.club_id;

CREATE FUNCTION public.snapshot_team_match_rules() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE configured public.live_set3_format;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.club_id IS DISTINCT FROM OLD.club_id THEN
      RAISE EXCEPTION 'Le club du match ne peut pas être modifié.';
    END IF;
    IF NEW.rencontre_id IS DISTINCT FROM OLD.rencontre_id
       OR NEW.match_type IS DISTINCT FROM OLD.match_type THEN
      RAISE EXCEPTION 'Supprimez puis recréez le match pour changer sa rencontre ou son type.';
    END IF;
    IF NEW.set3_format IS DISTINCT FROM OLD.set3_format THEN
      RAISE EXCEPTION 'La règle du troisième set est conservée avec le match.';
    END IF;
    RETURN NEW;
  END IF;

  SELECT c.singles_set3_format INTO configured
  FROM public.team_rencontres r
  JOIN public.team_etapes e ON e.id = r.etape_id AND e.club_id = r.club_id
  JOIN public.team_equipes t ON t.id = e.equipe_id AND t.club_id = e.club_id
  JOIN public.team_competitions c ON c.id = t.competition_id AND c.club_id = t.club_id
  WHERE r.id = NEW.rencontre_id AND r.club_id = NEW.club_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Compétition de la rencontre introuvable.';
  END IF;
  IF NEW.match_type = 'double' THEN
    NEW.set3_format := 'super_tiebreak';
  ELSE
    IF configured IS NULL THEN
      RAISE EXCEPTION 'Renseignez le troisième set des simples dans la compétition avant de créer ce match.';
    END IF;
    NEW.set3_format := configured;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER team_match_rules_snapshot
BEFORE INSERT OR UPDATE ON public.team_match_lines
FOR EACH ROW EXECUTE FUNCTION public.snapshot_team_match_rules();
COMMIT;
