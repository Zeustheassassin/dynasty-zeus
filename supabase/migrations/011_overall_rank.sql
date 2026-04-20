-- Add overall_rank: cross-position rank within a draft class year.
-- personal_rank remains the within-position rank.
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS overall_rank INTEGER;
