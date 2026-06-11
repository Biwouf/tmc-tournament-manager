-- Exposer en lecture publique les tables team_* pour la PWA.
-- Cohérent avec le pattern grant_public_tables (anon SELECT only).
-- À NE PAS exposer : team_match_lines (joueurs nominatifs, hors scope PWA v1).

-- Politiques RLS anon SELECT
CREATE POLICY "team_saisons_anon_select"
  ON team_saisons FOR SELECT TO anon USING (true);

CREATE POLICY "team_competitions_anon_select"
  ON team_competitions FOR SELECT TO anon USING (true);

CREATE POLICY "team_equipes_anon_select"
  ON team_equipes FOR SELECT TO anon USING (true);

CREATE POLICY "team_etapes_anon_select"
  ON team_etapes FOR SELECT TO anon USING (true);

CREATE POLICY "team_rencontres_anon_select"
  ON team_rencontres FOR SELECT TO anon USING (true);

-- GRANT explicites (cf. 20260603_grant_public_tables.sql)
GRANT SELECT ON TABLE public.team_saisons      TO anon;
GRANT SELECT ON TABLE public.team_competitions TO anon;
GRANT SELECT ON TABLE public.team_equipes      TO anon;
GRANT SELECT ON TABLE public.team_etapes       TO anon;
GRANT SELECT ON TABLE public.team_rencontres   TO anon;
