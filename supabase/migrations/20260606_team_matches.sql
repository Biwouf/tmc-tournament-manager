-- Module Matches par équipe : référentiel (saisons, compétitions, équipes,
-- étapes), rencontres et matches individuels. Aucune migration depuis events.
-- Réutilise set_updated_at() défini dans 20260418_events.sql.

-- ============================================================
-- SAISONS
-- ============================================================
CREATE TABLE IF NOT EXISTS team_saisons (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  label      TEXT        NOT NULL,
  actif      BOOLEAN     NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

ALTER TABLE team_saisons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team_saisons_all" ON team_saisons FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.team_saisons TO authenticated;

-- ============================================================
-- COMPÉTITIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS team_competitions (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  saison_id  UUID        NOT NULL REFERENCES team_saisons(id) ON DELETE CASCADE,
  nom        TEXT        NOT NULL CHECK (nom IN (
                           'Pyrénées Interclubs', 'CODEP', 'GAN 35', 'Thénégal', 'Interclubs'
                         )),
  type       TEXT        NOT NULL CHECK (type IN ('adultes', 'jeunes')),
  genre      TEXT        NOT NULL CHECK (genre IN ('hommes', 'femmes', 'mixte', 'garcons', 'filles')),
  categorie  TEXT        NOT NULL CHECK (categorie IN (
                           'seniors', '35_ans', '60_ans', '17_18', '15_16', '13_14', '11_12'
                         )),
  format     TEXT        NOT NULL CHECK (format IN ('2S1D', '3S1D2', '4S1D2', '4S2D')),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

ALTER TABLE team_competitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team_competitions_all" ON team_competitions FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.team_competitions TO authenticated;

-- ============================================================
-- ÉQUIPES
-- ============================================================
CREATE TABLE IF NOT EXISTS team_equipes (
  id                   UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  competition_id       UUID        NOT NULL REFERENCES team_competitions(id) ON DELETE CASCADE,
  numero               INTEGER     NOT NULL DEFAULT 1 CHECK (numero >= 1),
  division             TEXT        NOT NULL CHECK (division IN ('R1A', 'R1B', 'R2', 'R3', 'R4', 'R5', 'R6')),
  nb_journees_poule    INTEGER     NOT NULL CHECK (nb_journees_poule >= 1),
  qualifiee            BOOLEAN,    -- null = non déterminé, true/false après la phase de poule
  stade_finale_depart  TEXT        CHECK (stade_finale_depart IN ('1/16', '1/8', '1/4', '1/2', 'finale')),
  created_at           TIMESTAMPTZ DEFAULT now() NOT NULL
);

ALTER TABLE team_equipes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team_equipes_all" ON team_equipes FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.team_equipes TO authenticated;

-- ============================================================
-- ÉTAPES (journées de poule + phases finales)
-- ============================================================
CREATE TABLE IF NOT EXISTS team_etapes (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  equipe_id       UUID        NOT NULL REFERENCES team_equipes(id) ON DELETE CASCADE,
  phase           TEXT        NOT NULL CHECK (phase IN ('poule', 'finale')),
  numero_journee  INTEGER,    -- renseigné si phase = 'poule'
  stade_finale    TEXT        CHECK (stade_finale IN ('1/16', '1/8', '1/4', '1/2', 'finale')),
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT check_etape_phase CHECK (
    (phase = 'poule' AND numero_journee IS NOT NULL AND stade_finale IS NULL) OR
    (phase = 'finale' AND stade_finale IS NOT NULL AND numero_journee IS NULL)
  )
);

ALTER TABLE team_etapes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team_etapes_all" ON team_etapes FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.team_etapes TO authenticated;

-- ============================================================
-- RENCONTRES (une par étape)
-- ============================================================
CREATE TABLE IF NOT EXISTS team_rencontres (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  etape_id       UUID        NOT NULL UNIQUE REFERENCES team_etapes(id) ON DELETE CASCADE,
  club_adverse   TEXT        NOT NULL,
  date_heure     TIMESTAMPTZ NOT NULL,
  domicile       BOOLEAN     NOT NULL,
  score_club     INTEGER,
  score_adverse  INTEGER,
  photo_urls     TEXT[]      NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at     TIMESTAMPTZ DEFAULT now() NOT NULL
);

DROP TRIGGER IF EXISTS team_rencontres_updated_at ON team_rencontres;
CREATE TRIGGER team_rencontres_updated_at
  BEFORE UPDATE ON team_rencontres
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE team_rencontres ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team_rencontres_all" ON team_rencontres FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.team_rencontres TO authenticated;

-- ============================================================
-- MATCHES INDIVIDUELS D'UNE RENCONTRE (optionnel)
-- ============================================================
CREATE TABLE IF NOT EXISTS team_match_lines (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  rencontre_id    UUID        NOT NULL REFERENCES team_rencontres(id) ON DELETE CASCADE,
  ordre           INTEGER     NOT NULL DEFAULT 0,
  match_type      TEXT        NOT NULL CHECK (match_type IN ('simple', 'double')),
  joueurs_club    JSONB       NOT NULL DEFAULT '[]',    -- [{prenom, nom, classement}]
  joueurs_adverse JSONB       NOT NULL DEFAULT '[]',    -- [{prenom, nom, classement}]
  live_match_id   UUID        REFERENCES live_matches(id) ON DELETE SET NULL,
  score           TEXT,       -- saisie libre si pas de live, ex. "6-4 6-2"
  gagnant         TEXT        CHECK (gagnant IN ('club', 'adverse')),
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL
);

ALTER TABLE team_match_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team_match_lines_all" ON team_match_lines FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.team_match_lines TO authenticated;

-- ============================================================
-- BUCKET STORAGE — team-match-photos (public)
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('team-match-photos', 'team-match-photos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "team_match_photos_read" ON storage.objects;
DROP POLICY IF EXISTS "team_match_photos_write" ON storage.objects;
DROP POLICY IF EXISTS "team_match_photos_delete" ON storage.objects;

CREATE POLICY "team_match_photos_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'team-match-photos');

CREATE POLICY "team_match_photos_write" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'team-match-photos');

CREATE POLICY "team_match_photos_delete" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'team-match-photos');
