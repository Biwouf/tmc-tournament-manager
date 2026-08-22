-- Matches par équipe — refonte /team-matches (vue Grille de saison), brief §5.
--
-- Ajoute un flag « championnat terminé » piloté explicitement par le club depuis
-- /team-matches/admin. Volontairement NON dérivé des étapes : une compétition peut
-- être finie pour le club alors qu'une phase finale reste programmée en base.
--
-- Une compétition `terminee = true` sort de la grille active et bascule dans la
-- section repliée « Championnats terminés ».
--
-- Pas de policy RLS à ajouter : team_competitions est déjà couverte par
-- `tenant_isolation` (20260816_multi_tenant_rls.sql).
-- Pas de GRANT de colonne à ajouter non plus : le GRANT de 20260606_team_matches.sql
-- porte sur la table entière, sans liste de colonnes — contrairement à `profiles`
-- (cf. 2026081801_profiles_column_grants.sql), la nouvelle colonne est donc
-- immédiatement écrivable par `authenticated`.
--
-- Idempotente.

ALTER TABLE public.team_competitions
  ADD COLUMN IF NOT EXISTS terminee BOOLEAN NOT NULL DEFAULT false;
