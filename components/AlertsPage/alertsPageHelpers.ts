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

export const POS_COLOR: Record<string, string> = {
  QB: "text-red-400",
  RB: "text-green-400",
  WR: "text-blue-400",
  TE: "text-yellow-400",
};

export function resolvePlayerIdsInDetail(detail: string, players: Record<string, SleeperPlayer>): string {
  return detail.replace(/\b(\d{1,5})\b/g, (match) => {
    const p = players[match];
    return p?.full_name ?? match;
  });
}

/**
 * Renders the body text of a league trade alert.
 *
 * The leaguemate-alerts cron stores raw player IDs in payload.acquiredPlayerIds
 * / sentPlayerIds (skipping a 5 MB /players/nfl fetch per cron run). This helper
 * resolves those IDs using the client's already-loaded players map. For older
 * rows or non-internal league sources without structured IDs, falls back to
 * regex-resolving any digit runs in alert.detail.
 */
export function renderLeagueAlertDetail(
  alert: AlertsCenterItem,
  players: Record<string, SleeperPlayer>
): string {
  const payload = alert.payload as Record<string, unknown> | undefined;
  const acquiredIds = Array.isArray(payload?.acquiredPlayerIds)
    ? (payload.acquiredPlayerIds as string[])
    : null;
  const sentIds = Array.isArray(payload?.sentPlayerIds)
    ? (payload.sentPlayerIds as string[])
    : null;

  if (acquiredIds || sentIds) {
    const picksReceived = Array.isArray(payload?.picksReceived)
      ? (payload.picksReceived as string[])
      : [];
    const picksSent = Array.isArray(payload?.picksSent)
      ? (payload.picksSent as string[])
      : [];
    const leagueName =
      typeof payload?.leagueName === "string" ? payload.leagueName : "League";

    const resolveName = (pid: string): string =>
      players[pid]?.full_name ?? pid;

    const acquiredAll = [...(acquiredIds ?? []).map(resolveName), ...picksReceived];
    const sentAll = [...(sentIds ?? []).map(resolveName), ...picksSent];

    if (acquiredAll.length) {
      return sentAll.length
        ? `Received ${acquiredAll.join(", ")}, sent ${sentAll.join(", ")} in ${leagueName}.`
        : `Received ${acquiredAll.join(", ")} in ${leagueName}.`;
    }
    if (sentAll.length) {
      return `Sent ${sentAll.join(", ")} in ${leagueName}.`;
    }
  }

  return resolvePlayerIdsInDetail(alert.detail, players);
}

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
