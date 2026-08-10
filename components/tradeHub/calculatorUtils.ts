import type { SleeperRoster, SleeperPlayer } from "../../lib/types";

// Shared "essentially even" band for adjusted net, used by BOTH the Finder card badge and
// the manual calculator verdict so the same value gap can't read EVEN on one surface and
// WIN/LOSE on the other. Finder-native (stricter) value.
export const EVEN_NET_THRESHOLD = 100;

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

// A star discount applies when the best piece coming back is far below the value of the
// star being traded away — one fixed threshold/cap for every trade. Value is value: whether
// the star is offset by a player or a pick (or a mix) doesn't change how steep the discount
// is, so this deliberately does NOT special-case picks or their round (a prior version did,
// and the cap could swing 10x — 0.12 down to 0.0125 — purely because a low/mid-value pick was
// present instead of a player of the same value, which was the reported bug).
const STAR_DISCOUNT_THRESHOLD = 0.78;
const STAR_DISCOUNT_MAX_PCT = 0.12;

export function computeStarDiscounts(
  allGiveVals: number[],
  allRecvVals: number[],
): { onReceive: number; onGive: number } {
  if (allGiveVals.length === 0 || allRecvVals.length === 0) return { onReceive: 0, onGive: 0 };
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
      if (ratio < STAR_DISCOUNT_THRESHOLD)
        onReceive -= Math.round(
          Math.min((STAR_DISCOUNT_THRESHOLD - ratio) / 0.25, 1.0) * gv * STAR_DISCOUNT_MAX_PCT,
        );
    } else if (rv > gv && rv >= 2000) {
      const ratio = gv / rv;
      if (ratio < STAR_DISCOUNT_THRESHOLD)
        onGive -= Math.round(
          Math.min((STAR_DISCOUNT_THRESHOLD - ratio) / 0.25, 1.0) * rv * STAR_DISCOUNT_MAX_PCT,
        );
    }
  }
  return { onReceive, onGive };
}

// Adapter so the Trade Finder's sort key (FinderResults) and the card's
// displayed net (TradeCard) derive star discounts from the SAME canonical
// computeStarDiscounts call. They previously used divergent inline copies and
// disagreed — the list sorted by a different net than each card displayed.
export function computeFinderStarDiscounts(
  give: { value: number }[],
  receive: { value: number }[],
  givePicks: { value: number }[],
  receivePicks: { value: number }[],
): { onReceive: number; onGive: number } {
  const allGiveVals = [...give.map((p) => p.value), ...givePicks.map((p) => p.value)];
  const allRecvVals = [...receive.map((p) => p.value), ...receivePicks.map((p) => p.value)];
  return computeStarDiscounts(allGiveVals, allRecvVals);
}

// SINGLE source of truth for the Trade Finder's adjusted net, from the USER's perspective.
// Both the FinderResults sort key and the TradeCard displayed badge call this, so the list
// ordering and each card's net can never drift. Returns the full breakdown (drop costs and
// star discounts) so the card can render the adjustment lines from the same numbers.
// net > 0 favors the user; net < 0 means the user is paying up.
export function computeFinderAdjustedNet(
  trade: {
    give: { value: number; player_id?: string }[]; receive: { value: number }[];
    givePicks: { round: number | string; value: number }[];
    receivePicks: { round: number | string; value: number }[];
    oppRosterId: number;
    sweetenerPlayerId?: string;
  },
  calcDropCost: (rosterId: number, netPlayerGain: number) => number,
  myRosterId: number,
): {
  giveTotal: number; receiveTotal: number;
  myDropCost: number; oppDropCost: number;
  starOnGive: number; starOnReceive: number;
  giveTotalAdj: number; receiveTotalAdj: number; net: number;
} {
  // A sweetener piece is value-neutral: drop it from every value computation so the user's
  // net is the base trade's net. It still appears on the card (tagged) as a goodwill add.
  const give = trade.sweetenerPlayerId
    ? trade.give.filter((p) => p.player_id !== trade.sweetenerPlayerId)
    : trade.give;
  const giveTotal = [...give, ...trade.givePicks].reduce((s, p) => s + p.value, 0);
  const receiveTotal = [...trade.receive, ...trade.receivePicks].reduce((s, p) => s + p.value, 0);
  const netPlayerGain = trade.receive.length - give.length;
  const myDropCost  = netPlayerGain > 0 ? calcDropCost(myRosterId, netPlayerGain) : 0;
  const oppDropCost = netPlayerGain < 0 ? calcDropCost(trade.oppRosterId, -netPlayerGain) : 0;
  const { onReceive: starOnReceive, onGive: starOnGive } = computeFinderStarDiscounts(
    give, trade.receive, trade.givePicks, trade.receivePicks,
  );
  const giveTotalAdj    = giveTotal + myDropCost + starOnGive;
  const receiveTotalAdj = Math.max(0, receiveTotal + oppDropCost + starOnReceive);
  return {
    giveTotal, receiveTotal, myDropCost, oppDropCost, starOnGive, starOnReceive,
    giveTotalAdj, receiveTotalAdj, net: receiveTotalAdj - giveTotalAdj,
  };
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
