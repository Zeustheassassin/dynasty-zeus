export { POS_COLOR } from "../../lib/uiTheme";

// Personal-vs-market buy/sell signal chip styling (Personal rankings view).
// STRONG_* are the hard-block tiers the Trade Finder enforces; SELL/BUY are soft.
export const PERSONAL_SIGNAL_META: Record<
  "STRONG_SELL" | "SELL" | "NEUTRAL" | "BUY" | "STRONG_BUY",
  { label: string; cls: string }
> = {
  STRONG_SELL: { label: "Super Sell", cls: "bg-red-900/60 text-red-300 border border-red-700/50 font-bold" },
  SELL:        { label: "Sell",       cls: "bg-red-900/30 text-red-400" },
  NEUTRAL:     { label: "Hold",       cls: "text-slate-600" },
  BUY:         { label: "Buy",        cls: "bg-emerald-900/30 text-emerald-400" },
  STRONG_BUY:  { label: "Super Buy",  cls: "bg-emerald-900/60 text-emerald-300 border border-emerald-700/50 font-bold" },
};

// Sleeper's injury_status is null/empty for healthy players and mixes
// abbreviations with full words for hurt ones (IR, O, Out, D, Doubtful, Q,
// Questionable, PUP, Sus, NA, DNR, Cov, NFI, "IR-Designated", etc. — see
// isIREligible in RosterOverviewTab.tsx and injuryStatusSeverity below,
// which classify the same way). This used to only recognize the exact
// codes IR/O/D/Q, so any other real status (PUP, Suspended, full-word
// spellings, ...) silently showed no badge at all — a player could read
// "healthy" here while flagged everywhere else in the app. Now excludes
// only the known-healthy/day-to-day statuses and badges everything else,
// with the least-specific bucket (Out/IR-severity) as the catch-all —
// matching injuryStatusSeverity's "anything unrecognized is most severe."
const INJURY_BADGE_HEALTHY_RE = /^(?:active|probable)$/i;
const INJURY_BADGE_TIERS: { re: RegExp; cls: string }[] = [
  { re: /^(?:q|questionable)$/i, cls: "bg-amber-900/70 text-amber-300" },
  { re: /^(?:d|doubtful)$/i, cls: "bg-orange-900/70 text-orange-300" },
];
const INJURY_BADGE_FALLBACK_CLS = "bg-red-900/70 text-red-300"; // O/Out, IR, and anything else unrecognized

export const injuryBadge = (status: string | null | undefined) => {
  const s = (status ?? "").trim();
  if (!s || INJURY_BADGE_HEALTHY_RE.test(s)) return null;
  const tier = INJURY_BADGE_TIERS.find((t) => t.re.test(s));
  const cls = tier?.cls ?? INJURY_BADGE_FALLBACK_CLS;
  // Short codes (<=3 chars, e.g. "IR", "PUP", "NFI") display as-is uppercased;
  // full words (e.g. "Questionable") collapse to their first letter to stay
  // badge-sized, matching the abbreviation the short-code path already shows.
  const label = s.length <= 3 ? s.toUpperCase() : s[0]!.toUpperCase();
  return <span className={`ml-1 rounded px-1 py-0.5 text-[9px] font-bold ${cls}`}>{label}</span>;
};

export const ageColor = (age: number | undefined, pos: string) => {
  if (!age) return "text-slate-600";
  if (pos === "RB") return age <= 23 ? "text-emerald-400" : age <= 26 ? "text-amber-400" : "text-red-400";
  return age <= 24 ? "text-emerald-400" : age <= 27 ? "text-amber-400" : "text-red-400";
};

// Injury risk score (Phase I, I2): position+age risk (same thresholds as
// ageColor) plus current injury-status severity. Sleeper mixes abbreviations
// and full words for injury_status (see RosterOverviewTab's isIREligible) —
// classify by regex rather than exact match so both "Q" and "Questionable"
// land in the same tier. Anything not Active/Probable/Questionable/Doubtful/
// Out is treated as the most severe tier (IR, PUP, NFI, Suspended, etc.).
const INJURY_SEVERITY_TIERS: { re: RegExp; score: number }[] = [
  { re: /^(?:q|questionable)$/i, score: 15 },
  { re: /^(?:d|doubtful)$/i, score: 30 },
  { re: /^(?:o|out)$/i, score: 40 },
];
const HEALTHY_STATUS_RE = /^(?:active|probable)$/i;

const injuryStatusSeverity = (status: string | null | undefined): number => {
  const s = (status ?? "").trim();
  if (!s || HEALTHY_STATUS_RE.test(s)) return 0;
  for (const { re, score } of INJURY_SEVERITY_TIERS) {
    if (re.test(s)) return score;
  }
  return 55;
};

const ageRiskScore = (age: number | undefined | null, pos: string): number => {
  if (!age) return 0;
  const [young, mid] = pos === "RB" ? [23, 26] : [24, 27];
  if (age <= young) return 0;
  if (age <= mid) return 10;
  return 25;
};

export interface InjuryRiskTier {
  label: "Low" | "Moderate" | "Elevated" | "High";
  short: string;
  cls: string;
  score: number;
}

export const injuryRiskTier = (
  age: number | undefined | null,
  pos: string,
  status: string | null | undefined,
): InjuryRiskTier => {
  const score = ageRiskScore(age, pos) + injuryStatusSeverity(status);
  if (score >= 50) return { label: "High", short: "HIGH", cls: "bg-red-900/70 text-red-300", score };
  if (score >= 30) return { label: "Elevated", short: "ELEV", cls: "bg-orange-900/70 text-orange-300", score };
  if (score >= 10) return { label: "Moderate", short: "MOD", cls: "bg-amber-900/70 text-amber-300", score };
  return { label: "Low", short: "LOW", cls: "bg-emerald-900/40 text-emerald-400", score };
};

// Distinct from injuryBadge (which shows the raw current status) — this is a
// forward-looking risk read combining position, age, and current status.
// Suppressed for the Low tier (score 0 = young + healthy) to avoid cluttering
// the common case; Low is only ever score 0 given the discrete score steps.
export const injuryRiskBadge = (
  age: number | undefined | null,
  pos: string,
  status: string | null | undefined,
) => {
  const tier = injuryRiskTier(age, pos, status);
  if (tier.score === 0) return null;
  return (
    <span
      className={`ml-1 rounded px-1 py-0.5 text-[9px] font-bold ${tier.cls}`}
      title={`Injury risk: ${tier.label} (position + age + current status)`}
    >
      {tier.short}
    </span>
  );
};
