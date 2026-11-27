import { describe, it, expect } from "vitest";
import {
  buildChartNext,
  chartNextDefaultClass,
  halfSample,
  pacePerWeek,
  samplePlaysOf,
  weeksAtPace,
  weeksToGoal,
  type ChartNextInputs,
} from "../../../lib/scouting/chartNext";
import type { PffTotals } from "../../../lib/pff/totals";
import type { ProspectWithStats, ScoutingGame } from "../../../lib/types";

// 2026-11-26, the user's goal: the 2027 class's OVR top 60 at a full sample
// and 61–150 at half, top 60 done by mid-Feb / early March. Chart Next lists
// who's short, the tape in hand, first looks and imported WRs to re-chart.

const prospect = (id: string, extra: Partial<ProspectWithStats> = {}) =>
  ({
    id, name: id, position: "WR", school: "Georgia", conference: null, draft_class_year: 2027,
    overall_rank: null, personal_rank: null, eligible_thru_year: null, total_routes: 0, sae_sample: null, ...extra,
  }) as unknown as ProspectWithStats;

let slot = 0;
const game = (id: string, prospect_id: string, extra: Partial<ScoutingGame> = {}) =>
  ({ id, prospect_id, season_year: 2026, game_slot: ++slot, opponent: `Opp ${id}`, game_type: "regular", created_at: "2026-11-01T12:00:00Z", ...extra }) as ScoutingGame;

const wrSample = (n: number) => ({ ae: 0, n, variance: 0 });

/** PFF totals carrying just the aggregate grades a test needs. */
const pff = (agg: Record<string, number>): PffTotals =>
  ({ linked: 1, games: 1, seasons: 1, seasonsCurrent: 1, sum: {}, agg }) as unknown as PffTotals;

function inputs(extra: Partial<ChartNextInputs>): ChartNextInputs {
  return { prospects: [], games: [], snapCounts: [], samplePlays: new Map(), pffTotals: new Map(), routeCounts: [], ...extra };
}

describe("samplePlaysOf", () => {
  it("reads a WR's SAE sample (his routes under its floor) and QB / RB / TE sample plays", () => {
    const samples = new Map([["qb", { QB: 120 }], ["rb", { RB: 40 }], ["te", { TE: 70 }]]);
    expect(samplePlaysOf(prospect("wr", { sae_sample: wrSample(150), total_routes: 151 }), samples)).toBe(150);
    expect(samplePlaysOf(prospect("wr2", { total_routes: 12 }), samples)).toBe(12);
    expect(samplePlaysOf(prospect("qb", { position: "QB" }), samples)).toBe(120);
    expect(samplePlaysOf(prospect("rb", { position: "RB" }), samples)).toBe(40);
    expect(samplePlaysOf(prospect("te", { position: "TE" }), samples)).toBe(70);
    expect(samplePlaysOf(prospect("none", { position: "TE" }), samples)).toBe(0);
  });

  it("half samples: QB 90, RB 50, WR 80, TE 70", () => {
    expect([halfSample("QB"), halfSample("RB"), halfSample("WR"), halfSample("TE")]).toEqual([90, 50, 80, 70]);
  });
});

