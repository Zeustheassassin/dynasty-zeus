import type { AlertsCenterItem, SleeperPlayer, SleeperTransaction } from "../../lib/types";

export type DashboardAlert = AlertsCenterItem;

export type LeagueTransaction = SleeperTransaction & {
  leagueName: string;
  leagueId: string;
  rosterOwnerMap: Record<number, string>;
};

export type InjuryReportPlayer = {
  player: SleeperPlayer;
  playerId: string;
  leagues: string[];
  startingLeagues: string[];
  isWatchlisted: boolean;
};

export const severityStyles = {
  high: "border-red-700/70 bg-red-950/40 text-red-200",
  medium: "border-amber-700/70 bg-amber-950/40 text-amber-200",
  low: "border-slate-700 bg-slate-900 text-slate-200",
};

export { POS_COLOR } from "../../lib/uiTheme";

export function injuryStatusStyle(player: SleeperPlayer) {
  const s = (player.injury_status || player.status || "").toLowerCase();
  if (/ir|pup/.test(s))
    return { cls: "bg-red-900/60 text-red-300 border-red-700", label: player.injury_status || player.status };
  if (/out|suspended|inactive/.test(s))
    return { cls: "bg-red-900/40 text-red-400 border-red-800", label: player.injury_status || player.status };
  if (/doubtful/.test(s))
    return { cls: "bg-orange-900/40 text-orange-400 border-orange-700", label: "Doubtful" };
  if (/questionable/.test(s))
    return { cls: "bg-yellow-900/40 text-yellow-400 border-yellow-700", label: "Questionable" };
  return { cls: "bg-slate-800/40 text-slate-400 border-slate-700", label: "Active" };
}

export function getInjuredCount(injuryReportPlayers: InjuryReportPlayer[]): number {
  return injuryReportPlayers.filter((r) => {
    const s = (r.player.injury_status || r.player.status || "").toLowerCase();
    return /ir|pup|out|doubtful|questionable|suspended|inactive/.test(s);
  }).length;
}

/** Splits value-movement alerts (market/watchlist category with a direction
 *  payload) into gainers/fallers, each sorted by magnitude of delta. Shared
 *  between AlertsPage's "movers" tab and the Dashboard's Value Movers panel. */
export function getMarketMovers(alerts: DashboardAlert[]) {
  const marketAlerts = alerts.filter(
    (a) => (a.category === "market" || a.category === "watchlist") && a.payload?.["direction"]
  );
  const gainers = [...marketAlerts]
    .filter((a) => a.payload?.["direction"] === "up")
    .sort((a, b) => ((b.payload?.["delta"] as number ?? 0) - (a.payload?.["delta"] as number ?? 0)));
  const fallers = [...marketAlerts]
    .filter((a) => a.payload?.["direction"] === "down")
    .sort((a, b) => ((a.payload?.["delta"] as number ?? 0) - (b.payload?.["delta"] as number ?? 0)));
  return { marketAlerts, gainers, fallers };
}

export function relTime(ts: number): string {
  const ms = Date.now() - ts;
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
