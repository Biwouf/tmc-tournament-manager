-- Rendre explicites les GRANT sur les tables existantes du schéma public.
--
-- Contexte : à partir du 30 octobre 2026, Supabase n'exposera plus
-- automatiquement les tables du schéma public à l'API Data. Un GRANT
-- explicite par rôle (anon / authenticated) sera requis. Les tables
-- existantes restent à risque dès qu'une nouvelle table sera créée après
-- cette date sans ce pattern : on fige donc dès maintenant les grants
-- attendus par rôle, alignés sur les policies RLS déjà en place.
--
-- Convention pour les futures migrations : chaque CREATE TABLE dans
-- public doit être suivi de son GRANT (cf. docs/CODEBASE.md).

-- events : RLS authenticated full + anon SELECT (PWA route /evenements)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.events TO authenticated;
GRANT SELECT                         ON TABLE public.events TO anon;

-- live_matches : RLS authenticated full + anon SELECT (PWA route /matches)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.live_matches TO authenticated;
GRANT SELECT                         ON TABLE public.live_matches TO anon;

-- actus : RLS authenticated full + anon SELECT (filtre published = true)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.actus TO authenticated;
GRANT SELECT                         ON TABLE public.actus TO anon;

-- profiles : RLS authenticated SELECT/INSERT/UPDATE (own only) + anon SELECT
-- Pas de DELETE : la suppression est gérée par CASCADE depuis auth.users.
GRANT SELECT, INSERT, UPDATE         ON TABLE public.profiles TO authenticated;
GRANT SELECT                         ON TABLE public.profiles TO anon;
