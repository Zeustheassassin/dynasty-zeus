import type { SleeperRoster, SleeperPlayer } from "../../lib/types";

export function computeRosterDropCost(
  roster: SleeperRoster | null | undefined,
  netPlayerGain: number,
  rosterLimit: number,
  fcValues: Record<string, number>,
): number {
  if (!roster || netPlayerGain <= 0) return 0;
  const currentCount = (roster.players ?? []).length;
  const openSlots = Math.max(0, rosterLimit - currentCount);
  const dropsNeeded = Math.max(0, netPlayerGain - openSlots);
  if (dropsNeeded === 0) return 0;
  const sorted = (roster.players ?? [])
    .map((pid) => fcValues[pid] ?? 0)
    .sort((a, b) => a - b);
  return sorted.slice(0, dropsNeeded).reduce((s, v) => s + v, 0);
}

export function computeStarDiscounts(
  allGiveVals: number[],
  allRecvVals: number[],
  calcGivePicks: string[],
  calcReceivePicks: string[],
  getPickValue: (k: string) => number,
): { onReceive: number; onGive: number } {
  if (allGiveVals.length === 0 || allRecvVals.length === 0) return { onReceive: 0, onGive: 0 };
  const globalTop = Math.max(...allGiveVals, ...allRecvVals);
  const pickParams = (keys: string[]): { threshold: number; maxPct: number } => {
    if (keys.length === 0) return { threshold: 0.78, maxPct: 0.12 };
    const best = Math.min(...keys.map((k) => Math.floor(Number(k.split("-")[1]))));
    if (best === 1) {
      const bestVal = Math.max(
        ...keys
          .filter((k) => Math.floor(Number(k.split("-")[1])) === 1)
          .map((k) => getPickValue(k)),
      );
      if (bestVal >= globalTop * 0.97) return { threshold: 0.78, maxPct: 0.12 };
      return { threshold: 0.78, maxPct: 0.0125 };
    }
    if (best === 2) return { threshold: 0.83, maxPct: 0.09 };
    if (best === 3) return { threshold: 0.87, maxPct: 0.14 };
    return { threshold: 0.91, maxPct: 0.20 };
  };
  const recvParams = pickParams(calcReceivePicks);
  const giveParams = pickParams(calcGivePicks);
  const giveSorted = [...allGiveVals].sort((a, b) => b - a);
  const recvSorted = [...allRecvVals].sort((a, b) => b - a);
  let onReceive = 0;
  let onGive = 0;
  const pairs = Math.min(giveSorted.length, recvSorted.length);
  for (let i = 0; i < pairs; i++) {
    const gv = giveSorted[i];
    const rv = recvSorted[i];
    if (gv > rv && gv >= 2000) {
      const ratio = rv / gv;
      if (ratio < recvParams.threshold)
        onReceive -= Math.round(
          Math.min((recvParams.threshold - ratio) / 0.25, 1.0) * gv * recvParams.maxPct,
        );
    } else if (rv > gv && rv >= 2000) {
      const ratio = gv / rv;
      if (ratio < giveParams.threshold)
        onGive -= Math.round(
          Math.min((giveParams.threshold - ratio) / 0.25, 1.0) * rv * giveParams.maxPct,
        );
    }
  }
  return { onReceive, onGive };
}

export function computePosTotals(
  playerIds: string[],
  players: Record<string, SleeperPlayer>,
  calcVal: (id: string) => number,
): Record<string, number> {
  const t: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
  playerIds.forEach((id) => {
    const p = players[id];
    if (p && ["QB", "RB", "WR", "TE"].includes(p.position)) {
      t[p.position] = (t[p.position] || 0) + calcVal(id);
    }
  });
  return t;
}

export function computeLeagueRank(
  allTeamsPos: Record<string, number>[],
  pos: string,
  total: number,
  rosterCount: number,
): number {
  const sorted = allTeamsPos.map((teamPos) => teamPos[pos] || 0).sort((a, b) => b - a);
  let rank = 1;
  for (const val of sorted) {
    if (total >= val) break;
    rank++;
  }
  return Math.min(rank, rosterCount);
}
