// ============================================================
// Fantasy scoring helpers — rules comparison, formatting, grouping.
// Used by LeagueHub and DataHub to display non-standard scoring.
// ============================================================

/** Normalises a projection source player name for fuzzy matching:
 *  strips suffixes (Jr, II, etc.) and non-alpha characters. */
export const normalizeProjName = (n: string) =>
  n.toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/gi, "")
    .replace(/[^a-z]/g, "");

/** Standard PPR-like baseline used to detect non-standard scoring rules. */
export const STANDARD_SCORING: Record<string, number> = {
  pass_yd: 0.04, pass_td: 4, pass_int: -2, pass_first_down: 0,
  pass_cmp: 0, pass_inc: 0, pass_attempt: 0, pass_sack: 0,
  pass_sack_yd: 0, pass_pick_six: 0, bonus_pass_yd_40: 0,
  bonus_pass_td_40: 0, bonus_pass_td_50: 0, rush_yd: 0.1,
  rush_td: 6, rec: 0, rec_yd: 0.1, rec_td: 6,
  rec_2pt: 2, rush_2pt: 2, pass_2pt: 2,
};

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
