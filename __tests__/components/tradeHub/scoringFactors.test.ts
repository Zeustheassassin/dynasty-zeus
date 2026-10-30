import { describe, it, expect } from "vitest";
import { createScoringFactors, type ScoringFactorsParams } from "@/components/tradeHub/hooks/useScoringFactors";
import type { TradeResult } from "@/components/tradeHub/finderTypes";
import type { PlayerWithValue, PickWithValue } from "@/components/tradeHub/shared";
import { CURRENT_YEAR } from "@/lib/helpers/season";

const params = (over: Partial<ScoringFactorsParams> = {}): ScoringFactorsParams => ({
  finderDirection: "Rebuilder",
  iAmTankingFinder: false,
  isStockpiledRebuild: true,
  draftCapitalMode: true,
  myFinderPlayoffOdds: 10,
  weakPositions: new Set<string>(),
  strongPositions: new Set<string>(),
  myT: { QB: 0, RB: 0, WR: 0, TE: 0 },
  numTeams: 12,
  allTeamPosTotals: [],
  starterSlots: [],
  starterCounts: { QB: 1, RB: 2, WR: 2, TE: 1 },
  hasSuperFlex: false,
  hasFlex: false,
  myPlayers: [],
  myRoster: undefined,
  rosterById: new Map(),
  rosterPlayers: () => [],
  allPicks: [],
  redraftValues: {},
  marketSignalMap: new Map(),
  players: {},
  calcFcValues: {},
  ...over,
});

const player = (id: string, value: number, age = 27): PlayerWithValue =>
  ({ player_id: id, position: "WR", value, age }) as unknown as PlayerWithValue;
const pick = (round: number, value: number): PickWithValue =>
  ({ season: String(Number(CURRENT_YEAR) + 1), round, value }) as unknown as PickWithValue;
const forPick = (p: PickWithValue): TradeResult => ({
  give: [player("g1", 3000)], receive: [], givePicks: [], receivePicks: [p],
  oppName: "Opp", oppRosterId: 2, score: 0, net: p.value - 3000, format: "1 for 1", draftCapital: true,
});

// 10/30 user call: a pick-rich ("Consolidate") rebuild can still see trades that bring picks
// back. Its scoring branch still doesn't REWARD hoarding picks, but no longer penalizes them.
describe("getDirectionTradeScore — Consolidate rebuild", () => {
  it("is neutral on picks coming in: neither their value nor a future 1st changes the score", () => {
    const { getDirectionTradeScore } = createScoringFactors(params());
    const cheapSecond = getDirectionTradeScore(forPick(pick(2, 1500)));
    expect(getDirectionTradeScore(forPick(pick(2, 3000)))).toBe(cheapSecond);
    expect(getDirectionTradeScore(forPick(pick(1, 3000)))).toBe(cheapSecond);
  });

  it("the plain rebuild branch still rewards picks coming in", () => {
    const { getDirectionTradeScore } = createScoringFactors(params({ isStockpiledRebuild: false }));
    expect(getDirectionTradeScore(forPick(pick(1, 3000)))).toBeGreaterThan(getDirectionTradeScore(forPick(pick(2, 1500))));
  });
});
