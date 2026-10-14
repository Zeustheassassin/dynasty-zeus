import { describe, it, expect } from "vitest";
import {
  buildActionQueue,
  compareActionItems,
  getActionState,
  getAttentionLeagues,
  getStepIndex,
  groupActionsByLeague,
  groupActionsByPlayer,
  sleeperLeagueUrl,
  splitActionsByState,
  type ActionItem,
  type ActionQueueInput,
} from "@/lib/helpers/actionQueue";
import { INACTIVES_LEAD_MS } from "@/lib/helpers/lineupAvailability";
import type {
  LeagueLineupStatus,
  LeagueOverviewEntry,
  SleeperLeague,
  SleeperLeagueSettings,
  SleeperPlayer,
  SleeperRoster,
} from "@/lib/types";

// To-Do hub action list (Stage 1, 10/14): lineup items straight off LeagueLineupStatus, roster/IR
// items off Roster Overview's counts (getRosterSlotSummary), Done marks re-checked only against
// data newer than the click.

const ME = "me";
// Week of Thu 2026-10-15 (US Eastern): TNF, Sunday early and SNF kickoffs.
const THU = Date.parse("2026-10-16T00:15:00Z");
const SUN_EARLY = Date.parse("2026-10-18T17:00:00Z");
const SUN_LATE = Date.parse("2026-10-19T00:20:00Z");

const mk = (id: string, position: string, injury_status: string | null = null): SleeperPlayer =>
  ({ player_id: id, full_name: `Player ${id}`, position, team: "KC", injury_status, status: "Active" } as SleeperPlayer);

const PLAYERS: Record<string, SleeperPlayer> = {
  p1: mk("p1", "RB"),
  p2: mk("p2", "WR"),
  p3: mk("p3", "WR", "Questionable"),
  pBye: mk("pBye", "QB"),
  irA: mk("irA", "RB", "IR"),
  stale: mk("stale", "TE"),
  tx: mk("tx", "WR", "IR"),
  outB: mk("outB", "RB", "Out"),
};

function league(id: string, name: string, s: Partial<SleeperLeagueSettings>, rosterPositions = ["RB", "FLEX", "BN"]): SleeperLeague {
  return {
    league_id: id, name, season: "2026", roster_positions: rosterPositions,
    settings: { reserve_allow_out: 1, taxi_slots: 2, ...s } as SleeperLeagueSettings, scoring_settings: {},
  } as SleeperLeague;
}
function roster(players: string[], reserve: string[] = [], taxi: string[] = []): SleeperRoster {
  return { roster_id: 1, owner_id: ME, players, starters: [], reserve, taxi, settings: {} } as unknown as SleeperRoster;
}
function entry(l: SleeperLeague, r: SleeperRoster, rostersAsOf?: number): LeagueOverviewEntry {
  return { league: l, rosters: [r, { ...r, owner_id: "other", roster_id: 2 }], picks: [], userMap: {}, rostersAsOf };
}
function status(over: Partial<LeagueLineupStatus>): LeagueLineupStatus {
  return {
    isOptimal: false, swapCount: 0, delta: 0, pivotRiskCount: 0, earlyLocks: [],
    swaps: [], pivotRisks: [], emptySlots: [], asOf: 100, ...over,
  };
}

// Alpha: over the limit by one (4 active of 3), one stale IR player, one IR-eligible with an open slot.
const A = league("A", "Alpha", { reserve_slots: 2 });
// Bravo: IR full, so its Out player can't move there.
const B = league("B", "Bravo", { reserve_slots: 1 });
// Charlie: no lineup status (offseason-style) but an IR-eligible player.
const C = league("C", "Charlie", { reserve_slots: 1 });

const OVERVIEW: Record<string, LeagueOverviewEntry> = {
  A: entry(A, roster(["p1", "p2", "p3", "irA", "stale", "tx"], ["stale"], ["tx"]), 200),
  B: entry(B, roster(["outB", "pBye", "stale"], ["stale"]), 300),
  C: entry(C, roster(["irA"])),
};

