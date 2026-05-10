-- Add per-image captions on actus.
-- image_captions is a TEXT[] parallel to image_urls:
--   image_captions[i] correspond à image_urls[i]
--   "" ou index manquant = pas de caption (paramètre `caption` omis lors de l'upload Facebook).
-- Visible uniquement quand l'image est ouverte en plein écran sur Facebook.
-- N'est PAS affichée côté PWA ni côté BO en consultation.
-- Idempotent.

ALTER TABLE actus
  ADD COLUMN IF NOT EXISTS image_captions TEXT[] NOT NULL DEFAULT '{}';

NOTIFY pgrst, 'reload schema';
