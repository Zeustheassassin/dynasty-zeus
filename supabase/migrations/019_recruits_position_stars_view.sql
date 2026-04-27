-- recruits_position_stars_summary: server-side aggregation for the Recruit Statistics tab.
-- Grouped count of recruits by (year, position, stars). Only 4★ and 5★ are surfaced —
-- those are the actionable tiers for fantasy/dynasty scouting; 3★ and below would just
-- be noise in the summary table.
--
-- A view is preferred over client-side aggregation because:
--   - One query returns ~50-100 rows instead of pulling every recruit row
--   - PostgreSQL does the GROUP BY natively (sub-millisecond)
--   - RLS on the underlying recruits table still applies via PostgREST
--
-- security_invoker = on so the view runs with the caller's permissions, inheriting
-- the same RLS policies that protect the underlying table.

CREATE OR REPLACE VIEW recruits_position_stars_summary
WITH (security_invoker = on) AS
SELECT
  year,
  position,
  stars,
  COUNT(*)::int AS count
FROM recruits
WHERE position IS NOT NULL
  AND stars    IS NOT NULL
  AND stars   >= 4
GROUP BY year, position, stars;

GRANT SELECT ON recruits_position_stars_summary TO authenticated;
