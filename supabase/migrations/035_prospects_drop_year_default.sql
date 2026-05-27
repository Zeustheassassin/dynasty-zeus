-- Drop the hardcoded DEFAULT 2026 on prospects.draft_class_year. The app
-- always supplies an explicit year (derived from new Date().getFullYear()
-- via lib/helpers/season.ts), so a baked-in default would silently funnel
-- any future direct-SQL insert into a stale class. Column stays NOT NULL.

ALTER TABLE prospects
  ALTER COLUMN draft_class_year DROP DEFAULT;
