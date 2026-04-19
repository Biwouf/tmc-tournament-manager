-- Events module: table, RLS, storage bucket

CREATE TABLE IF NOT EXISTS events (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  type        TEXT        NOT NULL CHECK (type IN ('Animation', 'Tournoi', 'Match par équipe', 'Sortie', 'Soirée')),
  titre       TEXT        NOT NULL,
  description TEXT        NOT NULL,
  date_debut  TIMESTAMPTZ NOT NULL,
  date_fin    TIMESTAMPTZ,
  image_url   TEXT,
  prix        NUMERIC(10, 2) CHECK (prix >= 0),
  created_at  TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS events_updated_at ON events;
CREATE TRIGGER events_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "events_select" ON events;
DROP POLICY IF EXISTS "events_insert" ON events;
DROP POLICY IF EXISTS "events_update" ON events;
DROP POLICY IF EXISTS "events_delete" ON events;

CREATE POLICY "events_select" ON events FOR SELECT TO authenticated USING (true);
CREATE POLICY "events_insert" ON events FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "events_update" ON events FOR UPDATE TO authenticated USING (true);
CREATE POLICY "events_delete" ON events FOR DELETE TO authenticated USING (true);

-- Storage bucket event-images (public read)
INSERT INTO storage.buckets (id, name, public)
VALUES ('event-images', 'event-images', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "event_images_read" ON storage.objects;
DROP POLICY IF EXISTS "event_images_write" ON storage.objects;
DROP POLICY IF EXISTS "event_images_delete" ON storage.objects;

CREATE POLICY "event_images_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'event-images');

CREATE POLICY "event_images_write" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'event-images');

CREATE POLICY "event_images_delete" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'event-images');
