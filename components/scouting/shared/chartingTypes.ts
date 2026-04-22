export type BoardTab = "overview" | "chart" | "games";

export function pct(n: number, d: number): number | null {
  return d > 0 ? parseFloat(((n / d) * 100).toFixed(1)) : null;
}

export function fmtPct(v: number | null): string {
  return v !== null ? `${v}%` : "—";
}
