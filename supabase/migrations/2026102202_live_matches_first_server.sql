-- Côté au service au premier jeu. NULL = inconnu (« Je ne sais pas ») : aucun
-- indicateur de service. Le serveur courant est déduit du score côté client.
ALTER TABLE public.live_matches ADD COLUMN IF NOT EXISTS first_server live_match_winner;
