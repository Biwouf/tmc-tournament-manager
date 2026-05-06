-- Add focal points for each image of an actu.
-- image_focal_points is a JSONB array parallel to image_urls:
--   image_focal_points[i] is null (→ default 50/50) or { "x": number, "y": number } in 0–100.
-- Idempotent.

ALTER TABLE actus
  ADD COLUMN IF NOT EXISTS image_focal_points JSONB NOT NULL DEFAULT '[]'::jsonb;

NOTIFY pgrst, 'reload schema';
