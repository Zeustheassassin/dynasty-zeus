import { describe, it, expect } from "vitest";
import {
  buildWaiverWatch,
  computeValueRisers,
  getDropCandidates,
  isoDaysBefore,
  type ValueRiser,
} from "@/lib/helpers/waiverWatch";
import type {
  LeagueOverviewEntry,
  SleeperLeague,
  SleeperLeagueSettings,
  SleeperPlayer,
  SleeperRoster,
} from "@/lib/types";

// To-Do hub Waiver Watch (Stage 2, 10/14): 7-day risers from two value snapshots, per-league free
// agents, and the drop list's IR-overflow rule (3 IR slots + 5 eligible → IR players count).

const ME = "me";

const mk = (id: string, position: string, value: number | undefined, injury_status: string | null = null): SleeperPlayer =>
  ({ player_id: id, full_name: `Player ${id}`, position, team: "KC", injury_status, status: "Active", value } as SleeperPlayer);

function league(id: string, name: string, s: Partial<SleeperLeagueSettings> = {}): SleeperLeague {
  return {
    league_id: id, name, season: "2026", roster_positions: ["QB", "RB", "WR", "BN", "BN"],
    settings: { reserve_slots: 3, reserve_allow_out: 1, taxi_slots: 2, ...s } as SleeperLeagueSettings, scoring_settings: {},
  } as SleeperLeague;
}
function roster(owner: string, players: string[], reserve: string[] = [], taxi: string[] = []): SleeperRoster {
  return { roster_id: owner === ME ? 1 : 2, owner_id: owner, players, starters: [], reserve, taxi, settings: {} } as unknown as SleeperRoster;
}
function entry(l: SleeperLeague, rosters: SleeperRoster[]): LeagueOverviewEntry {
  return { league: l, rosters, picks: [], userMap: {} };
}

describe("isoDaysBefore", () => {
  it("steps back whole UTC days, across a month boundary", () => {
    expect(isoDaysBefore("2026-10-14", 7)).toBe("2026-10-07");
    expect(isoDaysBefore("2026-10-03", 7)).toBe("2026-09-26");
  });
});

describe("computeValueRisers", () => {
  it("ranks raw gains, drops fallers and players missing from the base snapshot", () => {
    const latest = [
      { player_id: "a", value: 3000 },
      { player_id: "b", value: 5200 },
      { player_id: "c", value: 1000 },
      { player_id: "new", value: 2500 },
    ];
    const base = [
      { player_id: "a", value: 2400 },
      { player_id: "b", value: 5000 },
      { player_id: "c", value: 1100 },
      { player_id: "gone", value: 800 },
    ];
    expect(computeValueRisers(latest, base)).toEqual([
      { playerId: "a", from: 2400, to: 3000, gain: 600 },
      { playerId: "b", from: 5000, to: 5200, gain: 200 },
    ]);
  });
});

describe("getDropCandidates", () => {
  const PLAYERS: Record<string, SleeperPlayer> = {
    qb: mk("qb", "QB", 6000),
    rb: mk("rb", "RB", 900),
    wr: mk("wr", "WR", 1500),
    unranked: mk("unranked", "WR", undefined),
    k: mk("k", "K", undefined),
    def: mk("def", "DEF", undefined),
    tx: mk("tx", "RB", 50),
    ir1: mk("ir1", "RB", 100, "IR"),
    ir2: mk("ir2", "WR", 200, "IR"),
    ir3: mk("ir3", "TE", 300, "IR"),
    out1: mk("out1", "WR", 4000, "Out"),
    out2: mk("out2", "RB", 5000, "Out"),
    stale: mk("stale", "TE", 400),
  };
  const ids = (l: SleeperLeague, r: SleeperRoster) => getDropCandidates(l, r, PLAYERS).map((c) => c.playerId);

  it("leaves out taxi, K/DEF and IR; a player FantasyCalc doesn't list reads as 0, lowest", () => {
    const r = roster(ME, ["qb", "rb", "wr", "unranked", "k", "def", "tx", "ir1"], ["ir1"], ["tx"]);
    expect(ids(league("L", "L"), r)).toEqual(["unranked", "rb", "wr", "qb"]);
  });

  it("counts IR players once IR-eligible players outnumber the slots (3 slots + 5 eligible)", () => {
    const r = roster(ME, ["qb", "rb", "ir1", "ir2", "ir3", "out1", "out2"], ["ir1", "ir2", "ir3"]);
    const candidates = getDropCandidates(league("L", "L"), r, PLAYERS);
    expect(candidates.slice(0, 3).map((c) => [c.playerId, c.onIr])).toEqual([["ir1", true], ["ir2", true], ["ir3", true]]);
  });

  it("keeps IR players off when the eligible players fit (3 slots + 3 eligible)", () => {
    const r = roster(ME, ["qb", "rb", "ir1", "ir2", "ir3"], ["ir1", "ir2", "ir3"]);
    expect(ids(league("L", "L"), r)).toEqual(["rb", "qb"]);
  });

  it("counts a stale-IR player as active, and he doesn't count toward the overflow", () => {
    // 3 slots: ir1 + ir2 eligible, `stale` no longer eligible, out1 eligible on the bench = 3, not over.
    const r = roster(ME, ["qb", "rb", "ir1", "ir2", "stale", "out1"], ["ir1", "ir2", "stale"]);
    const candidates = getDropCandidates(league("L", "L"), r, PLAYERS);
    expect(candidates.map((c) => c.playerId)).toEqual(["stale", "rb", "out1", "qb"]);
    expect(candidates[0].onIr).toBe(false);
  });

  it("follows the league's IR rules: Out isn't eligible where the league doesn't allow it", () => {
    const strict = league("L", "L", { reserve_slots: 1, reserve_allow_out: 0 });
    // Only ir1 is eligible (Out doesn't count here), 1 slot → no overflow.
    expect(ids(strict, roster(ME, ["rb", "ir1", "out1"], ["ir1"]))).toEqual(["rb", "out1"]);
  });
});

