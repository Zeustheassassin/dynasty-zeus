import { describe, it, expect } from "vitest";
import { runFinderPipeline } from "@/components/tradeHub/finderPipeline";
import type { FinderPipelineCtx } from "@/components/tradeHub/finderPipeline";
import type { TradeResult } from "@/components/tradeHub/finderTypes";
import type { PlayerWithValue, PickWithValue } from "@/components/tradeHub/shared";
import type { SleeperPlayer, SleeperRoster, SleeperLeague } from "@/lib/types";
import { CURRENT_YEAR } from "@/lib/helpers/season";

// ─────────────────────────────────────────────────────────────────────────
// Fixture builders
// ─────────────────────────────────────────────────────────────────────────

const CY = CURRENT_YEAR;

const mkPlayer = (
  id: string,
  position: string,
  value: number,
  extra: Partial<SleeperPlayer> = {},
): PlayerWithValue =>
  ({
    player_id: id,
    position,
    value,
    age: 25,
    team: "FA",
    ...extra,
  }) as unknown as PlayerWithValue;

const mkRoster = (rosterId: number, ownerId: string, players: string[]): SleeperRoster =>
  ({
    roster_id: rosterId,
    owner_id: ownerId,
    league_id: "L1",
    players,
    starters: [],
    reserve: null,
    taxi: null,
    co_owners: null,
    settings: { wins: 0, losses: 0, ties: 0, fpts: 0, fpts_decimal: 0, fpts_against: 0, fpts_against_decimal: 0 },
  }) as unknown as SleeperRoster;

const mkLeague = (): SleeperLeague =>
  ({
    league_id: "L1",
    name: "Test",
    season: CY,
    season_type: "regular",
    status: "in_season",
    sport: "nfl",
    total_rosters: 12,
    // 9 starter slots + 16 bench = roster size 25 (default in oppDropCostPenalty)
    roster_positions: [
      "QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "FLEX", "SUPER_FLEX",
      "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN",
    ],
    settings: { playoff_week_start: 15, playoff_teams: 6, num_teams: 12 },
    scoring_settings: {},
    avatar: null,
    draft_id: null,
    previous_league_id: null,
  }) as unknown as SleeperLeague;

const mkTrade = (over: Partial<TradeResult>): TradeResult => ({
  give: [],
  receive: [],
  givePicks: [],
  receivePicks: [],
  oppName: "Opp",
  oppRosterId: 2,
  score: 100,
  net: 0,
  format: "1-for-1",
  ...over,
});

// A minimal context where every behavioral knob is "neutral/pass" so the
// observable result is driven by the trades fed in. Individual tests override
// only the fields they exercise.
const baseCtx = (over: Partial<FinderPipelineCtx> = {}): FinderPipelineCtx => {
  const league = mkLeague();
  const myRoster = mkRoster(1, "USER", []);
  const oppRoster = mkRoster(2, "OPP", []);
  return {
    allPicks: [],
    players: {},
    calcFcValues: {},
    redraftValues: {},
    rosters: [myRoster, oppRoster],
    selectedLeague: league,
    user: { user_id: "USER", username: "u", display_name: "U", avatar: null },
    myPlayers: [],
    myRoster,
    numTeams: 12,
    starterCounts: { QB: 1, RB: 2, WR: 2, TE: 1 },
    hasSuperFlex: false,
    draftYearPriority: {},
    priorityDraftYear: CY,
    weakPositions: new Set<string>(),
    finderDirection: "Neutral",
    finderTankMode: false,
    draftCapitalMode: false,
    finderPreferFuturePicks: false,
    iAmTankingFinder: false,
    myFinderPlayoffOdds: 50,
    isChampionshipPush: false,
    pinnedPlayer: null,
    deferredTargetPlayerId: null,
    deferredPinnedPlayerId: null,
    deferredTargetOppRosterId: null,
    deferredFinderSeed: 1,
    nflTeamDepth: new Map(),
    tradePartnerRankings: [],
    leagueMateProfileByRosterId: new Map(),
    tradeAttempts: [],
    historicalSnapshot: null,
    playerStats: null,
    crossLeagueExposure: null,
    buyLowPlayerIds: [],
    nflState: { week: 7, season_type: "regular", season: CY, display_week: 7 },
    selectedLeagueSimulation: null,
    selectedLeagueDraftHasOccurred: true,
    weeklyProjMap: new Map(),
    playerDispositions: {},
    // Functions — neutral stubs
    finderPickValue: (p) => (p as unknown as PickWithValue).value ?? 0,
    buildPostTradePlayers: () => [],
    getNFLDepthIdx: () => null,
    rosterPlayers: () => [],
    isBlockedSellDisposition: () => false,
    isBlockedBuyDisposition: () => false,
    isWantToTrade: () => false,
    isOffload: () => false,
    isPricey: () => false,
    isOpenToSell: () => false,
    failsDirectionGuardrail: () => false,
    getDirectionTradeScore: () => 0,
    getTradeLineupSafety: () => ({ valid: true, myValid: true, oppValid: true, score: 0 }),
    ...over,
  };
};

// ─────────────────────────────────────────────────────────────────────────
// Basic acceptance / filtering
// ─────────────────────────────────────────────────────────────────────────

