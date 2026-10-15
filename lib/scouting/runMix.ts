// The NFL's mix of designed runs, for the RB AE Score (the user's call,
// 2026-10-15). Pure.
//
// The RB AE Score is the user's "how well does he fit the league as an
// all-down back" score, so a back's runs count in the NFL's proportions, not
// his college offense's: a back who ran mostly inside gap is judged as if he'd
// run the NFL's share of inside zone. The SRAE column is untouched and keeps
// every run as charted. Only the AE Score's SRAE sample is reweighted (and so
// Dynasty and Dynasty+), as with the opponent adjustment.
//
// The mix. Zone vs gap is PFF's NFL rushing summary, every HB designed run of
// 2024 and 2025: 56.3% / 56.4% zone of zone + gap attempts. PFF has no
// inside / outside split of those, so each is split by the user's table
// (inside zone 40–45% vs outside zone 20–25%, inside gap 20–25% vs outside gap
// 10–15%: about 65% inside either way). The table put zone at ~65% overall;
// PFF's own count is 56.5%, so PFF's is used. On the same 138 charted games
// the user's charting reads 51.7% zone and PFF's 54.4%, so the two label runs
// on about the same scale.
//
// Each run type's share is moved from the back's own toward the NFL's by
// n / (n + RUN_MIX_PRIOR), the Inside / Outside tags' prior (roleFitRB.ts), so
// a run type he barely ran can't swing him: on 3 inside-zone runs he moves a
// tenth of the way to 37%. A type he never ran stays at 0 and the others
// share its weight.
//
// Measured 2026-10-15 on 40 charted backs: AE Score change mean 0.065, max
// 0.20 (RB scores spread ±0.86); 13 backs moved a spot or two within their
// class, the top two of each class held.

/** The four designed run types the RB board charts. */
export type DesignedRunType = "inside_zone" | "outside_zone" | "inside_man_gap" | "outside_man_gap";
export type RunMix = Readonly<Record<DesignedRunType, number>>;

export const NFL_RUN_MIX: RunMix = {
  inside_zone: 0.37,
  outside_zone: 0.195,
  inside_man_gap: 0.28,
  outside_man_gap: 0.155,
};
export const RUN_MIX_PRIOR = 30;

const TYPES = Object.keys(NFL_RUN_MIX) as DesignedRunType[];

/**
 * Each run's weight for one back, so his runs count in `mix`: his share of a
 * run type moved toward the mix's by n / (n + prior), renormalized, over his
 * own share. The weights average 1 over his runs. A run outside the four
 * types weighs 1.
 */
export function runMixWeight(
  runs: readonly { run_type: string }[],
  mix: RunMix = NFL_RUN_MIX,
  prior = RUN_MIX_PRIOR,
): (run: { run_type: string }) => number {
  const n = new Map<string, number>(TYPES.map((t) => [t, 0]));
  let total = 0;
  for (const r of runs) {
    if (!n.has(r.run_type)) continue;
    n.set(r.run_type, n.get(r.run_type)! + 1);
    total++;
  }
  const factor = new Map<string, number>();
  if (total === 0) return () => 1;
  const target = new Map<string, number>();
  for (const t of TYPES) {
    const k = n.get(t)!;
    const own = k / total;
    target.set(t, own + (mix[t] - own) * (k / (k + prior)));
  }
  const sum = TYPES.reduce((s, t) => s + target.get(t)!, 0);
  for (const t of TYPES) {
    const k = n.get(t)!;
    if (k > 0) factor.set(t, target.get(t)! / sum / (k / total));
  }
  return (r) => factor.get(r.run_type) ?? 1;
}
