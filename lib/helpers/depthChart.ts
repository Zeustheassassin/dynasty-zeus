import type { SleeperPlayer } from "../types";

const UNAVAILABLE = /out|ir|suspended|inactive/i;

/** Who moves up when a player goes out: the first healthy player behind him on his team's depth
 *  chart at his position. A player off the chart (Sleeper drops some once they're hurt) leaves the
 *  healthy player highest on it. Players Sleeper hasn't placed on the chart aren't candidates. */
export function nextManUp(
  players: Record<string, SleeperPlayer>,
  injuredId: string,
): [string, SleeperPlayer] | null {
  const injured = players[injuredId];
  if (!injured?.team || !injured.position) return null;
  const injuredOrder = injured.depth_chart_order ?? null;
  const behind = Object.entries(players)
    .filter(([id, p]) =>
      id !== injuredId
      && p?.team === injured.team
      && p?.position === injured.position
      && p?.depth_chart_order != null
      && (injuredOrder === null || p.depth_chart_order > injuredOrder)
      && !UNAVAILABLE.test(p.injury_status || p.status || ""))
    .sort(([, a], [, b]) => (a.depth_chart_order ?? 99) - (b.depth_chart_order ?? 99));
  return behind[0] ?? null;
}