describe("buildChartNext: the goal bands", () => {
  const prospects = [
    prospect("done", { overall_rank: 1, sae_sample: wrSample(160) }),
    prospect("short", { overall_rank: 2, sae_sample: wrSample(100), conference: "SEC" }),
    prospect("slow", { overall_rank: 3, position: "RB", school: "Ohio State" }), // BIG 10 from his school
    prospect("halfDone", { overall_rank: 61, position: "QB" }),
    prospect("halfShort", { overall_rank: 150, position: "TE" }),
    prospect("past150", { overall_rank: 151, sae_sample: wrSample(10) }),
    prospect("otherClass", { overall_rank: 4, draft_class_year: 2028 }),
    prospect("edge", { overall_rank: 5, position: "EDGE" }),
  ];
  const samplePlays = new Map([["slow", { RB: 30 }], ["halfDone", { QB: 95 }], ["halfShort", { TE: 20 }]]);
  const b = buildChartNext(2027, inputs({ prospects, samplePlays }));

  it("lists OVR 1–60 short of a full sample, in OVR order, and counts the rest as done", () => {
    expect(b.top.map((r) => r.prospect.id)).toEqual(["short", "slow"]);
    expect(b.top.map((r) => [r.target, r.toGo])).toEqual([[160, 60], [100, 70]]);
    expect(b.goals.full).toEqual({
      slots: 60, ranked: 3, done: 1, toGo: 130, toGoSlow: 70, byPos: { QB: 0, RB: 70, WR: 60, TE: 0 },
    });
  });

  it("lists OVR 61–150 short of half a sample; past 150, other classes and other positions stay out", () => {
    expect(b.half.map((r) => [r.prospect.id, r.target, r.toGo])).toEqual([["halfShort", 70, 50]]);
    expect(b.goals.half).toMatchObject({ slots: 90, ranked: 2, done: 1, toGo: 50, toGoSlow: 0 });
  });

  it("marks slow-tape conferences from his saved conference or his school's", () => {
    const slow = b.top.find((r) => r.prospect.id === "slow")!;
    expect([slow.conference, slow.slowTape]).toEqual(["BIG 10", true]);
    const short = b.top.find((r) => r.prospect.id === "short")!;
    expect([short.conference, short.slowTape]).toEqual(["SEC", false]);
  });

  it("carries the Big Board's sample % and tier", () => {
    const short = b.top.find((r) => r.prospect.id === "short")!;
    expect([short.n, short.full, short.pct, short.tier]).toEqual([100, 160, 62, "half"]);
  });
});

describe("buildChartNext: tape in hand and games to go", () => {
  const prospects = [
    prospect("a", { overall_rank: 1, sae_sample: wrSample(60) }),
    prospect("b", { overall_rank: 2 }),
    prospect("c", { overall_rank: 3, sae_sample: wrSample(30) }),
  ];
  const games = [
    game("a1", "a", { season_year: 2025 }), game("a2", "a"), game("a3", "a", { season_year: 2025 }), game("a4", "a"),
    game("b1", "b"),
    game("c1", "c"),
  ];
  const snapCounts = [
    { game_id: "a1", snaps_charted: 40 }, { game_id: "a2", snaps_charted: 35 },
    { game_id: "a3", snaps_charted: 0 }, { game_id: "a4", snaps_charted: 0 },
    { game_id: "b1", snaps_charted: 0 }, { game_id: "c1", snaps_charted: 20 },
  ];
  const b = buildChartNext(2027, inputs({ prospects, games, snapCounts }));
  const row = (id: string) => b.top.find((r) => r.prospect.id === id)!;

  it("tape in hand = logged games with no charted play, newest season first", () => {
    expect(row("a").unwatched.map((g) => g.id)).toEqual(["a4", "a3"]);
    expect([row("a").logged, row("a").charted]).toEqual([4, 2]);
    expect(row("c").unwatched).toEqual([]);
  });

  it("games to go at his own rate, else his position's across the hub", () => {
    // a: 60 routes over 2 charted games = 30 a game; 100 to go → 4 games.
    expect([row("a").perGame, row("a").gamesNeeded]).toEqual([30, 4]);
    // b: nothing charted, so the WR rate: (60 + 30) / (2 + 1) = 30; 160 to go → 6.
    expect([row("b").perGame, row("b").gamesNeeded]).toEqual([30, 6]);
  });

  it("without the play counts, tape in hand and first looks are unknown", () => {
    const blind = buildChartNext(2027, inputs({ prospects, games, snapCounts: null }));
    expect(blind.chartedKnown).toBe(false);
    expect(blind.top.every((r) => r.charted == null && r.unwatched.length === 0)).toBe(true);
    expect(blind.firstLooks).toEqual([]);
  });
});

