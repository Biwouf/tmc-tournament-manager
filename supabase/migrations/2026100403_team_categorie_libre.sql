-- Catégorie d'âge libre (ex. « +70 ans ») : même contrainte que nom et division.
-- Les codes historiques ('seniors', '35_ans'…) restent valides et sont traduits à l'affichage.
BEGIN;
ALTER TABLE public.team_competitions DROP CONSTRAINT team_competitions_categorie_check;
ALTER TABLE public.team_competitions ADD CONSTRAINT team_competitions_categorie_check
  CHECK (char_length(categorie) BETWEEN 1 AND 40 AND categorie ~ '[^[:space:]]');
COMMIT;