const LINEUP: Record<string, LeagueLineupStatus | null> = {
  A: status({
    swapCount: 1, delta: 4,
    swaps: [{ slot: "FLEX", inId: "p1", outId: "p2", delta: 4, lockAt: THU }],
    earlyLocks: [{ day: "Thu", stake: 4, moves: ["Player p1"] }],
    pivotRiskCount: 1,
    pivotRisks: [{ slot: "WR", playerId: "p3", kickoffAt: SUN_LATE, decisionAt: SUN_LATE - INACTIVES_LEAD_MS, swapBy: SUN_EARLY }],
    emptySlots: [{ slot: "K", playerId: null, reason: "none" }, { slot: "K", playerId: null, reason: "none" }],
  }),
  // Under the dot's 0.5 floor: the swap isn't listed, but the bye slot is.
  B: status({
    swapCount: 1, delta: 0.3,
    swaps: [{ slot: "RB", inId: "outB", outId: null, delta: 0.3, lockAt: SUN_EARLY }],
    emptySlots: [{ slot: "SUPER_FLEX", playerId: "pBye", reason: "bye" }],
    asOf: 300,
  }),
  C: null,
};

const INPUT: ActionQueueInput = {
  leagues: [A, B, C], leagueOverviewData: OVERVIEW, lineupStatus: LINEUP, userId: ME, players: PLAYERS,
};
const byKey = (items: ActionItem[]) => new Map(items.map((i) => [i.key, i]));

describe("buildActionQueue — lineup items", () => {
  it("lists a swap with its lock time, T badge and Starters landing", () => {
    const item = byKey(buildActionQueue(INPUT)).get("lineup:A:p1:p2");
    expect(item).toMatchObject({
      kind: "lineup", leagueId: "A", leagueName: "Alpha", playerIds: ["p1", "p2"],
      title: "Start Player p1 over Player p2", detail: "FLEX · +4.0 pts",
      deadline: THU, deadlineLabel: "Locks", expiresAt: THU, earlyLockDay: "Thu", appTab: "STARTERS", asOf: 100,
    });
  });

  it("hides lineup changes under the dot's 0.5-point floor", () => {
    const keys = buildActionQueue(INPUT).map((i) => i.key);
    expect(keys.some((k) => k.startsWith("lineup:B"))).toBe(false);
  });

  it("badges T/F/S only when the League Overview flags that day", () => {
    const quiet = { ...LINEUP, A: { ...LINEUP.A!, earlyLocks: [{ day: "Thu" as const, stake: 0.3, moves: [] }] } };
    const item = byKey(buildActionQueue({ ...INPUT, lineupStatus: quiet })).get("lineup:A:p1:p2");
    expect(item?.earlyLockDay).toBeNull();
    expect(item?.deadline).toBe(THU);
  });

  it("times a no-backup risk by the last earlier-game swap, else by inactives", () => {
    const item = byKey(buildActionQueue(INPUT)).get("pivotRisk:A:p3");
    expect(item).toMatchObject({
      kind: "pivotRisk", playerIds: ["p3"], deadline: SUN_EARLY, deadlineLabel: "Swap by",
      expiresAt: SUN_LATE - INACTIVES_LEAD_MS, appTab: "STARTERS",
    });
    expect(item?.detail).toContain("Questionable");

    const noSwap = { ...LINEUP, A: { ...LINEUP.A!, pivotRisks: [{ ...LINEUP.A!.pivotRisks[0], swapBy: null }] } };
    const late = byKey(buildActionQueue({ ...INPUT, lineupStatus: noSwap })).get("pivotRisk:A:p3");
    expect(late).toMatchObject({ deadline: SUN_LATE - INACTIVES_LEAD_MS, deadlineLabel: "Inactives" });
  });

  it("lists slots only a pickup can fill, with distinct keys for repeated slots", () => {
    const items = buildActionQueue(INPUT).filter((i) => i.kind === "emptySlot");
    expect(items.map((i) => [i.key, i.title])).toEqual([
      ["emptySlot:A:K:none:0", "No one to start at K"],
      ["emptySlot:A:K:none:1", "No one to start at K"],
      ["emptySlot:B:SUPER_FLEX:pBye:0", "Player pBye is on bye at SFLEX"],
    ]);
    expect(items.every((i) => i.deadline === null && i.appTab === "STARTERS")).toBe(true);
  });
});

