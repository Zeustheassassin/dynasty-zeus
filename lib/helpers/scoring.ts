// ============================================================
// Fantasy scoring helpers — rules comparison, formatting, grouping,
// and league-specific fpts computation.
// Used by LeagueHub, DataHub, and useProjections.
// ============================================================

/** Normalises a projection source player name for fuzzy matching:
 *  strips suffixes (Jr, II, etc.) and non-alpha characters. */
export const normalizeProjName = (n: string) =>
  n.toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/gi, "")
    .replace(/[^a-z]/g, "");

/**
 * Default scoring used when no league is selected.
 * Full PPR, 4pt passing TDs, 0.5 TEP — matches the app's historical
 * projection baseline so the projections tab behaves identically to before
 * for users who haven't connected a league.
 */
export const DEFAULT_SCORING: Record<string, number> = {
  pass_yd: 0.04, pass_td: 4, pass_int: -2,
  rush_yd: 0.1, rush_td: 6,
  rec: 1, rec_yd: 0.1, rec_td: 6,
  bonus_rec_te: 0.5,
  rec_2pt: 2, rush_2pt: 2, pass_2pt: 2,
};

/**
 * FC (FantasyCalc) dynasty value baseline — the scoring format FC uses when
 * computing its dynasty values. Used to derive per-position adjustment
 * multipliers when a league's settings differ.
 * Full PPR, 4pt passing TDs, no TEP (superflex is handled separately via num_qbs=2).
 */
export const FC_BASELINE_SCORING: Record<string, number> = {
  pass_yd: 0.04, pass_td: 4, pass_int: -2,
  rush_yd: 0.1, rush_td: 6,
  rec: 1, rec_yd: 0.1, rec_td: 6,
  bonus_rec_te: 0,
  rec_2pt: 2, rush_2pt: 2, pass_2pt: 2,
};

/** Standard PPR-like baseline used to detect non-standard scoring rules. */
export const STANDARD_SCORING: Record<string, number> = {
  pass_yd: 0.04, pass_td: 4, pass_int: -2, pass_first_down: 0,
  pass_cmp: 0, pass_inc: 0, pass_attempt: 0, pass_sack: 0,
  pass_sack_yd: 0, pass_pick_six: 0, bonus_pass_yd_40: 0,
  bonus_pass_td_40: 0, bonus_pass_td_50: 0, rush_yd: 0.1,
  rush_td: 6, rec: 0, rec_yd: 0.1, rec_td: 6,
  rec_2pt: 2, rush_2pt: 2, pass_2pt: 2,
};

/**
 * Computes fantasy points for a player given their raw Sleeper stat fields
 * and a scoring settings object (from a Sleeper league's scoring_settings).
 *
 * Stat keys from Sleeper projections map 1:1 to scoring_settings keys for
 * all standard fields. Position-bonus keys (bonus_rec_te/rb/wr) are handled
 * separately because they apply the league's bonus multiplier to the player's
 * rec count only for matching positions.
 */
export function computeLeagueFpts(
  stats: Record<string, number | null | undefined>,
  scoringSettings: Record<string, number>,
  position: string
): number {
  let total = 0;
  for (const [key, multiplier] of Object.entries(scoringSettings)) {
    if (!multiplier) continue;
    // Position bonuses are handled below — their key doesn't exist in stats
    if (key === "bonus_rec_te" || key === "bonus_rec_rb" || key === "bonus_rec_wr") continue;
    const stat = stats[key];
    if (typeof stat === "number" && stat !== 0) total += stat * multiplier;
  }
  // Apply position-specific reception bonuses
  const recCount = typeof stats.rec === "number" ? stats.rec : 0;
  if (recCount > 0) {
    if (position === "TE" && scoringSettings.bonus_rec_te) total += recCount * scoringSettings.bonus_rec_te;
    if (position === "RB" && scoringSettings.bonus_rec_rb) total += recCount * scoringSettings.bonus_rec_rb;
    if (position === "WR" && scoringSettings.bonus_rec_wr) total += recCount * scoringSettings.bonus_rec_wr;
  }
  return total;
}

/**
 * Computes per-position dynasty value multipliers based on how a league's
 * scoring deviates from the FC baseline (FC_BASELINE_SCORING).
 *
 * Returns a Record<position, multiplier> — e.g. { QB: 1.06, TE: 1.14, WR: 0.97 }.
 * Values of 1.0 mean no adjustment needed. Always superflex so QB premium
 * is already embedded in FC values via num_qbs=2.
 *
 * Weights are calibrated against typical dynasty positional stat distributions:
 *   QB  ~290 rec equiv / ~28 pass TDs / season
 *   WR  ~80 rec / season
 *   RB  ~45 rec / season
 *   TE  ~55 rec / season
 */
