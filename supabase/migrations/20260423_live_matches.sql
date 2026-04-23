-- Live Score module: table, enums, RLS, realtime

CREATE TYPE live_match_status AS ENUM ('pending', 'live', 'finished');
CREATE TYPE live_match_type   AS ENUM ('simple', 'double');
CREATE TYPE live_set3_format  AS ENUM ('normal', 'super_tiebreak');
CREATE TYPE live_match_winner AS ENUM ('j1', 'j2');

CREATE TABLE IF NOT EXISTS live_matches (
  id             UUID            DEFAULT gen_random_uuid() PRIMARY KEY,
  match_date     DATE            NOT NULL,
  start_time     TIME,
  match_type     live_match_type NOT NULL DEFAULT 'simple',

  -- Équipe 1
  j1_prenom      TEXT            NOT NULL,
  j1_nom         TEXT            NOT NULL,
  j1_classement  TEXT            NOT NULL DEFAULT '',
  j1_club        TEXT            NOT NULL DEFAULT '',

  -- Équipe 2
  j2_prenom      TEXT            NOT NULL,
  j2_nom         TEXT            NOT NULL,
  j2_classement  TEXT            NOT NULL DEFAULT '',
  j2_club        TEXT            NOT NULL DEFAULT '',

  -- Doubliste équipe 1
  j3_prenom      TEXT,
  j3_nom         TEXT,
  j3_classement  TEXT,
  j3_club        TEXT,

  -- Doubliste équipe 2
  j4_prenom      TEXT,
  j4_nom         TEXT,
  j4_classement  TEXT,
  j4_club        TEXT,

  event_id       UUID            REFERENCES events(id) ON DELETE SET NULL,
  scored_by      UUID            REFERENCES auth.users(id) ON DELETE SET NULL,

  status         live_match_status NOT NULL DEFAULT 'pending',

  -- Set 1
  set1_j1        SMALLINT        CHECK (set1_j1 >= 0),
  set1_j2        SMALLINT        CHECK (set1_j2 >= 0),
  set1_tb_j1     SMALLINT        CHECK (set1_tb_j1 >= 0),
  set1_tb_j2     SMALLINT        CHECK (set1_tb_j2 >= 0),

  -- Set 2
  set2_j1        SMALLINT        CHECK (set2_j1 >= 0),
  set2_j2        SMALLINT        CHECK (set2_j2 >= 0),
  set2_tb_j1     SMALLINT        CHECK (set2_tb_j1 >= 0),
  set2_tb_j2     SMALLINT        CHECK (set2_tb_j2 >= 0),

  -- Set 3
  set3_format    live_set3_format,
  set3_j1        SMALLINT        CHECK (set3_j1 >= 0),
  set3_j2        SMALLINT        CHECK (set3_j2 >= 0),
  set3_tb_j1     SMALLINT        CHECK (set3_tb_j1 >= 0),
  set3_tb_j2     SMALLINT        CHECK (set3_tb_j2 >= 0),

  winner         live_match_winner,
  finished_at    TIMESTAMPTZ,

  created_at     TIMESTAMPTZ     DEFAULT now() NOT NULL,
  updated_at     TIMESTAMPTZ     DEFAULT now() NOT NULL
);

DROP TRIGGER IF EXISTS live_matches_updated_at ON live_matches;
CREATE TRIGGER live_matches_updated_at
  BEFORE UPDATE ON live_matches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE live_matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "live_matches_select" ON live_matches;
DROP POLICY IF EXISTS "live_matches_insert" ON live_matches;
DROP POLICY IF EXISTS "live_matches_update" ON live_matches;
DROP POLICY IF EXISTS "live_matches_delete" ON live_matches;

CREATE POLICY "live_matches_select" ON live_matches FOR SELECT TO authenticated USING (true);
CREATE POLICY "live_matches_insert" ON live_matches FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "live_matches_update" ON live_matches FOR UPDATE TO authenticated USING (true);
CREATE POLICY "live_matches_delete" ON live_matches FOR DELETE TO authenticated USING (true);

-- Enable realtime publication (may need to be done via dashboard too)
ALTER PUBLICATION supabase_realtime ADD TABLE live_matches;