describe("buildActionQueue — roster items (Roster Overview's counts)", () => {
  it("flags over the limit, stale IR and IR-eligible with an open slot; never a taxi player", () => {
    const items = buildActionQueue(INPUT).filter((i) => i.leagueId === "A" && i.appTab === "ROSTERS");
    expect(items.map((i) => i.key).sort()).toEqual(["irEligible:A:irA", "irStale:A:stale", "overLimit:A"]);
    const map = byKey(items);
    expect(map.get("overLimit:A")).toMatchObject({ title: "Over the roster limit by 1", playerIds: [], asOf: 200 });
    expect(map.get("irStale:A:stale")?.detail).toContain("active roster full");
    expect(map.get("irEligible:A:irA")).toMatchObject({ title: "Move Player irA to IR", detail: "IR · 1 open IR slot" });
  });

  it("lists no IR-eligible move once the league's IR is full", () => {
    const keys = buildActionQueue(INPUT).filter((i) => i.leagueId === "B").map((i) => i.key);
    expect(keys).not.toContain("irEligible:B:outB");
    expect(keys).toContain("irStale:B:stale");
  });

  it("still lists roster items with no lineup status (offseason)", () => {
    const items = buildActionQueue({ ...INPUT, lineupStatus: {} });
    expect(items.every((i) => i.appTab === "ROSTERS")).toBe(true);
    expect(items.map((i) => i.key)).toContain("irEligible:C:irA");
    expect(byKey(items).get("irEligible:C:irA")?.asOf).toBeNull();
  });

  it("skips leagues where I have no roster", () => {
    const items = buildActionQueue({ ...INPUT, userId: "nobody", lineupStatus: {} });
    expect(items).toEqual([]);
  });
});

describe("ordering and views", () => {
  const items = buildActionQueue(INPUT);

  it("sorts earliest deadline first, untimed after", () => {
    const deadlines = items.map((i) => i.deadline);
    const timed = deadlines.filter((d): d is number => d != null);
    expect(timed).toEqual([...timed].sort((a, b) => a - b));
    expect(deadlines.indexOf(null)).toBe(timed.length);
    expect([...items].sort(compareActionItems)).toEqual(items);
  });

  it("By league: a Thursday lock leads; the rest follow the user's Sleeper order; Open in app follows the top item", () => {
    const groups = groupActionsByLeague(items, [C, B, A]);
    expect(groups.map((g) => g.league.name)).toEqual(["Alpha", "Charlie", "Bravo"]);
    expect(groups[0]).toMatchObject({ deadline: THU, appTab: "STARTERS" });
    expect(groups[1]).toMatchObject({ deadline: null, appTab: "ROSTERS" });
  });

  it("By player: a swap shows under both players; league-wide items last", () => {
    const groups = groupActionsByPlayer(items, PLAYERS);
    const p1 = groups.find((g) => g.playerId === "p1");
    const p2 = groups.find((g) => g.playerId === "p2");
    expect(p1?.items.map((i) => i.key)).toEqual(["lineup:A:p1:p2"]);
    expect(p2?.items.map((i) => i.key)).toEqual(["lineup:A:p1:p2"]);
    expect(groups[groups.length - 1].playerId).toBeNull();
    expect(groups[groups.length - 1].items.map((i) => i.kind).sort()).toEqual(["emptySlot", "emptySlot", "overLimit"]);
    // irA has moves in two leagues.
    expect(groups.find((g) => g.playerId === "irA")?.items.map((i) => i.leagueId)).toEqual(["A", "C"]);
  });
});