export function computeScoringMultipliers(
  scoringSettings: Record<string, number>
): Record<string, number> {
  const pprDelta   = (scoringSettings.rec         ?? 0) - FC_BASELINE_SCORING.rec;
  const tepDelta   = (scoringSettings.bonus_rec_te ?? 0) - FC_BASELINE_SCORING.bonus_rec_te;
  const rbPremium  =  scoringSettings.bonus_rec_rb ?? 0;
  const wrPremium  =  scoringSettings.bonus_rec_wr ?? 0;
  const passTdDelta = (scoringSettings.pass_td     ?? 4) - FC_BASELINE_SCORING.pass_td;

  // Average season value baselines per position (PPR dynasty, approximate)
  const QB_VALUE  = 400;
  const WR_VALUE  = 350;
  const RB_VALUE  = 280;
  const TE_VALUE  = 260;

  // Points added/removed per season relative to FC baseline
  const qbDelta  = passTdDelta * 28;                        // ~28 pass TDs/season
  const wrDelta  = pprDelta * 80 + wrPremium * 80;          // ~80 rec/season
  const rbDelta  = pprDelta * 45 + rbPremium * 45;          // ~45 rec/season
  const teDelta  = pprDelta * 55 + tepDelta * 55;           // ~55 rec/season

  // Convert season-point delta to a value multiplier
  // Clamp to ±30% to avoid wild swings from unusual league settings
  const clamp = (v: number) => Math.max(0.70, Math.min(1.30, v));

  return {
    QB: clamp(1 + qbDelta / QB_VALUE),
    WR: clamp(1 + wrDelta / WR_VALUE),
    RB: clamp(1 + rbDelta / RB_VALUE),
    TE: clamp(1 + teDelta / TE_VALUE),
  };
}

/** Returns scoring keys that deviate from STANDARD_SCORING. */
export const getNonStandardRules = (scoring: Record<string, number>) => {
  const changes: Array<{ key: string; value: number }> = [];
  Object.keys(scoring || {}).forEach((key) => {
    const value = scoring[key];
    const standard = STANDARD_SCORING[key];
    if (value === 0 || value === null) return;
    if (standard === undefined || value !== standard) changes.push({ key, value });
  });
  return changes;
};

/** Returns a human-readable label for a Sleeper scoring key. */
export const formatRule = (key: string) => {
  const labels: Record<string, string> = {
    pass_int: "Interceptions Thrown", pass_td_40p: "40+ Yard TD Pass",
    pass_td_50p: "50+ Yard TD Pass", pass_int_td: "Pick Six Thrown",
    pass_att: "Pass Attempts", pass_sack: "Times Sacked",
    pass_cmp: "Completions", pass_cmp_40p: "40+ Yard Completion",
    pass_fd: "Passing First Downs", pass_inc: "Incompletions",
    rush_td_50p: "50+ Yard TD Run", rush_td_40p: "40+ Yard TD Run",
    rush_fd: "Rushing First Downs", rush_att: "Rush Attempts",
    rush_40p: "40+ Yard Rush", rec: "PPR", rec_fd: "Receiving First Downs",
    rec_0_4: "0–4 Yard Catch", rec_5_9: "5–9 Yard Catch",
    rec_10_19: "10–19 Yard Catch", rec_20_29: "20–29 Yard Catch",
    rec_30_39: "30–39 Yard Catch", rec_40p: "40+ Yard Catch",
    rec_td_40p: "40+ Yard TD Catch", rec_td_50p: "50+ Yard TD Catch",
    bonus_rec_rb: "RB Premium", bonus_rec_wr: "WR Premium", bonus_rec_te: "TE Premium",
  };
  return labels[key] || key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
};

/** Groups scoring rules into Passing / Rushing / Receiving buckets for display. */
export const groupRules = (rules: Array<{ key: string; value: number }>) => ({
  Passing: rules.filter((r) =>
    r.key.startsWith("pass") || r.key === "pass_int_td" ||
    r.key === "pass_cmp" || r.key === "pass_attempt" || r.key === "pass_sack"
  ),
  Rushing: rules.filter((r) => r.key.startsWith("rush")),
  Receiving: rules.filter((r) =>
    r.key === "rec" || r.key.startsWith("rec_") || r.key.startsWith("bonus_rec")
  ),
});
