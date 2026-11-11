-- ============================================================
-- 096: NFL contracts, a shared nflverse / OverTheCap cache (contracts plan, step 1)
-- ============================================================
-- One row per NFL skill player (QB / RB / WR / TE): his most recent contract
-- from nflverse's historical_contracts.parquet (OverTheCap data), so the app
-- can flag expiring deals, long-term deals and cut risk (dead money vs. cap
-- savings). The weekly cron (step 2) is the only writer, through the service
-- role; the computed flags are derived in TypeScript (step 3), never stored.
--
-- Facts about the source that shaped this table (checked 2026-11-11):
--   * The file has one row per CONTRACT, not per player: a player's old deals
--     stay as is_active = false rows. Keeping only the latest one per otc_id
--     (OTC's player id, present on every active row) means a released or
--     unsigned player stays in the table with is_active = false instead of
--     needing a DELETE.
--   * season_history is the player's whole cap history (every deal), copied
--     onto each of his contract rows. It ends with a "Total" row (dropped at
--     import) and can run past the real end of the deal: void years show
--     placeholder salaries (e.g. 50 or 99.999999) with little or no cap
--     number. They are kept here, because their proration accelerates on a
--     release; step 3 decides which years are real.
--   * `years` counts NEW years only. An extension adds them onto the old
--     deal, so year_signed + years does not give the end year.
--   * 2026 rookies have no season_history yet (142 of 757 active skill rows).
--   * Money is in millions of dollars; cap percentages are fractions.
--   * No dead-money or cap-savings column exists; step 3 estimates them.
--   * Sleeper's own gsis_id is blank for most fantasy players, so sleeper_id
--     is resolved at import from the DynastyProcess ID crosswalk first.
--
-- Access: public football data, so any signed-in user reads; no write policy
-- (the service role bypasses RLS). No anon grant.
--
-- Purely additive: CREATE TABLE / INDEX IF NOT EXISTS, policy created only
-- when missing, explicit grants, ledger row. No DROP, DELETE, UPDATE or
-- TRUNCATE.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.nfl_contracts (
  otc_id            integer          PRIMARY KEY,           -- OverTheCap player id
  gsis_id           text,                                   -- NFL id; null for a few new signings
  sleeper_id        text,                                   -- resolved at import; null = not matched
  player            text             NOT NULL,
  position          text             NOT NULL,              -- OTC's: QB / RB / WR / TE
  team              text,                                   -- OTC's nickname, e.g. 'Bengals'; a mid-year move can read 'MIA/DEN'
  is_active         boolean          NOT NULL,              -- false: this latest deal is over (released, expired, retired)
  contract_type     text,                                   -- from contract_history: 'Drafted', 'Extension', 'Franchise', ...
  year_signed       integer,
  years             integer,                                -- NEW years only (see header)
  value             double precision,                       -- $M, whole deal
  apy               double precision,                       -- $M per year
  guaranteed        double precision,                       -- $M
  apy_cap_pct       double precision,                       -- APY as a fraction of the cap when signed
  draft_year        integer,
  draft_round       integer,
  draft_overall     integer,
  seasons           jsonb            NOT NULL DEFAULT '[]'::jsonb,
  source_updated_at timestamptz,                            -- nflverse's own timestamp for the file
  refreshed_at      timestamptz      NOT NULL DEFAULT now() -- when the cron last wrote this row
);

CREATE INDEX IF NOT EXISTS nfl_contracts_sleeper_id_idx ON public.nfl_contracts (sleeper_id);

COMMENT ON TABLE public.nfl_contracts IS
  'Latest NFL contract per skill player from nflverse historical_contracts.parquet (OverTheCap), written weekly by the contracts cron (migration 096).';
COMMENT ON COLUMN public.nfl_contracts.seasons IS
  'season_history minus its Total row, oldest first: [{year int, team, base_salary, prorated_bonus, option_bonus, roster_bonus, guaranteed_salary, cap_number, cap_percent, cash_paid, workout_bonus, per_game_roster_bonus, other_bonus}], money in $M. Includes void years. Empty for players OTC has no yearly breakdown for yet (most 2026 rookies).';

ALTER TABLE public.nfl_contracts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'nfl_contracts' AND policyname = 'nfl_contracts_read') THEN
    CREATE POLICY nfl_contracts_read ON public.nfl_contracts FOR SELECT USING (auth.role() = 'authenticated');
  END IF;
END $$;

-- Explicit grants (Supabase removes implicit default grants on new objects).
-- Read-only for users; only the service role (the cron) writes.
GRANT SELECT ON public.nfl_contracts TO authenticated;
GRANT ALL ON public.nfl_contracts TO service_role;

NOTIFY pgrst, 'reload schema';

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('096_nfl_contracts', 'nfl_contracts: latest NFL contract per skill player (nflverse / OverTheCap, shared, read-only for users), written weekly by the contracts cron')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
