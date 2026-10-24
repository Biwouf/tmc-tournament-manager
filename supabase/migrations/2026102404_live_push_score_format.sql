-- Scores des alertes de fin de set et de match sans espaces : « 6/4, 7/5 » (au lieu de « 6 / 4 »).
-- Corrige live_push_sets de 2026102403. Fonction appelée par live_push_on_match : rien d'autre à changer.
BEGIN;

CREATE OR REPLACE FUNCTION public.live_push_sets(m public.live_matches,side text,first_set integer,last_set integer)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT string_agg(CASE side WHEN 'j1' THEN a||'/'||b ELSE b||'/'||a END,', ' ORDER BY n)
  FROM (VALUES(1,m.set1_j1,m.set1_j2),(2,m.set2_j1,m.set2_j2),(3,m.set3_j1,m.set3_j2)) s(n,a,b)
  WHERE n BETWEEN first_set AND last_set AND a IS NOT NULL AND b IS NOT NULL
$$;

COMMIT;