describe("By league order (the user, 10/14): moves due before Sunday's slate, then Sleeper order", () => {
  // Week of Thu 2026-10-15. Eastern times.
  const ET = (iso: string) => Date.parse(`${iso}-04:00`);
  const at = {
    thu: ET("2026-10-15T20:15"),
    sat: ET("2026-10-17T16:30"),
    london: ET("2026-10-18T09:30"),
    inactives1pm: ET("2026-10-18T11:30"),
    sun1pm: ET("2026-10-18T13:00"),
    mnf: ET("2026-10-19T20:15"),
  };
  const move = (leagueId: string, deadline: number | null): ActionItem => ({
    key: `k:${leagueId}`, kind: deadline == null ? "irEligible" : "lineup", leagueId, leagueName: leagueId,
    playerIds: [], title: leagueId, detail: "", deadline, deadlineLabel: deadline == null ? null : "Locks",
    expiresAt: deadline, earlyLockDay: null, appTab: deadline == null ? "ROSTERS" : "STARTERS", asOf: null,
  });
  // Sleeper order (display_order) runs opposite to the list Sleeper sent, to show it's what's read.
  const ids = ["mnf", "sun1pm", "inactives", "untimed", "london", "sat", "thu"];
  const sleeperLeagues = ids.map((id, i) => ({ league_id: id, name: `League ${id}`, display_order: ids.length - 1 - i }) as SleeperLeague);
  const moves = [
    move("thu", at.thu), move("sat", at.sat), move("london", at.london), move("inactives", at.inactives1pm),
    move("sun1pm", at.sun1pm), move("mnf", at.mnf), move("untimed", null),
  ];

  it("puts Thursday / Saturday / Sunday-morning moves first by deadline, then everything else in Sleeper order", () => {
    const order = groupActionsByLeague(moves, sleeperLeagues).map((g) => g.league.league_id);
    // Early: thu, sat, london (by deadline). Then Sleeper order (display_order): thu=0 sat=1 london=2
    // untimed=3 inactives=4 sun1pm=5 mnf=6 — a 1 p.m. inactive call and a MNF lock aren't early.
    expect(order).toEqual(["thu", "sat", "london", "untimed", "inactives", "sun1pm", "mnf"]);
  });

  it("orders early leagues with the same deadline by Sleeper order", () => {
    const twoThu = [move("sat", at.thu), move("thu", at.thu)];
    expect(groupActionsByLeague(twoThu, sleeperLeagues).map((g) => g.league.league_id)).toEqual(["thu", "sat"]);
  });

  it("falls back to list order when Sleeper sends no display_order", () => {
    const plain = ids.map((id) => ({ league_id: id, name: id }) as SleeperLeague);
    const late = [move("mnf", at.mnf), move("untimed", null), move("sun1pm", at.sun1pm)];
    expect(groupActionsByLeague(late, plain).map((g) => g.league.league_id)).toEqual(["mnf", "sun1pm", "untimed"]);
  });
});

describe("getActionState — Done marks", () => {
  const item = { asOf: 1_000 };
  it("is open with no mark", () => {
    expect(getActionState(item, undefined)).toBe("open");
  });
  it("stays hidden while the data predates the click", () => {
    expect(getActionState(item, { at: 1_001 })).toBe("done");
    expect(getActionState({ asOf: null }, { at: 0 })).toBe("done");
  });
  it("comes back flagged when data from after the click still has it", () => {
    expect(getActionState(item, { at: 1_000 })).toBe("stillShowing");
    expect(getActionState(item, { at: 500 })).toBe("stillShowing");
  });
  it("stays hidden for the week once marked again", () => {
    expect(getActionState(item, { at: 500, final: true })).toBe("done");
  });
});

describe("sleeperLeagueUrl", () => {
  it("is the league page the user verified on phone and desktop", () => {
    expect(sleeperLeagueUrl("1312563760086405120")).toBe("https://sleeper.com/leagues/1312563760086405120");
  });
});

// ── To-Do Stage 3: stepping through the leagues needing attention ─────────────

