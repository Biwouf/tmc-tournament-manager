-- Lecture publique des événements (PWA hors connexion).
-- La policy existait en prod, créée à la main dans le dashboard (cf. 20260816_multi_tenant_rls.sql),
-- mais manquait sur la base de dev : les événements y étaient invisibles sans connexion.
-- Versionnée ici à l'identique ; le cloisonnement par club reste assuré par active_club_access
-- et par le filtre club_id des requêtes.
BEGIN;
DROP POLICY IF EXISTS events_anon_select ON public.events;
CREATE POLICY events_anon_select ON public.events FOR SELECT TO anon USING (true);
COMMIT;
