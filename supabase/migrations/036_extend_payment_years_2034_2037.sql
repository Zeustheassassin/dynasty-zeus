-- ============================================================
-- DynastyZeus — Migration 036
-- Extend payment-year columns: paid_2034 – paid_2037
-- ============================================================
-- WHY THIS EXISTS
--   The app tracks league dues with one BOOLEAN column per year
--   (paid_<year>) on both league_management and commissioner_payments.
--   The rolling window in lib/constants.ts is
--   [currentYear … currentYear + PAYMENT_YEARS_FUTURE] (= currentYear + 3),
--   so the highest column the app will ever write to equals currentYear + 3.
--
--   Migration 002 provisioned columns through paid_2033 (safe through
--   calendar year 2030). Before this migration the in-app warning pointed
--   at a non-existent "migration 003" — when the window first needed
--   paid_2034 (Jan 1 2031) every league_management / commissioner_payments
--   write would have failed with a generic "Save failed" because the
--   column did not exist.
--
--   This migration provisions paid_2034 – paid_2037 (safe through calendar
--   year 2034) and lib/constants.ts bumps MAX_PROVISIONED_PAYMENT_YEAR to 2037.
--
-- SAFETY
--   Purely additive and idempotent: ADD COLUMN IF NOT EXISTS only. No DROP,
--   DELETE, ALTER…DROP, or TRUNCATE. Existing rows default to false. Safe to
--   re-run. No new tables, so no GRANT/RLS changes are required (column adds
--   inherit the table's existing grants and policies).
--
--   When currentYear + 3 next reaches this ceiling (Jan 1 2035), copy this
--   file, bump the four years, and bump MAX_PROVISIONED_PAYMENT_YEAR.
-- ============================================================

-- ── league_management ────────────────────────────────────────
ALTER TABLE public.league_management
  ADD COLUMN IF NOT EXISTS paid_2034 BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paid_2035 BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paid_2036 BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paid_2037 BOOLEAN NOT NULL DEFAULT false;

-- ── commissioner_payments ────────────────────────────────────
ALTER TABLE public.commissioner_payments
  ADD COLUMN IF NOT EXISTS paid_2034 BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paid_2035 BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paid_2036 BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paid_2037 BOOLEAN NOT NULL DEFAULT false;

-- ── Done ──────────────────────────────────────────────────────
