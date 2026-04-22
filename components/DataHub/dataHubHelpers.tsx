export const POS_COLOR: Record<string, string> = {
  QB: "text-red-400",
  RB: "text-green-400",
  WR: "text-blue-400",
  TE: "text-yellow-400",
};

export const sellColor = (v: string) =>
  v === "Trade at All Costs" ? "text-green-400" :
  v === "Lower than Market"  ? "text-green-600" :
  v === "Not Willing to Trade" ? "text-red-400" :
  v === "Will Trade but Higher than Market" ? "text-yellow-400" : "text-gray-500";

export const buyColor = (v: string) =>
  v === "Buy Over Market" ? "text-green-400" :
  v === "Buy at Market"   ? "text-green-600" :
  v === "Zero Interest"   ? "text-red-400" :
  v === "Buy Low"         ? "text-yellow-400" : "text-gray-500";

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
