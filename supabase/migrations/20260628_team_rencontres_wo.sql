-- Déclaration d'une rencontre par WO (walkover) au niveau rencontre.
-- Pas de nouvelle policy : team_rencontres est déjà exposée en lecture anon
-- (cf. 20260611_team_matches_pwa_read.sql).

ALTER TABLE public.team_rencontres
  ADD COLUMN IF NOT EXISTS wo boolean NOT NULL DEFAULT false;
