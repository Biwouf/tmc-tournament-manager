-- Add team_matches JSONB column to events for "Match par équipe" type.
-- Stores an array of TeamMatch objects (see src/types.ts). Validation is
-- entirely client-side; no DB-level check constraint.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS team_matches JSONB;
