import { describe, it, expect } from "vitest";
import { PFF_GRADE, rankSortValue, readyToChart } from "../../../lib/scouting/readyToChart";
import type { PffTotals } from "../../../lib/pff/totals";
import type { Prospect, ScoutingGame } from "../../../lib/types";

// 2026-11-21, the user: "When i havent charted any games for a player but have
// some logged for them can you rank them in order of their PFF score? … any
// player who doesnt have a rank or a game manually charted who has a Game
// logged … so i can decide who to tackle first out of the guys who are ready."

type P = Pick<Prospect, "id" | "position" | "personal_rank" | "eligible_thru_year">;
const prospect = (id: string, extra: Partial<P> = {}): P => ({ id, position: "WR", personal_rank: null, ...extra });
const game = (prospect_id: string): Pick<ScoutingGame, "prospect_id"> => ({ prospect_id });

/** PFF totals carrying just the aggregate grades a test needs (pffValues reads the rest as missing). */
const totals = (agg: Record<string, number>): PffTotals =>
  ({ linked: 1, games: 1, seasons: 1, seasonsCurrent: 1, sum: {}, agg }) as unknown as PffTotals;

describe("readyToChart", () => {
  it("takes unranked prospects with logged games and none charted, with his position's PFF grade", () => {
    const prospects = [
      prospect("wr", { position: "WR" }),
      prospect("rb", { position: "RB" }),
      prospect("qb", { position: "QB" }),
      prospect("te", { position: "TE" }),
    ];
    const games = prospects.map((p) => game(p.id));
    const pff = new Map([
      ["wr", totals({ grade_pass_route: 81.24, grade_offense: 60 })],
      ["rb", totals({ grade_run: 74.06, grade_offense: 60 })],
      ["qb", totals({ grade_pass: 88.9, grade_offense: 60 })],
      ["te", totals({ grade_offense: 70.1 })],
    ]);
    expect(readyToChart(prospects, games, new Map(), pff)).toEqual(new Map([
      ["wr", 81.2], ["rb", 74.1], ["qb", 88.9], ["te", 70.1],
    ]));
  });

  it("leaves out ranked prospects, charted ones and ones with nothing logged", () => {
    const prospects = [
      prospect("ranked", { personal_rank: 4 }),
      prospect("charted"),
      prospect("no-games"),
      prospect("ready"),
    ];
    const games = [game("ranked"), game("charted"), game("charted"), game("ready")];
    const ready = readyToChart(prospects, games, new Map([["charted", 1]]), new Map());
    expect([...ready!.keys()]).toEqual(["ready"]);
  });

  it("keeps a ready prospect with no PFF grade yet, as null", () => {
    const ready = readyToChart([prospect("a")], [game("a")], new Map(), new Map());
    expect(ready).toEqual(new Map([["a", null]]));
  });

  it("calls no one ready when charted games are unknown", () => {
    expect(readyToChart([prospect("a")], [game("a")], null, new Map())).toBeNull();
  });

  it("can go by OVR rank instead (Chart Next's first looks): a position rank alone doesn't count", () => {
    const prospects = [
      { ...prospect("posOnly", { personal_rank: 14 }), overall_rank: null },
      { ...prospect("ovr"), overall_rank: 40 },
    ];
    const games = [game("posOnly"), game("ovr")];
    expect([...readyToChart(prospects, games, new Map(), new Map(), "overall")!.keys()]).toEqual(["posOnly"]);
    expect([...readyToChart(prospects, games, new Map(), new Map())!.keys()]).toEqual(["ovr"]);
  });

  it("uses the same headline grade as the prospect report", () => {
    expect(PFF_GRADE).toEqual({
      WR: { key: "pff_gr_route", label: "PFF route grade" },
      QB: { key: "pff_gr_pass", label: "PFF pass grade" },
      RB: { key: "pff_gr_run", label: "PFF run grade" },
      TE: { key: "pff_gr_off", label: "PFF offense grade" },
    });
  });
});

describe("rankSortValue", () => {
  const order = (ps: P[], ready: ReadonlyMap<string, number | null> | null) =>
    [...ps].sort((a, b) => rankSortValue(a, ready) - rankSortValue(b, ready)).map((p) => p.id);

  it("ranked by rank, then the ready ones best PFF grade first, then everyone else", () => {
    const ps = [
      prospect("other"),
      prospect("ready-60", {}),
      prospect("ready-none"),
      prospect("rank-200", { personal_rank: 200 }),
      prospect("ready-85"),
      prospect("rank-1", { personal_rank: 1 }),
    ];
    const ready = new Map<string, number | null>([["ready-60", 60], ["ready-none", null], ["ready-85", 85]]);
    expect(order(ps, ready)).toEqual(["rank-1", "rank-200", "ready-85", "ready-60", "other", "ready-none"]);
  });

  // 2026-11-23, the user: "Can we then have it sort by eligibility date so 2027
  // first 2028 next 2029 next", "so basically all the players that dont have the
  // first 2 get sorted by the last one".
  it("sorts everyone with neither a rank nor a PFF grade by Eligible Thru, soonest first, no year last", () => {
    const ps = [
      prospect("none-2029", { eligible_thru_year: 2029 }),
      prospect("none-blank"),
      prospect("ready-no-grade-2028", { eligible_thru_year: 2028 }),
      prospect("graded-2029", { eligible_thru_year: 2029 }),
      prospect("none-2027", { eligible_thru_year: 2027 }),
      prospect("rank-5-2030", { personal_rank: 5, eligible_thru_year: 2030 }),
    ];
    const ready = new Map<string, number | null>([["ready-no-grade-2028", null], ["graded-2029", 70]]);
    expect(order(ps, ready)).toEqual(["rank-5-2030", "graded-2029", "none-2027", "ready-no-grade-2028", "none-2029", "none-blank"]);
  });

  it("falls back to rank, then Eligible Thru, when readiness is unknown", () => {
    const ps = [prospect("b"), prospect("rank-3", { personal_rank: 3 }), prospect("a-2028", { eligible_thru_year: 2028 })];
    expect(order(ps, null)).toEqual(["rank-3", "a-2028", "b"]);
  });
});
