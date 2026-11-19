// The sample dot's tiers (sampleSize.ts has the rest), on their own so the
// Draft Hub's board can draw saved dots, and the Prospect board's Fully
// Charted can read the full samples, without loading the scoring code.
//
// The user's tiers: green full, yellow 50–99.9%, orange 25–49.9%, red under 25%.

export type SampleTier = "full" | "half" | "quarter" | "low";

export const SAMPLE_TIERS: { tier: SampleTier; label: string; dot: string }[] = [
  { tier: "full",    label: "Full",      dot: "bg-emerald-400" },
  { tier: "half",    label: "50–99.9%",  dot: "bg-yellow-400" },
  { tier: "quarter", label: "25–49.9%",  dot: "bg-orange-500" },
  { tier: "low",     label: "Under 25%", dot: "bg-red-500" },
];

/**
 * A full sample, in the plays the position's headline AE metric reads: QB
 * graded throws, RB runs with a known run type, WR routes, TE rated routes.
 * The user's (2026-10-09). RB 125 → 100 on 2026-11-19 ("a lot of these backs
 * are only getting 120 carries in a full season as these college programs run
 * split backfields a ton").
 */
export const SAMPLE_FULL_PLAYS: Record<"QB" | "RB" | "WR" | "TE", number> = { QB: 180, RB: 100, WR: 160, TE: 140 };

export function sampleTier(n: number, full: number): SampleTier {
  if (n >= full) return "full";
  if (n >= full * 0.5) return "half";
  if (n >= full * 0.25) return "quarter";
  return "low";
}