describe("splitActionsByState", () => {
  const base: Omit<ActionItem, "key" | "kind" | "expiresAt"> = {
    leagueId: "A", leagueName: "Alpha", playerIds: [], title: "t", detail: "d", deadline: null,
    deadlineLabel: null, earlyLockDay: null, appTab: "ROSTERS", asOf: 1_000,
  };
  const open: ActionItem = { ...base, key: "open", kind: "irEligible", expiresAt: null };
  const doneItem: ActionItem = { ...base, key: "done", kind: "irEligible", expiresAt: null };
  const flagged: ActionItem = { ...base, key: "flagged", kind: "irEligible", expiresAt: null };
  const expired: ActionItem = { ...base, key: "expired", kind: "lineup", expiresAt: 5_000 };

  it("shows open and flagged items, hides done ones, drops expired ones from both", () => {
    const { visible, hidden } = splitActionsByState(
      [open, doneItem, flagged, expired],
      { done: { at: 2_000 }, flagged: { at: 900 }, expired: { at: 2_000 } },
      5_000
    );
    expect(visible.map((v) => [v.item.key, v.state])).toEqual([["open", "open"], ["flagged", "stillShowing"]]);
    expect(hidden.map((i) => i.key)).toEqual(["done"]);
  });

  it("keeps a timed item until its moment passes", () => {
    expect(splitActionsByState([expired], {}, 4_999).visible.map((v) => v.item.key)).toEqual(["expired"]);
  });
});

describe("getAttentionLeagues — the To-Do hub's By league order", () => {
  const items = buildActionQueue(INPUT);

  it("lists every league with a move, in By league order, each with its Open in app tab", () => {
    const groups = groupActionsByLeague(items, [C, B, A]);
    expect(getAttentionLeagues(items, {}, [C, B, A], 0)).toEqual(
      groups.map((g) => ({ leagueId: g.league.league_id, appTab: g.appTab }))
    );
    expect(groups.map((g) => g.league.league_id)).toEqual(["A", "C", "B"]);
    expect(getAttentionLeagues(items, {}, [C, B, A], 0)[1]).toEqual({ leagueId: "C", appTab: "ROSTERS" });
  });

  it("drops a league once every move in it is marked done", () => {
    const done = Object.fromEntries(items.filter((i) => i.leagueId === "C").map((i) => [i.key, { at: Number.MAX_SAFE_INTEGER }]));
    expect(getAttentionLeagues(items, done, [A, B, C], 0).map((s) => s.leagueId)).toEqual(["A", "B"]);
  });

  it("keeps a league whose done move came back flagged", () => {
    const flagged = items.map((i) => (i.leagueId === "C" ? { ...i, asOf: 10 } : i));
    const done = Object.fromEntries(flagged.filter((i) => i.leagueId === "C").map((i) => [i.key, { at: 5 }]));
    expect(getAttentionLeagues(flagged, done, [A, B, C], 0).map((s) => s.leagueId)).toEqual(["A", "B", "C"]);
  });

  it("leaves out moves past their lock, like the hub", () => {
    const live = items.filter((i) => i.expiresAt == null || i.expiresAt > THU);
    expect(getAttentionLeagues(items, {}, [A, B, C], THU)).toEqual(getAttentionLeagues(live, {}, [A, B, C], 0));
  });
});

describe("getStepIndex", () => {
  const stops = ["L1", "L2", "L3"].map((leagueId) => ({ leagueId, appTab: "STARTERS" as const }));

  it("steps to the neighbour of the selected league, stopping at either end", () => {
    expect(getStepIndex({ stops, cursor: 1 }, "L2", 1)).toBe(2);
    expect(getStepIndex({ stops, cursor: 1 }, "L2", -1)).toBe(0);
    expect(getStepIndex({ stops, cursor: 2 }, "L3", 1)).toBeNull();
    expect(getStepIndex({ stops, cursor: 0 }, "L1", -1)).toBeNull();
  });

  it("goes by the selected league, not the cursor, when it's on the list", () => {
    expect(getStepIndex({ stops, cursor: 0 }, "L3", -1)).toBe(1);
  });

  it("off the list: Next continues after the last stop landed on, Prev goes back to it", () => {
    expect(getStepIndex({ stops, cursor: 1 }, "elsewhere", 1)).toBe(2);
    expect(getStepIndex({ stops, cursor: 1 }, "elsewhere", -1)).toBe(1);
    expect(getStepIndex({ stops, cursor: 1 }, null, 1)).toBe(2);
  });

  it("off the list before the first step: Next starts at the top, Prev goes nowhere", () => {
    expect(getStepIndex({ stops, cursor: -1 }, "elsewhere", 1)).toBe(0);
    expect(getStepIndex({ stops, cursor: -1 }, "elsewhere", -1)).toBeNull();
  });
});
