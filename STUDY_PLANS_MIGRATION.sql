-- STUDY_PLANS_MIGRATION.sql
-- Required, one-time schema change for the study plan feature.
-- Run this in your Supabase project's SQL editor BEFORE deploying the
-- study-plan code — without this column, every settings save (not just
-- study plans — sources, streak, dark mode, everything in that one upsert)
-- will silently start failing, because Supabase rejects an unrecognized
-- column in the same request as everything else.

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS study_plans jsonb DEFAULT '{}'::jsonb;

-- That's the whole migration. Nothing else needs to change — study_plans
-- is a single jsonb blob (keyed by "subject::Name" / "source::Name" / "all"),
-- same pattern as the existing sources/sleeping_subjects/empty_folders columns,
-- so there's no need for a dedicated table or foreign keys.
