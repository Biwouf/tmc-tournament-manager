-- La lecture publique était configurée manuellement et absente des migrations.
-- Les visiteurs suivent les matchs ; seules les sessions autorisées les modifient.
BEGIN;
GRANT SELECT ON TABLE public.live_matches TO anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.live_matches FROM anon;
DROP POLICY IF EXISTS live_matches_anon_read ON public.live_matches;
CREATE POLICY live_matches_anon_read ON public.live_matches FOR SELECT TO anon
USING (EXISTS (
  SELECT 1 FROM public.clubs c
  WHERE c.id = live_matches.club_id AND c.status = 'active'
));
-- active_club_access (audit) et les règles d'écriture/gestionnaire restent en place.
COMMIT;