describe("buildChartNext: first looks", () => {
  const prospects = [
    prospect("ranked", { overall_rank: 1 }),
    prospect("posRankedOnly", { personal_rank: 14, position: "TE" }),
    prospect("lowGrade", { position: "RB" }),
    prospect("highGrade", { position: "QB" }),
    prospect("ungraded2028", { eligible_thru_year: 2028 }),
    prospect("ungraded2027", { eligible_thru_year: 2027 }),
    prospect("charted"),
    prospect("nothingLogged"),
    prospect("nextClass", { draft_class_year: 2028 }),
  ];
  const games = ["ranked", "posRankedOnly", "lowGrade", "highGrade", "ungraded2028", "ungraded2027", "charted", "nextClass"]
    .map((id) => game(`g-${id}`, id));
  const snapCounts = games.map((g) => ({ game_id: g.id, snaps_charted: g.prospect_id === "charted" ? 30 : 0 }));
  const pffTotals = new Map([
    ["posRankedOnly", pff({ grade_offense: 70 })],
    ["lowGrade", pff({ grade_run: 61.0 })],
    ["highGrade", pff({ grade_pass: 88.0 })],
  ]);
  const b = buildChartNext(2027, inputs({ prospects, games, snapCounts, pffTotals }));

  it("takes the class's prospects with no OVR rank, games logged and none charted: PFF grade first, then Eligible Thru", () => {
    expect(b.firstLooks.map((r) => [r.prospect.id, r.pffGrade])).toEqual([
      ["highGrade", 88], ["posRankedOnly", 70], ["lowGrade", 61], ["ungraded2027", null], ["ungraded2028", null],
    ]);
  });

  it("asks a first look for half a sample, and counts the unranked with nothing logged", () => {
    expect(b.firstLooks.find((r) => r.prospect.id === "highGrade")!.toGo).toBe(90);
    expect(b.unrankedNoGames).toBe(1);
  });
});

describe("buildChartNext: re-chart imported WRs", () => {
  const imported = { created_at: "2026-04-30T19:00:00Z" };
  const prospects = [
    prospect("mixed", { overall_rank: 2, sae_sample: wrSample(150) }),
    prospect("fullInApp", { overall_rank: 1, sae_sample: wrSample(300) }),
    prospect("inAppOnly", { overall_rank: 3, sae_sample: wrSample(40) }),
    prospect("unranked", { sae_sample: wrSample(100) }),
    prospect("rb", { overall_rank: 4, position: "RB" }),
  ];
  const games = [
    game("m-old1", "mixed", imported), game("m-old2", "mixed", imported), game("m-new", "mixed"),
    game("f-old", "fullInApp", imported), game("f-new", "fullInApp"),
    game("i-new", "inAppOnly"),
    game("u-old", "unranked", imported),
    game("r-old", "rb", imported),
  ];
  const routeCounts = [
    { game_id: "m-old1", routes: 60 }, { game_id: "m-old2", routes: 50 }, { game_id: "m-new", routes: 40 },
    { game_id: "f-old", routes: 100 }, { game_id: "f-new", routes: 200 },
    { game_id: "i-new", routes: 40 }, { game_id: "u-old", routes: 100 },
  ];
  const b = buildChartNext(2027, inputs({ prospects, games, routeCounts }));

  it("lists ranked WRs with imported routes, short of a full sample in the app; to go = in-app routes to full", () => {
    expect(b.rechart.map((r) => [r.prospect.id, r.imported, r.toGo])).toEqual([
      ["mixed", { routes: 110, games: 2, inApp: 40 }, 120],
    ]);
    expect(b.rechartFullInApp).toBe(1);
  });
});

describe("pace and weeks", () => {
  it("sample plays a week over the last 4 weeks", () => {
    expect(pacePerWeek({ QB: 268, RB: 1054, WR: 1527, TE: 10 })).toBeCloseTo(714.75);
    expect(pacePerWeek({ QB: 70, RB: 0, WR: 0, TE: 0 }, 7)).toBe(70);
  });

  it("weeks at that pace; none to go is done, no pace is unknown", () => {
    expect(weeksAtPace(1430, 715)).toBe(2);
    expect(weeksAtPace(0, 0)).toBe(0);
    expect(weeksAtPace(100, 0)).toBeNull();
  });

  it("opens on the class being scouted: next year's from May, after the draft", () => {
    expect(chartNextDefaultClass([2026, 2027, 2028], new Date(2026, 10, 27))).toBe(2027);
    expect(chartNextDefaultClass([2026, 2027, 2028], new Date(2027, 1, 1))).toBe(2027);
    expect(chartNextDefaultClass([2026, 2027, 2028], new Date(2027, 4, 2))).toBe(2028);
    expect(chartNextDefaultClass([2026], new Date(2026, 10, 27))).toBe(2026);
    expect(chartNextDefaultClass([], new Date(2026, 10, 27))).toBeNull();
  });

  it("weeks to the goal window, Feb 15 to Mar 1 of the class year", () => {
    expect(weeksToGoal(2027, new Date(2026, 10, 27))).toEqual({ from: 11, to: 13 });
    expect(weeksToGoal(2027, new Date(2027, 1, 20))).toEqual({ from: 0, to: 1 });
    expect(weeksToGoal(2027, new Date(2027, 2, 2))).toBeNull();
  });
});
