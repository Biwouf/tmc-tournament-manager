BEGIN;

ALTER TABLE public.team_competitions
  DROP CONSTRAINT IF EXISTS team_competitions_format_check;

ALTER TABLE public.team_competitions
  ADD CONSTRAINT team_competitions_format_check
  CHECK (format IN ('2S1D', '3S1D', '3S1D2', '4S1D2', '4S2D'));

CREATE OR REPLACE FUNCTION public.team_format_spec(p_format text)
RETURNS integer[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_format
    WHEN '2S1D' THEN ARRAY[2,1,1]
    WHEN '3S1D' THEN ARRAY[3,1,1]
    WHEN '3S1D2' THEN ARRAY[3,1,2]
    WHEN '4S1D2' THEN ARRAY[4,1,2]
    WHEN '4S2D' THEN ARRAY[4,2,1]
  END
$$;

COMMIT;