describe("runFinderPipeline — basic acceptance & filtering", () => {
  it("passes a clean positive-score 1-for-1 trade through to allTrades", () => {
    const t = mkTrade({
      give: [mkPlayer("g1", "WR", 3000)],
      receive: [mkPlayer("r1", "RB", 3000)],
    });
    const { allTrades } = runFinderPipeline([t], baseCtx());
    expect(allTrades).toHaveLength(1);
    expect(allTrades[0].receive[0].player_id).toBe("r1");
  });

  it("drops trades with non-finite score", () => {
    const good = mkTrade({ give: [mkPlayer("g1", "WR", 3000)], receive: [mkPlayer("r1", "RB", 3000)] });
    const bad = mkTrade({
      give: [mkPlayer("g2", "WR", 3000)],
      receive: [mkPlayer("r2", "RB", 3000)],
      score: Number.POSITIVE_INFINITY,
    });
    const { allTrades } = runFinderPipeline([good, bad], baseCtx());
    expect(allTrades).toHaveLength(1);
    expect(allTrades[0].give[0].player_id).toBe("g1");
  });

  it("drops trades where a given player has a blocked sell disposition", () => {
    const t = mkTrade({ give: [mkPlayer("blocked", "WR", 3000)], receive: [mkPlayer("r1", "RB", 3000)] });
    const { allTrades } = runFinderPipeline(
      [t],
      baseCtx({ isBlockedSellDisposition: (id) => id === "blocked" }),
    );
    expect(allTrades).toHaveLength(0);
  });

  it("drops trades where a received player has a blocked buy disposition", () => {
    const t = mkTrade({ give: [mkPlayer("g1", "WR", 3000)], receive: [mkPlayer("blocked", "RB", 3000)] });
    const { allTrades } = runFinderPipeline(
      [t],
      baseCtx({ isBlockedBuyDisposition: (id) => id === "blocked" }),
    );
    expect(allTrades).toHaveLength(0);
  });

  it("drops trades the opponent's direction rejects (buyer asked to give a player for only our pick)", () => {
    // oppDirOk Rule 2 (now bucket-aware, in-pipeline): an elite/contender opponent won't
    // give up a player when all they get back is the user's pick.
    const eliteOpp = {
      rosterId: 2,
      playoffOdds: 85,
      directionProfile: { bucket: "Elite" },
    } as unknown as FinderPipelineCtx["tradePartnerRankings"][number];
    const t = mkTrade({
      give: [],
      givePicks: [{ round: 1, season: CY, value: 2500 } as unknown as PickWithValue],
      receive: [mkPlayer("r1", "RB", 3000)],
      receivePicks: [],
    });
    const { allTrades } = runFinderPipeline([t], baseCtx({ tradePartnerRankings: [eliteOpp] }));
    expect(allTrades).toHaveLength(0);
  });

  it("drops a standard swap that is clearly net-negative for the opponent (acceptance gate)", () => {
    // Hopeless/rebuilder opponent receiving an aging vet for a young building block, no picks
    // back → strongly negative oppDirectionScore → below ACCEPT_FLOOR → rejected.
    const rebuildOpp = {
      rosterId: 2,
      playoffOdds: 10,
      directionProfile: { bucket: "Hopeless" },
    } as unknown as FinderPipelineCtx["tradePartnerRankings"][number];
    const t = mkTrade({
      give: [mkPlayer("vet", "RB", 4000, { age: 30 })],      // opp receives an aging vet
      receive: [mkPlayer("young", "WR", 4000, { age: 22 })], // opp gives a young building block
      oppRosterId: 2,
    });
    const { allTrades } = runFinderPipeline([t], baseCtx({ tradePartnerRankings: [rebuildOpp] }));
    expect(allTrades).toHaveLength(0);
  });

  it("drops a trade whose balance depends on a sub-700 filler piece (anti-padding gate)", () => {
    // give a 3000 WR for a 2400 RB + a 550 WR. Without the 550, [3000] vs [2400] fails
    // isBalanced (ratio 0.8) — the 550 is load-bearing fake balance → dropped.
    const t = mkTrade({
      give: [mkPlayer("g1", "WR", 3000, { team: "SF" })],
      receive: [mkPlayer("r1", "RB", 2400, { team: "KC" }), mkPlayer("r2", "WR", 550, { team: "BUF" })],
      format: "1 for 2",
    });
    const { allTrades } = runFinderPipeline([t], baseCtx());
    expect(allTrades).toHaveLength(0);
  });

  it("keeps a multi-piece trade already balanced without its sub-700 piece", () => {
    // [3000] vs [3000] is balanced without the 500 bonus, so the 500 is a genuine extra
    // (not fake balance) and survives the anti-padding gate.
    const t = mkTrade({
      give: [mkPlayer("g1", "WR", 3000, { team: "SF" })],
      receive: [mkPlayer("r1", "RB", 3000, { team: "KC" }), mkPlayer("r2", "WR", 500, { team: "BUF" })],
      format: "1 for 2",
    });
    const { allTrades } = runFinderPipeline([t], baseCtx());
    expect(allTrades).toHaveLength(1);
  });

  it("sweetener is value-neutral: a variant surfaces exactly when its plain base does", () => {
    // A sub-700 sweetener (stripped from isBalanced/net AND every give-side scoring term) must
    // not change whether the underlying deal surfaces. Run the base and its variant separately;
    // their gate outcomes must match.
    const mk = (withSweet: boolean) =>
      mkTrade(withSweet
        ? {
            give: [mkPlayer("mp", "WR", 3000, { team: "SF" }), mkPlayer("sweet", "WR", 400, { age: 22, team: "BUF" })],
            receive: [mkPlayer("op", "RB", 3000, { team: "KC" })],
            sweetenerPlayerId: "sweet",
            format: "1 for 1 + sweetener",
          }
        : {
            give: [mkPlayer("mp", "WR", 3000, { team: "SF" })],
            receive: [mkPlayer("op", "RB", 3000, { team: "KC" })],
            format: "1 for 1",
          });
    const baseOut = runFinderPipeline([mk(false)], baseCtx()).allTrades.length;
    const variantOut = runFinderPipeline([mk(true)], baseCtx()).allTrades.length;
    expect(baseOut).toBe(1);
    expect(variantOut).toBe(baseOut);
    // The variant that surfaces still carries its sweetener flag (for the card's tagged row).
    expect(runFinderPipeline([mk(true)], baseCtx()).allTrades[0].sweetenerPlayerId).toBe("sweet");
  });

  it("blocks a non-contender from ACQUIRING an aging veteran (window guardrail)", () => {
    // Rebuilder at 5% odds receiving a 32-year-old TE = burning dynasty value over a window
    // they aren't competing in → hard-dropped regardless of value.
    const t = mkTrade({
      give: [mkPlayer("young", "TE", 2400, { age: 22, team: "NYJ" })],
      receive: [mkPlayer("kittle", "TE", 2495, { age: 32, team: "SF" })],
      format: "1 for 1",
    });
    const { allTrades } = runFinderPipeline([t], baseCtx({ finderDirection: "Rebuilder", myFinderPlayoffOdds: 5 }));
    expect(allTrades).toHaveLength(0);
  });

  it("lets a contender ACQUIRE an aging veteran (win-now patch)", () => {
    // Same trade, but the user is a contender — acquiring win-now production is legitimate.
    const t = mkTrade({
      give: [mkPlayer("young", "TE", 2400, { age: 22, team: "NYJ" })],
      receive: [mkPlayer("kittle", "TE", 2495, { age: 32, team: "SF" })],
      format: "1 for 1",
    });
    const { allTrades } = runFinderPipeline([t], baseCtx({ finderDirection: "Elite", myFinderPlayoffOdds: 80 }));
    expect(allTrades).toHaveLength(1);
  });

  it("an actively-tanking team can't acquire an aging vet even with a stale contender bucket", () => {
    // Almost There bucket but tanking at 30% odds — must NOT read as win-now (crossover 4.3).
    const t = mkTrade({
      give: [mkPlayer("young", "TE", 2400, { age: 22, team: "NYJ" })],
      receive: [mkPlayer("kittle", "TE", 2495, { age: 32, team: "SF" })],
      format: "1 for 1",
    });
    const { allTrades } = runFinderPipeline(
      [t],
      baseCtx({ finderDirection: "Almost There", myFinderPlayoffOdds: 30, iAmTankingFinder: true }),
    );
    expect(allTrades).toHaveLength(0);
  });

  it("a seller-bucket team can't acquire an aging vet even at >=50% odds", () => {
    // Rebuilder at 60% odds is value-rich/points-poor, not a buyer of aging vets (crossover 4.4).
    const t = mkTrade({
      give: [mkPlayer("young", "TE", 2400, { age: 22, team: "NYJ" })],
      receive: [mkPlayer("kittle", "TE", 2495, { age: 32, team: "SF" })],
      format: "1 for 1",
    });
    const { allTrades } = runFinderPipeline(
      [t],
      baseCtx({ finderDirection: "Rebuilder", myFinderPlayoffOdds: 60 }),
    );
    expect(allTrades).toHaveLength(0);
  });

  it("drops trades whose total strategyScore is not positive", () => {
    // score is hugely negative so even the +12 format bonus can't lift it above 0
    const t = mkTrade({
      give: [mkPlayer("g1", "WR", 3000)],
      receive: [mkPlayer("r1", "RB", 3000)],
      score: -1000,
    });
    const { allTrades } = runFinderPipeline([t], baseCtx());
    expect(allTrades).toHaveLength(0);
  });

  it("drops trades that fail lineup safety", () => {
    const t = mkTrade({ give: [mkPlayer("g1", "WR", 3000)], receive: [mkPlayer("r1", "RB", 3000)] });
    const { allTrades } = runFinderPipeline(
      [t],
      baseCtx({ getTradeLineupSafety: () => ({ valid: false, myValid: false, oppValid: false, score: 0 }) }),
    );
    expect(allTrades).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Pinned-player and target-player gates
// ─────────────────────────────────────────────────────────────────────────

describe("runFinderPipeline — pinned & target gates", () => {
  it("when a player is pinned, only trades giving that player survive", () => {
    const pinned = mkPlayer("PIN", "WR", 3000);
    const giving = mkTrade({ give: [pinned], receive: [mkPlayer("r1", "RB", 3000)] });
    const notGiving = mkTrade({
      give: [mkPlayer("g9", "WR", 3000)],
      receive: [mkPlayer("r9", "RB", 3000)],
      oppRosterId: 2,
    });
    const { allTrades } = runFinderPipeline(
      [giving, notGiving],
      baseCtx({ pinnedPlayer: pinned }),
    );
    expect(allTrades).toHaveLength(1);
    expect(allTrades[0].give[0].player_id).toBe("PIN");
  });

  it("when a target player is set, only trades receiving that player survive", () => {
    const receiving = mkTrade({ give: [mkPlayer("g1", "WR", 3000)], receive: [mkPlayer("TGT", "RB", 3000)] });
    const notReceiving = mkTrade({
      give: [mkPlayer("g2", "WR", 3000)],
      receive: [mkPlayer("other", "RB", 3000)],
    });
    const { allTrades } = runFinderPipeline(
      [receiving, notReceiving],
      baseCtx({ deferredTargetPlayerId: "TGT" }),
    );
    expect(allTrades).toHaveLength(1);
    expect(allTrades[0].receive[0].player_id).toBe("TGT");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Dedup & slotting
// ─────────────────────────────────────────────────────────────────────────

describe("runFinderPipeline — dedup & slotting", () => {
  it("collapses two identical trades to a single slot (exact-key dedup)", () => {
    const a = mkTrade({ give: [mkPlayer("g1", "WR", 3000)], receive: [mkPlayer("r1", "RB", 3000)] });
    const b = mkTrade({ give: [mkPlayer("g1", "WR", 3000)], receive: [mkPlayer("r1", "RB", 3000)] });
    const { allTrades } = runFinderPipeline([a, b], baseCtx());
    expect(allTrades).toHaveLength(1);
  });

  it("caps the standard board at 12 trades", () => {
    // 20 distinct trades, all against different opponents & players so neither
    // the per-player (>=2) nor per-opp (>=4) caps interfere.
    const rosters: SleeperRoster[] = [mkRoster(1, "USER", [])];
    const trades: TradeResult[] = [];
    for (let i = 0; i < 20; i++) {
      const opp = 100 + i;
      rosters.push(mkRoster(opp, `O${i}`, []));
      trades.push(
        mkTrade({
          give: [mkPlayer(`g${i}`, "WR", 3000)],
          receive: [mkPlayer(`r${i}`, "RB", 3000)],
          oppRosterId: opp,
          score: 200 - i, // strictly decreasing so ordering is deterministic
        }),
      );
    }
    const { allTrades } = runFinderPipeline(trades, baseCtx({ rosters }));
    expect(allTrades).toHaveLength(12);
  });

  it("limits any single opponent to 4 trades on the standard board", () => {
    // 8 trades all against opp 2, each with distinct players (so the per-player
    // cap never trips) → only 4 should slot.
    const trades: TradeResult[] = [];
    for (let i = 0; i < 8; i++) {
      trades.push(
        mkTrade({
          give: [mkPlayer(`g${i}`, "WR", 3000)],
          receive: [mkPlayer(`r${i}`, "RB", 3000)],
          oppRosterId: 2,
          score: 200 - i,
        }),
      );
    }
    const { allTrades } = runFinderPipeline(trades, baseCtx());
    expect(allTrades).toHaveLength(4);
    expect(allTrades.every((t) => t.oppRosterId === 2)).toBe(true);
  });

  it("limits a single player to appearing in 2 slotted trades", () => {
    // Same received star "STAR" across 5 trades, each a different opponent and
    // different give player. After STAR appears twice, further trades drop.
    const rosters: SleeperRoster[] = [mkRoster(1, "USER", [])];
    const trades: TradeResult[] = [];
    for (let i = 0; i < 5; i++) {
      const opp = 200 + i;
      rosters.push(mkRoster(opp, `O${i}`, []));
      trades.push(
        mkTrade({
          give: [mkPlayer(`g${i}`, "WR", 3000)],
          receive: [mkPlayer("STAR", "RB", 3000)],
          oppRosterId: opp,
          score: 200 - i,
        }),
      );
    }
    const { allTrades } = runFinderPipeline(trades, baseCtx({ rosters }));
    const starAppearances = allTrades.filter((t) => t.receive.some((p) => p.player_id === "STAR")).length;
    expect(starAppearances).toBe(2);
  });

  it("caps complex (>=5 piece) trades at 2", () => {
    // 5 complex trades, each 5 pieces (3 give + 2 receive), distinct opponents
    // and players. Only 2 complex should slot.
    const rosters: SleeperRoster[] = [mkRoster(1, "USER", [])];
    const trades: TradeResult[] = [];
    for (let i = 0; i < 5; i++) {
      const opp = 300 + i;
      rosters.push(mkRoster(opp, `O${i}`, []));
      trades.push(
        mkTrade({
          give: [mkPlayer(`a${i}`, "WR", 1000), mkPlayer(`b${i}`, "RB", 1000), mkPlayer(`c${i}`, "TE", 1000)],
          receive: [mkPlayer(`d${i}`, "WR", 1500), mkPlayer(`e${i}`, "RB", 1500)],
          oppRosterId: opp,
          score: 200 - i,
          format: "3-for-2",
        }),
      );
    }
    const { allTrades } = runFinderPipeline(trades, baseCtx({ rosters }));
    expect(allTrades).toHaveLength(2);
  });

  it("drops a near-duplicate trade (same opp, same receive players, large give overlap)", () => {
    // Both 2-for-1 to opp 2 receiving STAR; give sides share g1 (overlap 0.5).
    const a = mkTrade({
      give: [mkPlayer("g1", "WR", 2000), mkPlayer("g2", "RB", 2000)],
      receive: [mkPlayer("STAR", "RB", 3000)],
      oppRosterId: 2,
      score: 150,
      format: "2-for-1",
    });
    const b = mkTrade({
      give: [mkPlayer("g1", "WR", 2000), mkPlayer("g3", "TE", 2000)],
      receive: [mkPlayer("STAR", "RB", 3000)],
      oppRosterId: 2,
      score: 140,
      format: "2-for-1",
    });
    const { allTrades } = runFinderPipeline([a, b], baseCtx());
    // similarity: same format + same receive players + give overlap 0.5 → too similar
    expect(allTrades).toHaveLength(1);
    expect(allTrades[0].score).toBe(150); // the higher-scored one survives
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Buy-low bonus slots
// ─────────────────────────────────────────────────────────────────────────

describe("runFinderPipeline — buy-low slots", () => {
  // Buy-low slots surface 1-for-1 trades that did NOT already make the top-12
  // board (the slotter shares a `seen` set, so a trade slotted in the top-12 is
  // not re-slotted as a buy-low). We therefore saturate the top-12 with
  // higher-scored filler so the lower-scored buy-low trade is left for the
  // bonus pass.
  const fillerTrades = (count: number, rosters: SleeperRoster[]): TradeResult[] => {
    const out: TradeResult[] = [];
    for (let i = 0; i < count; i++) {
      const opp = 900 + i;
      rosters.push(mkRoster(opp, `F${i}`, []));
      out.push(
        mkTrade({
          give: [mkPlayer(`fg${i}`, "WR", 3000)],
          receive: [mkPlayer(`fr${i}`, "RB", 3000)],
          oppRosterId: opp,
          score: 1000 - i, // far above the buy-low trades
        }),
      );
    }
    return out;
  };

  it("adds a buy-low slot for a 1-for-1 receiving a buy-low player", () => {
    const rosters: SleeperRoster[] = [mkRoster(1, "USER", [])];
    const filler = fillerTrades(12, rosters);
    const buyLowTrade = mkTrade({
      give: [mkPlayer("g1", "WR", 3000)],
      receive: [mkPlayer("BUY", "RB", 3000)],
      oppRosterId: 2,
      score: 50, // below filler → excluded from full top-12, eligible for buy-low
    });
    const { allTrades } = runFinderPipeline(
      [...filler, buyLowTrade],
      baseCtx({ rosters, buyLowPlayerIds: ["BUY"] }),
    );
    const buyLow = allTrades.filter((x) => x.isBuyLow);
    expect(buyLow).toHaveLength(1);
    expect(buyLow[0].receive[0].player_id).toBe("BUY");
  });

  it("does not create a buy-low slot when the received player is not a buy-low", () => {
    const t = mkTrade({ give: [mkPlayer("g1", "WR", 3000)], receive: [mkPlayer("r1", "RB", 3000)] });
    const { allTrades } = runFinderPipeline([t], baseCtx({ buyLowPlayerIds: ["someoneElse"] }));
    expect(allTrades.some((x) => x.isBuyLow)).toBe(false);
  });

  it("does not create a buy-low slot when the GIVEN player is also a buy-low", () => {
    // Trading away a buy-low to acquire a buy-low is excluded from buy-low slots.
    const t = mkTrade({
      give: [mkPlayer("GIVEBUY", "WR", 3000)],
      receive: [mkPlayer("RECVBUY", "RB", 3000)],
    });
    const { allTrades } = runFinderPipeline(
      [t],
      baseCtx({ buyLowPlayerIds: ["GIVEBUY", "RECVBUY"] }),
    );
    expect(allTrades.some((x) => x.isBuyLow)).toBe(false);
  });

  it("excludes non-1-for-1 trades from buy-low slots", () => {
    const t = mkTrade({
      give: [mkPlayer("g1", "WR", 2000), mkPlayer("g2", "RB", 2000)],
      receive: [mkPlayer("BUY", "RB", 3000)],
      format: "2-for-1",
    });
    const { allTrades } = runFinderPipeline([t], baseCtx({ buyLowPlayerIds: ["BUY"] }));
    expect(allTrades.some((x) => x.isBuyLow)).toBe(false);
  });

  it("caps buy-low slots at 5", () => {
    const rosters: SleeperRoster[] = [mkRoster(1, "USER", [])];
    const filler = fillerTrades(12, rosters); // saturate the top-12
    const buyTrades: TradeResult[] = [];
    const buyIds: string[] = [];
    for (let i = 0; i < 8; i++) {
      const opp = 400 + i;
      const buyId = `BUY${i}`;
      buyIds.push(buyId);
      rosters.push(mkRoster(opp, `O${i}`, []));
      buyTrades.push(
        mkTrade({
          give: [mkPlayer(`g${i}`, "WR", 3000)],
          receive: [mkPlayer(buyId, "RB", 3000)],
          oppRosterId: opp,
          score: 100 - i, // below filler
        }),
      );
    }
    const { allTrades } = runFinderPipeline(
      [...filler, ...buyTrades],
      baseCtx({ rosters, buyLowPlayerIds: buyIds }),
    );
    const buyLow = allTrades.filter((x) => x.isBuyLow);
    expect(buyLow).toHaveLength(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// HC / same-team structural guardrails
// ─────────────────────────────────────────────────────────────────────────

describe("runFinderPipeline — structural guardrails", () => {
  it("blocks a wrong-owner handcuff package (backup RB to a team that doesn't own the starter)", () => {
    const starter = mkPlayer("STARTER", "RB", 5000, { team: "KC" });
    const backup = mkPlayer("BACKUP", "RB", 800, { team: "KC" });
    const nflTeamDepth = new Map<string, Record<string, PlayerWithValue[]>>([
      ["KC", { RB: [starter, backup] }],
    ]);
    const players: Record<string, SleeperPlayer> = {
      STARTER: starter as unknown as SleeperPlayer,
      BACKUP: backup as unknown as SleeperPlayer,
    };
    const t = mkTrade({
      give: [backup], // only asset given is a backup RB
      receive: [mkPlayer("r1", "WR", 800)],
      oppRosterId: 2,
    });
    const { allTrades } = runFinderPipeline(
      [t],
      baseCtx({
        players,
        nflTeamDepth,
        // depth idx: starter=0, backup=1
        getNFLDepthIdx: (_team, _pos, pid) => (pid === "STARTER" ? 0 : pid === "BACKUP" ? 1 : null),
        // opp owns nothing → does not own the starter
        rosterPlayers: () => [],
      }),
    );
    expect(allTrades).toHaveLength(0);
  });

  it("blocks a give-side package with an invalid same-team combo (two WRs same team)", () => {
    const wr1 = mkPlayer("WR1", "WR", 3000, { team: "BUF" });
    const wr2 = mkPlayer("WR2", "WR", 2500, { team: "BUF" });
    const players: Record<string, SleeperPlayer> = {
      WR1: wr1 as unknown as SleeperPlayer,
      WR2: wr2 as unknown as SleeperPlayer,
    };
    const t = mkTrade({
      give: [wr1, wr2],
      receive: [mkPlayer("r1", "RB", 5000)],
      format: "2-for-1",
    });
    const { allTrades } = runFinderPipeline([t], baseCtx({ players }));
    expect(allTrades).toHaveLength(0);
  });

  it("allows a QB+WR same-team combo (valid stacking pair)", () => {
    const qb = mkPlayer("QB1", "QB", 4000, { team: "BUF" });
    const wr = mkPlayer("WR1", "WR", 3000, { team: "BUF" });
    const players: Record<string, SleeperPlayer> = {
      QB1: qb as unknown as SleeperPlayer,
      WR1: wr as unknown as SleeperPlayer,
    };
    const t = mkTrade({
      give: [qb, wr],
      receive: [mkPlayer("r1", "RB", 6000)],
      format: "2-for-1",
    });
    const { allTrades } = runFinderPipeline([t], baseCtx({ players }));
    expect(allTrades).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Tank mode
// ─────────────────────────────────────────────────────────────────────────

describe("runFinderPipeline — tank mode", () => {
  it("in tank mode, only trades whose received players are all future-insulation assets survive", () => {
    // young WR age 25 → isFutureInsulationAsset true; old RB age 28 → false
    const youngOnly = mkTrade({
      give: [mkPlayer("g1", "RB", 3000, { age: 30 })],
      receive: [mkPlayer("young", "WR", 3000, { age: 23 })],
      oppRosterId: 2,
    });
    const hasOld = mkTrade({
      give: [mkPlayer("g2", "RB", 3000, { age: 30 })],
      receive: [mkPlayer("old", "RB", 3000, { age: 28 })],
      oppRosterId: 2,
    });
    const { allTrades } = runFinderPipeline(
      [youngOnly, hasOld],
      baseCtx({ finderTankMode: true }),
    );
    expect(allTrades).toHaveLength(1);
    expect(allTrades[0].receive[0].player_id).toBe("young");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Roster overflow output
// ─────────────────────────────────────────────────────────────────────────

describe("runFinderPipeline — rosterOverflow", () => {
  it("reports zero overflow when the roster comfortably fits", () => {
    const { rosterOverflow } = runFinderPipeline([], baseCtx());
    expect(rosterOverflow).toBe(0);
  });

  it("reports positive overflow when owned players exceed total slots", () => {
    // 25 roster_positions slots (9 starters + 16 BN), no taxi/reserve.
    // Own 40 players, all valued above the worst pick so none are 'cuttable'.
    // Draft already occurred → 0 upcoming picks.
    const owned = Array.from({ length: 40 }, (_, i) => `p${i}`);
    const myRoster = mkRoster(1, "USER", owned);
    const oppRoster = mkRoster(2, "OPP", []);
    const { rosterOverflow } = runFinderPipeline(
      [],
      baseCtx({
        rosters: [myRoster, oppRoster],
        myRoster,
        myPlayers: owned.map((id) => mkPlayer(id, "WR", 3000)),
        selectedLeagueDraftHasOccurred: true,
      }),
    );
    // 40 owned - 0 cuttable + 0 picks = 40 projected; slots = 25 → overflow 15
    expect(rosterOverflow).toBe(15);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// recentFingerprints output
// ─────────────────────────────────────────────────────────────────────────

describe("runFinderPipeline — recentFingerprints", () => {
  it("builds a fingerprint for a recent same-league trade attempt", () => {
    const attempt = {
      id: "a1",
      user_id: "USER",
      league_id: "L1",
      partner_roster_id: 2,
      partner_name: "Opp",
      give_players: [{ player_id: "g1" }],
      give_picks: [],
      receive_players: [{ player_id: "r1" }],
      receive_picks: [],
      source: "FINDER",
      initiated_by: "ME",
      status: "PENDING",
      counter_details: null,
      attempted_at: new Date().toISOString(),
      resolved_at: null,
    };
    const { recentFingerprints } = runFinderPipeline(
      [],
      baseCtx({ tradeAttempts: [attempt as unknown as FinderPipelineCtx["tradeAttempts"][number]] }),
    );
    expect(recentFingerprints.size).toBe(1);
    expect([...recentFingerprints][0]).toContain("L1|2|");
  });

  it("ignores attempts from other leagues and stale (>28d) attempts", () => {
    const staleSameLeague = {
      id: "a1", user_id: "USER", league_id: "L1", partner_roster_id: 2, partner_name: "Opp",
      give_players: [{ player_id: "g1" }], give_picks: [], receive_players: [{ player_id: "r1" }], receive_picks: [],
      source: "FINDER", initiated_by: "ME", status: "DECLINED", counter_details: null,
      attempted_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(), resolved_at: null,
    };
    const recentOtherLeague = {
      id: "a2", user_id: "USER", league_id: "OTHER", partner_roster_id: 2, partner_name: "Opp",
      give_players: [{ player_id: "g2" }], give_picks: [], receive_players: [{ player_id: "r2" }], receive_picks: [],
      source: "FINDER", initiated_by: "ME", status: "DECLINED", counter_details: null,
      attempted_at: new Date().toISOString(), resolved_at: null,
    };
    const { recentFingerprints } = runFinderPipeline(
      [],
      baseCtx({
        tradeAttempts: [
          staleSameLeague as unknown as FinderPipelineCtx["tradeAttempts"][number],
          recentOtherLeague as unknown as FinderPipelineCtx["tradeAttempts"][number],
        ],
      }),
    );
    expect(recentFingerprints.size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Pending-attempt suppression
// ─────────────────────────────────────────────────────────────────────────

describe("runFinderPipeline — pending suppression", () => {
  it("suppresses a trade whose top received player is already in a PENDING attempt with that opp", () => {
    const attempt = {
      id: "p1", user_id: "USER", league_id: "L1", partner_roster_id: 2, partner_name: "Opp",
      give_players: [], give_picks: [],
      receive_players: [{ player_id: "STAR" }], receive_picks: [],
      source: "FINDER", initiated_by: "ME", status: "PENDING", counter_details: null,
      attempted_at: new Date().toISOString(), resolved_at: null,
    };
    const t = mkTrade({
      give: [mkPlayer("g1", "WR", 1000)],
      receive: [mkPlayer("STAR", "RB", 5000)], // top received = STAR (highest value)
      oppRosterId: 2,
    });
    const { allTrades } = runFinderPipeline(
      [t],
      baseCtx({ tradeAttempts: [attempt as unknown as FinderPipelineCtx["tradeAttempts"][number]] }),
    );
    expect(allTrades).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Decline memory (attemptIntelScore status branch)
// ─────────────────────────────────────────────────────────────────────────

describe("runFinderPipeline — decline memory", () => {
  // A ME-initiated, refused, recent attempt with this opponent (roster 2). Tests override the
  // status and the give/receive players to exercise each branch of the decline penalty.
  const mkAttempt = (over: Record<string, unknown>) =>
    ({
      id: "att", user_id: "USER", league_id: "L1", partner_roster_id: 2, partner_name: "Opp",
      give_players: [], give_picks: [], receive_players: [], receive_picks: [],
      source: "FINDER", initiated_by: "ME", status: "DECLINED", counter_details: null,
      attempted_at: new Date().toISOString(), resolved_at: null,
      ...over,
    }) as unknown as FinderPipelineCtx["tradeAttempts"][number];
  // An attempt where I asked to RECEIVE `playerId` from this opponent.
  const recvAttempt = (playerId: string, over: Record<string, unknown> = {}) =>
    mkAttempt({ id: `att-${playerId}`, receive_players: [{ player_id: playerId }], ...over });
  // Two otherwise-identical 1-for-1s to opp 2; only the received player (and its history) differ.
  const recvTrade = (give: string, receive: string) =>
    mkTrade({ give: [mkPlayer(give, "WR", 3000)], receive: [mkPlayer(receive, "RB", 3000)], oppRosterId: 2, score: 100 });

  it("de-ranks receiving a player the opponent recently DECLINED to give up", () => {
    // Input order puts the declined trade FIRST, so a correct result proves ordering is by the
    // model (the −12 receive-side penalty), not by input order.
    const { allTrades } = runFinderPipeline(
      [recvTrade("g2", "DECLINED"), recvTrade("g1", "FRESH")],
      baseCtx({ tradeAttempts: [recvAttempt("DECLINED")] }),
    );
    expect(allTrades.map((t) => t.receive[0].player_id)).toEqual(["FRESH", "DECLINED"]);
  });

  it("ranks fresh > NO_RESPONSE > DECLINED (a ghost counts as half a refusal)", () => {
    const { allTrades } = runFinderPipeline(
      [recvTrade("g3", "DECLINED"), recvTrade("g2", "GHOST"), recvTrade("g1", "FRESH")],
      baseCtx({
        tradeAttempts: [recvAttempt("GHOST", { status: "NO_RESPONSE" }), recvAttempt("DECLINED")],
      }),
    );
    expect(allTrades.map((t) => t.receive[0].player_id)).toEqual(["FRESH", "GHOST", "DECLINED"]);
  });

  it("treats a COUNTERED attempt as live interest, not a refusal", () => {
    // A counter is engagement: the targeted player keeps its +6 standing-interest nudge and so
    // ranks ABOVE an otherwise identical fresh trade — proving COUNTERED is not penalized.
    const { allTrades } = runFinderPipeline(
      [recvTrade("g1", "FRESH"), recvTrade("g2", "TGT")],
      baseCtx({ tradeAttempts: [recvAttempt("TGT", { status: "COUNTERED" })] }),
    );
    expect(allTrades.map((t) => t.receive[0].player_id)).toEqual(["TGT", "FRESH"]);
  });

  it("de-ranks re-offering a give-side player the opponent recently passed on", () => {
    const fresh = mkTrade({ give: [mkPlayer("FRESHGIVE", "WR", 3000)], receive: [mkPlayer("r1", "RB", 3000)], oppRosterId: 2, score: 100 });
    const passed = mkTrade({ give: [mkPlayer("PASSED", "WR", 3000)], receive: [mkPlayer("r2", "RB", 3000)], oppRosterId: 2, score: 100 });
    const { allTrades } = runFinderPipeline(
      [passed, fresh],
      baseCtx({ tradeAttempts: [mkAttempt({ give_players: [{ player_id: "PASSED" }] })] }),
    );
    expect(allTrades.map((t) => t.give[0].player_id)).toEqual(["FRESHGIVE", "PASSED"]);
  });

  it("a stale (>56d) decline no longer de-ranks — it decays to a no-op", () => {
    // A decline outside the half-life window weighs 0, so the output must be byte-identical to a
    // run with no attempts at all (same scores → same seed tiebreak → same order).
    const stale = recvAttempt("X", { attempted_at: new Date(Date.now() - 70 * 24 * 60 * 60 * 1000).toISOString() });
    const trades = [recvTrade("g1", "X"), recvTrade("g2", "FRESH")];
    const withStale = runFinderPipeline(trades, baseCtx({ tradeAttempts: [stale] })).allTrades.map((t) => t.receive[0].player_id);
    const without = runFinderPipeline(trades, baseCtx()).allTrades.map((t) => t.receive[0].player_id);
    expect(withStale).toEqual(without);
  });

  it("only ME-initiated refusals penalize: a THEM DECLINED attempt keeps its +11 sell signal", () => {
    // They offered me SHOPPED and I declined — that is still a willing seller, NOT my refusal. The
    // branch must route THEM attempts to theirSell (+11), so SHOPPED ranks ABOVE fresh, never below.
    const themDeclined = mkAttempt({ initiated_by: "THEM", status: "DECLINED", give_players: [{ player_id: "SHOPPED" }] });
    const { allTrades } = runFinderPipeline(
      [recvTrade("g1", "FRESH"), recvTrade("g2", "SHOPPED")],
      baseCtx({ tradeAttempts: [themDeclined] }),
    );
    expect(allTrades.map((t) => t.receive[0].player_id)).toEqual(["SHOPPED", "FRESH"]);
  });

  it("caps accumulated decline weight so repeat refusals can't stack an unbounded penalty", () => {
    // Five recent declined asks for CHASED would be weight 5.0 (−60) uncapped; the 1.5 cap holds it
    // to −18. Observable: a competing trade given a fixed −20 handicap (via score) still ranks BELOW
    // the 5×-declined trade — which can only happen if the decline penalty was capped well under 20.
    const declines = Array.from({ length: 5 }, (_, i) =>
      recvAttempt("CHASED", { id: `chase-${i}` }),
    );
    const chased = mkTrade({ give: [mkPlayer("g1", "WR", 3000)], receive: [mkPlayer("CHASED", "RB", 3000)], oppRosterId: 2, score: 100 });
    const handicapped = mkTrade({ give: [mkPlayer("g2", "WR", 3000)], receive: [mkPlayer("OTHER", "RB", 3000)], oppRosterId: 2, score: 80 });
    const { allTrades } = runFinderPipeline([handicapped, chased], baseCtx({ tradeAttempts: declines }));
    // chased: 100 − 18 (capped) = 82 > handicapped 80. Without the cap it would be 100 − 60 = 40 < 80.
    expect(allTrades.map((t) => t.receive[0].player_id)).toEqual(["CHASED", "OTHER"]);
  });

  it("exempts a flagged sweetener from the give-side decline penalty", () => {
    // Both trades send a 400 piece the opponent previously passed on, and both have identical
    // effective give value (3000) and receive (3000), so the ONLY scoring difference is the −8
    // penalty — which the flagged sweetener must escape. So the sweetened trade ranks above.
    const declinedBoth = mkAttempt({ give_players: [{ player_id: "SW" }, { player_id: "NF" }] });
    const sweetened = mkTrade({
      give: [mkPlayer("mpA", "WR", 3000, { team: "SF" }), mkPlayer("SW", "WR", 400, { age: 22, team: "BUF" })],
      receive: [mkPlayer("opA", "RB", 3000, { team: "KC" })],
      sweetenerPlayerId: "SW",
      oppRosterId: 2, score: 100, format: "1 for 1 + sweetener",
    });
    const plain = mkTrade({
      // 2600 + 400 = 3000 effective give (matches sweetened's stripped 3000); core 2600 vs 3000 is
      // ≥0.85 so the unflagged 400 survives the anti-padding gate and the trade still surfaces.
      give: [mkPlayer("mpB", "WR", 2600, { team: "SF" }), mkPlayer("NF", "WR", 400, { age: 22, team: "DAL" })],
      receive: [mkPlayer("opB", "RB", 3000, { team: "KC" })],
      oppRosterId: 2, score: 100, format: "1 for 2",
    });
    const { allTrades } = runFinderPipeline([plain, sweetened], baseCtx({ tradeAttempts: [declinedBoth] }));
    expect(allTrades).toHaveLength(2);
    expect(allTrades[0].sweetenerPlayerId).toBe("SW"); // sweetened (penalty exempt) outranks plain (−8)
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Manual asset dispositions (Core/Pricey/Shopping/Offload, SELL_NO/SELL_OK)
// ─────────────────────────────────────────────────────────────────────────

describe("runFinderPipeline — manual asset dispositions", () => {
  // Two independent opponents so each pair of otherwise-identical trades survives
  // dedup (different oppRosterId) and ordering reflects the disposition bonus alone.
  const rosters = [mkRoster(1, "USER", []), mkRoster(2, "OPP", []), mkRoster(3, "OPP2", [])];

  it("ranks a give-side Offload-tagged asset above an otherwise identical trade", () => {
    const tagged = mkTrade({
      give: [mkPlayer("OFF", "WR", 2000)], receive: [mkPlayer("r1", "RB", 2000)],
      oppRosterId: 2, score: 100,
    });
    const plain = mkTrade({
      give: [mkPlayer("g2", "WR", 2000)], receive: [mkPlayer("r2", "RB", 2000)],
      oppRosterId: 3, score: 100,
    });
    const { allTrades } = runFinderPipeline(
      [plain, tagged],
      baseCtx({ rosters, isOffload: (id) => id === "OFF" }),
    );
    expect(allTrades.map((t) => t.give[0].player_id)).toEqual(["OFF", "g2"]);
  });

  it("ranks a give-side Pricey-tagged asset below an otherwise identical trade", () => {
    const tagged = mkTrade({
      give: [mkPlayer("PRI", "WR", 2000)], receive: [mkPlayer("r1", "RB", 2000)],
      oppRosterId: 2, score: 100,
    });
    const plain = mkTrade({
      give: [mkPlayer("g2", "WR", 2000)], receive: [mkPlayer("r2", "RB", 2000)],
      oppRosterId: 3, score: 100,
    });
    const { allTrades } = runFinderPipeline(
      [plain, tagged],
      baseCtx({ rosters, isPricey: (id) => id === "PRI" }),
    );
    expect(allTrades.map((t) => t.give[0].player_id)).toEqual(["g2", "PRI"]);
  });

  it("ranks a receive-side Open-to-Sell-tagged asset above an otherwise identical trade", () => {
    const tagged = mkTrade({
      give: [mkPlayer("g1", "WR", 2000)], receive: [mkPlayer("OK", "RB", 2000)],
      oppRosterId: 2, score: 100,
    });
    const plain = mkTrade({
      give: [mkPlayer("g2", "WR", 2000)], receive: [mkPlayer("r2", "RB", 2000)],
      oppRosterId: 3, score: 100,
    });
    const { allTrades } = runFinderPipeline(
      [plain, tagged],
      baseCtx({ rosters, isOpenToSell: (id) => id === "OK" }),
    );
    expect(allTrades.map((t) => t.receive[0].player_id)).toEqual(["OK", "r2"]);
  });
});
