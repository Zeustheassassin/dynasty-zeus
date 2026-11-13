import { describe, it, expect } from "vitest";
import { chartedCounts, isQBThrow, isRBRun, isTERoute } from "@/lib/scouting/chartedCounts";
import type { ProspectWithStats, ScoutingGame, QBPlay, RBPlay, TEPlay } from "@/lib/types";

const prospect = (id: string, position: string, extra: Partial<ProspectWithStats> = {}) =>
  ({ id, position, ...extra }) as ProspectWithStats;
const game = (id: string, prospect_id: string) => ({ id, prospect_id }) as ScoutingGame;
const qb = (game_id: string, play_type: string, timing: string | null) => ({ game_id, play_type, timing }) as QBPlay;
const rb = (game_id: string, run_type: string) => ({ game_id, run_type }) as RBPlay;
const te = (game_id: string, play_type: string) => ({ game_id, play_type }) as TEPlay;

describe("the play predicates", () => {
  it("counts a QB throw as a pass / RPO ball that left his hand", () => {
    expect(isQBThrow(qb("g", "pass", "first_option"))).toBe(true);
    expect(isQBThrow(qb("g", "rpo", null))).toBe(true);
    expect(isQBThrow(qb("g", "run", null))).toBe(false);
    for (const t of ["scramble", "sack", "throw_away"]) expect(isQBThrow(qb("g", "pass", t))).toBe(false);
  });
  it("counts the four run schemes as RB runs, nothing else", () => {
    for (const t of ["outside_zone", "inside_zone", "outside_man_gap", "inside_man_gap"]) expect(isRBRun(rb("g", t))).toBe(true);
    for (const t of ["pass_block", "run_block", "decoy", "route"]) expect(isRBRun(rb("g", t))).toBe(false);
  });
  it("counts route_run as a TE route", () => {
    expect(isTERoute(te("g", "route_run"))).toBe(true);
    expect(isTERoute(te("g", "run_block"))).toBe(false);
  });
});

describe("chartedCounts", () => {
  const PROSPECTS = [
    prospect("q", "QB"),
    prospect("r", "RB"),
    prospect("w", "WR", { total_snaps: 70, total_routes: 61 }),
    prospect("t", "TE"),
    prospect("k", "K"),
    prospect("none", "QB"),
  ];
  const GAMES = [game("gq1", "q"), game("gq2", "q"), game("gr", "r"), game("gw1", "w"), game("gw2", "w"), game("gw3", "w"), game("gt", "t")];
  const PLAYS = {
    qb: [qb("gq1", "pass", "first_option"), qb("gq1", "pass", "sack"), qb("gq2", "run", null), qb("gq2", "rpo", "checkdown")],
    rb: [rb("gr", "inside_zone"), rb("gr", "pass_block"), rb("gr", "outside_man_gap"), rb("gr", "route")],
    te: [te("gt", "route_run"), te("gt", "run_block"), te("gt", "route_run")],
  };

  it("counts each position's games, snaps and own plays", () => {
    const m = chartedCounts(PROSPECTS, GAMES, PLAYS, true);
    expect(m.get("q")).toEqual({ games: 2, snaps: 4, plays: 2 });
    expect(m.get("r")).toEqual({ games: 1, snaps: 4, plays: 2 });
    expect(m.get("w")).toEqual({ games: 3, snaps: 70, plays: 61 });
    expect(m.get("t")).toEqual({ games: 1, snaps: 3, plays: 2 });
    expect(m.get("none")).toEqual({ games: 0, snaps: 0, plays: 0 });
    expect(m.has("k")).toBe(false);
  });

  it("leaves QB / RB / TE snaps and plays unknown until their plays load; WR doesn't wait", () => {
    const m = chartedCounts(PROSPECTS, GAMES, { qb: [], rb: [], te: [] }, false);
    expect(m.get("q")).toEqual({ games: 2, snaps: null, plays: null });
    expect(m.get("t")).toEqual({ games: 1, snaps: null, plays: null });
    expect(m.get("w")).toEqual({ games: 3, snaps: 70, plays: 61 });
  });

  it("ignores plays from a game it can't place", () => {
    const m = chartedCounts(PROSPECTS, GAMES, { ...PLAYS, qb: [...PLAYS.qb, qb("orphan", "pass", null)] }, true);
    expect(m.get("q")!.snaps).toBe(4);
  });
});
