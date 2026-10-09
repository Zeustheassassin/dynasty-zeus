// The sample dot's tiers (sampleSize.ts has the rule), on their own so the
// Draft Hub's board can draw saved dots without loading the scoring code.
//
// The user's tiers: green full, yellow 50–99.9%, orange 25–49.9%, red under 25%.

export type SampleTier = "full" | "half" | "quarter" | "low";

export const SAMPLE_TIERS: { tier: SampleTier; label: string; dot: string }[] = [
  { tier: "full",    label: "Full",      dot: "bg-emerald-400" },
  { tier: "half",    label: "50–99.9%",  dot: "bg-yellow-400" },
  { tier: "quarter", label: "25–49.9%",  dot: "bg-orange-500" },
  { tier: "low",     label: "Under 25%", dot: "bg-red-500" },
];