describe("buildWaiverWatch", () => {
  const PLAYERS: Record<string, SleeperPlayer> = {
    mine1: mk("mine1", "RB", 800),
    mine2: mk("mine2", "WR", 2000),
    mine3: mk("mine3", "QB", 7000),
    theirs: mk("theirs", "WR", 3000),
    theirIr: mk("theirIr", "RB", 2800, "IR"),
    theirTaxi: mk("theirTaxi", "TE", 2600),
    fa1: mk("fa1", "WR", 2400),
    fa2: mk("fa2", "RB", 700),
    fa3: mk("fa3", "TE", 1200),
  };
  const RISERS: ValueRiser[] = [
    { playerId: "theirs", from: 2000, to: 3000, gain: 1000 },
    { playerId: "theirIr", from: 2000, to: 2800, gain: 800 },
    { playerId: "theirTaxi", from: 2000, to: 2600, gain: 600 },
    { playerId: "fa1", from: 1900, to: 2350, gain: 450 },
    { playerId: "notInSleeper", from: 100, to: 500, gain: 400 },
    { playerId: "fa2", from: 400, to: 700, gain: 300 },
    { playerId: "fa3", from: 1000, to: 1200, gain: 200 },
  ];
  const A = league("A", "Alpha");
  const B = league("B", "Bravo");
  const C = league("C", "Charlie");

  function build(over: Partial<Parameters<typeof buildWaiverWatch>[0]> = {}) {
    // Sleeper's roster.players is normally the union with reserve + taxi; leave them out here so
    // the IR / taxi lists alone have to mark them rostered.
    const other = roster("other", ["theirs"], ["theirIr"], ["theirTaxi"]);
    return buildWaiverWatch({
      leagues: [A, B, C],
      leagueOverviewData: {
        // Alpha: lowest is 800, fa1 (2400) beats it.
        A: entry(A, [roster(ME, ["mine1", "mine2"]), other]),
        // Bravo: fa1 is rostered here; lowest is 2000, nothing rising beats it.
        B: entry(B, [roster(ME, ["mine2", "mine3", "fa1"]), other]),
        // Charlie: no roster of mine — skipped.
        C: entry(C, [other]),
      },
      userId: ME,
      players: PLAYERS,
      risers: RISERS,
      ...over,
    });
  }

  it("lists the top two risers no one in the league rosters — IR and taxi count as rostered", () => {
    const [alpha, bravo] = build();
    expect(alpha.risers.map((r) => r.playerId)).toEqual(["fa1", "fa2"]);
    expect(bravo.risers.map((r) => r.playerId)).toEqual(["fa2", "fa3"]);
  });

  it("compares the current value (players[id].value) to the lowest player and highlights a pickup that beats him", () => {
    const [alpha] = build();
    expect(alpha.lowest.map((c) => c.playerId)).toEqual(["mine1", "mine2"]);
    expect(alpha.risers[0]).toMatchObject({ playerId: "fa1", value: 2400, gain: 450, beatsLowest: true });
    expect(alpha.risers[1]).toMatchObject({ playerId: "fa2", value: 700, beatsLowest: false });
    expect(alpha.upgrade).toBe(1600);
  });

  it("skips leagues with no roster of mine; a league without an upgrade has none flagged", () => {
    const rows = build();
    expect(rows.map((r) => r.league.name)).toEqual(["Alpha", "Bravo"]);
    expect(rows[1].upgrade).toBeNull();
    expect(rows[1].risers.every((r) => !r.beatsLowest)).toBe(true);
  });

  it("keeps the user's Sleeper order — an upgrade doesn't move a league up (10/14)", () => {
    const rows = build({ leagues: [{ ...A, display_order: 1 }, { ...B, display_order: 0 }, C] });
    expect(rows.map((r) => r.league.name)).toEqual(["Bravo", "Alpha"]);
    expect(rows[1].upgrade).toBe(1600);
  });

  it("still lists the lowest players with no risers", () => {
    const rows = build({ risers: [] });
    expect(rows.map((r) => r.league.name)).toEqual(["Alpha", "Bravo"]);
    expect(rows[0].risers).toEqual([]);
    expect(rows[0].lowest.map((c) => c.playerId)).toEqual(["mine1", "mine2"]);
  });
});
