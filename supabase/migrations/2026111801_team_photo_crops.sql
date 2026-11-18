-- Cadrage (focus x/y en %, zoom) du visuel « Esprit d'équipe », par photo de rencontre :
-- { "<url de la photo>": { "x": 50, "y": 50, "zoom": 1 } }. Réutilisé par /medias, la page
-- rencontre et l'actu générée.
BEGIN;

ALTER TABLE public.team_rencontres
  ADD COLUMN IF NOT EXISTS photo_crops jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.team_rencontres DROP CONSTRAINT IF EXISTS team_rencontres_photo_crops_object;
ALTER TABLE public.team_rencontres
  ADD CONSTRAINT team_rencontres_photo_crops_object CHECK (jsonb_typeof(photo_crops) = 'object');

-- Comme pour photo_urls : recadrer une photo ne remet pas la confirmation de la rencontre à zéro.
CREATE OR REPLACE FUNCTION public.guard_team_encounter() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 NEW.revision:=OLD.revision+1;
 IF current_user NOT IN ('postgres','service_role','supabase_admin') THEN
  IF NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at OR NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by THEN
   RAISE EXCEPTION 'Utilisez la confirmation de la rencontre.';
  END IF;
  IF (to_jsonb(NEW)-ARRAY['revision','updated_at','photo_urls','photo_crops']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['revision','updated_at','photo_urls','photo_crops']) THEN
   NEW.confirmed_at:=NULL; NEW.confirmed_by:=NULL;
  END IF;
 END IF;
 RETURN NEW;
END $$;

COMMIT;
