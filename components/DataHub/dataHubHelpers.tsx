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
  STRONG_SELL: { label: "SELL", cls: "bg-red-900/60 text-red-300 border border-red-700/50 font-bold" },
  SELL:        { label: "Sell", cls: "bg-red-900/30 text-red-400" },
  NEUTRAL:     { label: "—",    cls: "text-gray-600" },
  BUY:         { label: "Buy",  cls: "bg-green-900/30 text-green-400" },
  STRONG_BUY:  { label: "BUY",  cls: "bg-green-900/60 text-green-300 border border-green-700/50 font-bold" },
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
