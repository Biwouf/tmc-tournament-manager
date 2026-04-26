-- Patch actus: switch from image_url (single TEXT) to image_urls (TEXT[])
-- Idempotent: safe to run on fresh schemas as well.

ALTER TABLE actus
  ADD COLUMN IF NOT EXISTS image_urls TEXT[] NOT NULL DEFAULT '{}';

-- If the old single-image column exists, migrate its values and drop it.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'actus'
      AND column_name = 'image_url'
  ) THEN
    UPDATE actus
       SET image_urls = ARRAY[image_url]
     WHERE image_url IS NOT NULL
       AND (image_urls IS NULL OR array_length(image_urls, 1) IS NULL);

    ALTER TABLE actus DROP COLUMN image_url;
  END IF;
END $$;

-- Force PostgREST (Supabase API) to reload its schema cache so it sees image_urls.
NOTIFY pgrst, 'reload schema';
