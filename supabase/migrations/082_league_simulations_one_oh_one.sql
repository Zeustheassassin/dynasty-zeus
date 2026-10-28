-- ============================================================
-- DynastyZeus — Migration 082
-- Run in the Supabase SQL editor after migration 081, BEFORE the code that
-- uses it deploys: until this column exists the sim-results load on login
-- fails (League Overview Playoff% falls back to "run sim →") and every
-- Run All Sims save is rejected.
-- ============================================================
-- The user, 2026-10-27: add a column to the League Overview for the chance
-- of getting the 1.01 (first pick of the next rookie draft). The simulator
-- already computes each roster's 1.01 odds (oneOhOneOdds — the share of sims
-- where that roster has the lowest max PF among the teams outside the
-- playoffs, the user's leagues' draft order); this keeps it with the rest of
-- the saved sim results so the Overview can read it on any device.
--
-- Nullable with no default: rows saved before this migration stay NULL, so
-- the Overview shows "—" for them until the next Run All Sims instead of a
-- made-up 0%.
--
-- Additive: no DELETE, TRUNCATE, DROP, or change to an existing column.
-- ============================================================

ALTER TABLE public.league_simulations
  ADD COLUMN IF NOT EXISTS one_oh_one_odds real;
