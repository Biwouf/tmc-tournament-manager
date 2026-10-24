-- Textes des alertes de fin de set et de fin de match, sur le modèle :
--   « Alex Dupont remporte le 1er set 6 / 4 contre Sam Martin »
--   « Alex Dupont remporte le match 6 / 4, 7 / 5 contre Sam Martin » (+ « (abandon) »)
-- Remplace live_push_on_match de 2026102401 (déjà appliquée en DEV). Trigger et droits inchangés.
BEGIN;

-- Scores des sets first_set..last_set, du point de vue d'un côté : « 6 / 4, 7 / 5 ».
CREATE FUNCTION public.live_push_sets(m public.live_matches,side text,first_set integer,last_set integer)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT string_agg(CASE side WHEN 'j1' THEN a||' / '||b ELSE b||' / '||a END,', ' ORDER BY n)
  FROM (VALUES(1,m.set1_j1,m.set1_j2),(2,m.set2_j1,m.set2_j2),(3,m.set3_j1,m.set3_j2)) s(n,a,b)
  WHERE n BETWEEN first_set AND last_set AND a IS NOT NULL AND b IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION public.live_push_on_match()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE n integer:=0; title text; body text; winner_side text; loser_side text; last_set integer;
BEGIN
  IF NEW.status='finished' AND OLD.status<>'finished' THEN
    title:='Match terminé';
    IF NEW.winner IS NULL THEN
      body:=live_push_full_side(NEW,'j1')||' - '||live_push_full_side(NEW,'j2')
        ||coalesce(' : '||live_push_sets(NEW,'j1',1,3),'');
    ELSE
      winner_side:=NEW.winner::text;
      loser_side:=CASE winner_side WHEN 'j1' THEN 'j2' ELSE 'j1' END;
      body:=live_push_full_side(NEW,winner_side)||' remporte le match'
        ||coalesce(' '||live_push_sets(NEW,winner_side,1,3),'')
        ||' contre '||live_push_full_side(NEW,loser_side)
        ||CASE WHEN NEW.retired_player IS NOT NULL THEN ' (abandon)' ELSE '' END;
    END IF;
    n:=live_push_to_followers(NEW.id,'finish',title,body,NULL);
  ELSIF NEW.status='live' THEN
    IF OLD.set2_ended_at IS NULL AND NEW.set2_ended_at IS NOT NULL THEN last_set:=2;
    ELSIF OLD.set1_ended_at IS NULL AND NEW.set1_ended_at IS NOT NULL THEN last_set:=1;
    END IF;
    IF last_set IS NOT NULL THEN
      winner_side:=CASE WHEN (CASE last_set WHEN 1 THEN NEW.set1_j1>NEW.set1_j2 ELSE NEW.set2_j1>NEW.set2_j2 END)
        THEN 'j1' ELSE 'j2' END;
      loser_side:=CASE winner_side WHEN 'j1' THEN 'j2' ELSE 'j1' END;
      title:='Fin du '||CASE last_set WHEN 1 THEN '1er' ELSE '2e' END||' set';
      body:=live_push_full_side(NEW,winner_side)||' remporte le '||CASE last_set WHEN 1 THEN '1er' ELSE '2e' END
        ||' set '||live_push_sets(NEW,winner_side,last_set,last_set)
        ||' contre '||live_push_full_side(NEW,loser_side);
      n:=live_push_to_followers(NEW.id,'set'||last_set,title,body,NULL);
    END IF;
  END IF;
  IF n>0 THEN PERFORM live_push_kick(); END IF;
  RETURN NULL;
END $$;

COMMIT;
