export const POS_COLOR: Record<string, string> = {
  QB: "text-red-400",
  RB: "text-green-400",
  WR: "text-blue-400",
  TE: "text-yellow-400",
};

// Personal-vs-market buy/sell signal chip styling (Personal rankings view).
// STRONG_* are the hard-block tiers the Trade Finder enforces; SELL/BUY are soft.
export const PERSONAL_SIGNAL_META: Record<
  "STRONG_SELL" | "SELL" | "NEUTRAL" | "BUY" | "STRONG_BUY",
  { label: string; cls: string }
> = {
  STRONG_SELL: { label: "Super Sell", cls: "bg-red-900/60 text-red-300 border border-red-700/50 font-bold" },
  SELL:        { label: "Sell",       cls: "bg-red-900/30 text-red-400" },
  NEUTRAL:     { label: "Hold",       cls: "text-gray-600" },
  BUY:         { label: "Buy",        cls: "bg-green-900/30 text-green-400" },
  STRONG_BUY:  { label: "Super Buy",  cls: "bg-green-900/60 text-green-300 border border-green-700/50 font-bold" },
};

const INJURY_CLS: Record<string, string> = {
  IR: "bg-red-900/70 text-red-300",
  O:  "bg-red-900/70 text-red-300",
  D:  "bg-orange-900/70 text-orange-300",
  Q:  "bg-yellow-900/70 text-yellow-300",
};

export const injuryBadge = (status: string | null | undefined) => {
  if (!status) return null;
  const s = status.toUpperCase();
  const cls = INJURY_CLS[s];
  if (!cls) return null;
  return <span className={`ml-1 rounded px-1 py-0.5 text-[9px] font-bold ${cls}`}>{s}</span>;
};

export const ageColor = (age: number | undefined, pos: string) => {
  if (!age) return "text-gray-600";
  if (pos === "RB") return age <= 23 ? "text-green-400" : age <= 26 ? "text-yellow-400" : "text-red-400";
  return age <= 24 ? "text-green-400" : age <= 27 ? "text-yellow-400" : "text-red-400";
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
  if (score >= 10) return { label: "Moderate", short: "MOD", cls: "bg-yellow-900/70 text-yellow-300", score };
  return { label: "Low", short: "LOW", cls: "bg-green-900/40 text-green-400", score };
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
