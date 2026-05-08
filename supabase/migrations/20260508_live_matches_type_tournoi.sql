-- Live Score: ajoute le champ type_tournoi (alimenté lors du basculement depuis GEN_PROG)

ALTER TABLE live_matches
  ADD COLUMN IF NOT EXISTS type_tournoi TEXT;
