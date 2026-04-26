-- Actus module: table, RLS, storage bucket
-- Multi-images: image_urls is a TEXT[] (empty array if no image)

CREATE TABLE IF NOT EXISTS actus (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  titre        TEXT        NOT NULL,
  contenu      TEXT        NOT NULL,
  image_urls   TEXT[]      NOT NULL DEFAULT '{}',
  published    BOOLEAN     NOT NULL DEFAULT false,
  published_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at   TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Reuses set_updated_at() from the events migration
DROP TRIGGER IF EXISTS actus_updated_at ON actus;
CREATE TRIGGER actus_updated_at
  BEFORE UPDATE ON actus
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE actus ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "actus_anon_select" ON actus;
DROP POLICY IF EXISTS "actus_authenticated_select" ON actus;
DROP POLICY IF EXISTS "actus_insert" ON actus;
DROP POLICY IF EXISTS "actus_update" ON actus;
DROP POLICY IF EXISTS "actus_delete" ON actus;

-- Public read (PWA): only published actus
CREATE POLICY "actus_anon_select"
  ON actus FOR SELECT TO anon USING (published = true);

-- Admin (back-office): full access on all rows, drafts included
CREATE POLICY "actus_authenticated_select"
  ON actus FOR SELECT TO authenticated USING (true);
CREATE POLICY "actus_insert"
  ON actus FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "actus_update"
  ON actus FOR UPDATE TO authenticated USING (true);
CREATE POLICY "actus_delete"
  ON actus FOR DELETE TO authenticated USING (true);

-- Storage bucket actu-images (public read)
INSERT INTO storage.buckets (id, name, public)
VALUES ('actu-images', 'actu-images', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "actu_images_read" ON storage.objects;
DROP POLICY IF EXISTS "actu_images_write" ON storage.objects;
DROP POLICY IF EXISTS "actu_images_delete" ON storage.objects;

CREATE POLICY "actu_images_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'actu-images');

CREATE POLICY "actu_images_write" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'actu-images');

CREATE POLICY "actu_images_delete" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'actu-images');
