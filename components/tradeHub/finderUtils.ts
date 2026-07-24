import type { AugmentedPick, SleeperPlayer, SleeperRoster } from "../../lib/types";
import type { PlayerWithValue } from "./shared";
import { pickDispositionKey } from "../../lib/helpers/dispositions";

export const finderPickKey = (p: AugmentedPick): string => pickDispositionKey(p);

export const buildPostTradePlayers = (
  baseRoster: SleeperRoster | undefined,
  givePlayers: PlayerWithValue[],
  receivePlayers: PlayerWithValue[],
  allPlayers: Record<string, SleeperPlayer>,
  fcValues: Record<string, number>,
): PlayerWithValue[] => {
  const giveIds = new Set(givePlayers.map((p) => p.player_id));
  return [
    ...(baseRoster?.players || [])
      .map((id: string) => allPlayers[id])
      .filter((p): p is SleeperPlayer => !!p && !giveIds.has(p.player_id))
      .map((p) => ({ ...p, value: fcValues[p.player_id] ?? p.value ?? 0 })),
    ...receivePlayers,
  ].filter((p) => p && ["QB", "RB", "WR", "TE"].includes(p.position));
};

export const getNFLDepthIdx = (
  team: string,
  pos: string,
  playerId: string,
  nflTeamDepth: Map<string, Record<string, PlayerWithValue[]>>,
): number | null => {
  const group = nflTeamDepth.get(team)?.[pos] ?? [];
  const idx = group.findIndex((p) => p.player_id === playerId);
  return idx >= 0 ? idx : null;
};

export const computePosRank = (
  pos: string,
  rosterId: number,
  posTeamTotals: { rosterId: number; totals: Record<string, number> }[],
  overrideTotal?: number,
): number => {
  const vals = posTeamTotals
    .map((t) =>
      t.rosterId === rosterId && overrideTotal !== undefined ? overrideTotal : (t.totals[pos] ?? 0)
    )
    .sort((a, b) => b - a);
  const myVal =
    overrideTotal !== undefined
      ? overrideTotal
      : (posTeamTotals.find((t) => t.rosterId === rosterId)?.totals[pos] ?? 0);
  let rank = 1;
  for (const v of vals) { if (myVal >= v) break; rank++; }
  return rank;
};
