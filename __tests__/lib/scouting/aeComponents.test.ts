import { describe, it, expect } from "vitest";
import { countStat, formatRate, type CountStatDef, type GameCount } from "@/lib/scouting/countComponents";
import { PFF_COMPONENTS, PFF_COMPONENT_WEIGHTS, pffGameCounts } from "@/lib/scouting/pffComponents";
import { CHARTED_COMPONENTS, CHARTED_COMPONENT_WEIGHTS, chartedGameCounts } from "@/lib/scouting/chartedComponents";
import { TAG_COMPONENTS, TAG_COMPONENT_WEIGHTS, TAG_STAT_FLOOR, tagStatReps, tagStatValues, tagGameCounts } from "@/lib/scouting/tagStats";
import { buildComponents, componentWeight, COMPONENT_SPREAD_FLOOR } from "@/lib/scouting/aeComponents";
import { SEASON_DECAY } from "@/lib/scouting/seasonWeight";
import type { PffGameRow } from "@/lib/pff/stats";
import type { QBPlay, RBPlay, ScoutingGame, TEPlay } from "@/lib/types";
import type { OpponentTier } from "@/lib/scouting/opponentTier";

const def = (over: Partial<CountStatDef> = {}): CountStatDef => ({
  key: "k", label: "K%", source: "pff", pos: "WR", dir: 1, scale: 100, unit: "tries", floor: 10, suffix: "%", description: "", ...over,
});
const game = (id: string, prospect_id: string, season_year = 2025, extra: Partial<ScoutingGame> = {}): ScoutingGame =>
  ({ id, prospect_id, season_year, created_at: "2026-06-01T00:00:00Z", pff_game_id: 100, pff_match_status: "auto", ...extra }) as ScoutingGame;

describe("countStat", () => {
  it("rates from summed counts, season-weighted, under the floor null", () => {
    const games = [game("a1", "A", 2025), game("a2", "A", 2024), game("b1", "B")];
    const counts: GameCount[] = [
      { prospectId: "A", gameId: "a1", num: 5, den: 10 },
      { prospectId: "A", gameId: "a2", num: 1, den: 10 },
      { prospectId: "B", gameId: "b1", num: 2, den: 5 },
    ];
    const r = countStat(def(), counts, games);
    const w = SEASON_DECAY;
    expect((r.samples.get("A") as { rate: number }).rate).toBeCloseTo(100 * (5 + w * 1) / (10 + w * 10), 9);
    expect(r.samples.get("B")).toBeNull(); // 5 tries < floor 10
    expect(r.poolRate).toBeCloseTo(100 * 8 / 25, 9);
  });

  it("measures noise from how each player's games scatter around his own rate", () => {
    // Every game exactly at the player's rate → no dispersion.
    const flat = countStat(def({ floor: 1 }), [
      { prospectId: "A", gameId: "a1", num: 3, den: 10 }, { prospectId: "A", gameId: "a2", num: 6, den: 20 },
    ], [game("a1", "A"), game("a2", "A")]);
    expect(flat.dispersion).toBeCloseTo(0, 12);
    const noisy = countStat(def({ floor: 1 }), [
      { prospectId: "A", gameId: "a1", num: 9, den: 10 }, { prospectId: "A", gameId: "a2", num: 1, den: 10 },
    ], [game("a1", "A"), game("a2", "A")]);
    expect(noisy.dispersion!).toBeGreaterThan(0.5);
    // v = φ / D for one season, in display units (×100²).
    expect(noisy.samples.get("A")!.variance).toBeCloseTo((noisy.dispersion! / 20) * 1e4, 6);
  });

  it("orients a lower-is-better stat so higher is better, keeping the rate as shown", () => {
    const r = countStat(def({ dir: -1, floor: 1 }), [{ prospectId: "A", gameId: "a1", num: 1, den: 10 }, { prospectId: "A", gameId: "a2", num: 1, den: 10 }], [game("a1", "A"), game("a2", "A")]);
    const s = r.samples.get("A")!;
    expect(s.rate).toBeCloseTo(10, 9);
    expect(s.ae).toBeCloseTo(-10, 9);
  });

  it("takes the within-player lift vs weaker opponents back out", () => {
    // Six prospects, each 50% vs P4 and 80% vs G5.
    const games: ScoutingGame[] = [];
    const counts: GameCount[] = [];
    const tiers = new Map<string, OpponentTier>();
    for (let k = 0; k < 6; k++) {
      for (const [g, tier, num] of [[`p${k}`, "P4", 50], [`p${k}b`, "P4", 50], [`g${k}`, "G5", 80]] as const) {
        games.push(game(g, `X${k}`)); counts.push({ prospectId: `X${k}`, gameId: g, num, den: 100 }); tiers.set(g, tier);
      }
    }
    const r = countStat(def({ floor: 1 }), counts, games, tiers);
    expect(r.measured).toBe(true);
    expect(r.effects.G5).toBeGreaterThan(0.1);
    const s = r.samples.get("X0")!;
    expect(s.rawAe).toBeCloseTo(60, 9);
    expect(s.ae).toBeLessThan(60);
  });

  it("formats rates by their unit", () => {
    expect(formatRate(def(), 6.12)).toBe("6.1%");
    expect(formatRate(def({ scale: 1, suffix: " yds/route" }), 2.456)).toBe("2.46 yds/route");
  });
});

describe("the component lists", () => {
  it("keep PFF to what the user doesn't chart (no skill counted twice)", () => {
    const pff = PFF_COMPONENTS.map((d) => d.key);
    for (const doubled of ["pff_qb_p2s", "pff_rb_mtf", "pff_rb_15p", "pff_rb_pr", "pff_wr_drop", "pff_wr_cc", "pff_te_pr"]) expect(pff).not.toContain(doubled);
    expect(CHARTED_COMPONENTS.map((d) => d.key)).toEqual(expect.arrayContaining(["ch_qb_p2s", "ch_rb_btk", "ch_rb_expl", "ch_rb_pb", "ch_wr_drop", "ch_wr_cc"]));
  });

  it("carry the user's approved weights (2026-10-05)", () => {
    expect(PFF_COMPONENT_WEIGHTS).toEqual({ pff_btt: 0.4, pff_twp: 0.4, pff_qb_ypc: 0.3, pff_rb_yco: 0.3, pff_rb_yprr: 0.2, pff_wr_yprr: 0.5, pff_wr_yac: 0.2, pff_te_yprr: 0.5 });
    expect(CHARTED_COMPONENT_WEIGHTS.ch_rb_btk).toBe(0.3);
    expect(TAG_COMPONENT_WEIGHTS.tag_wr_press).toBe(0.15);
    // QB-fault sacks are shown, not scored: the charted sacks already score sacks.
    expect(TAG_COMPONENTS.map((d) => d.key)).not.toContain("tag_qb_qbsack");
    expect(componentWeight("pff_btt", { pff_btt: 0 })).toBe(0);
    expect(COMPONENT_SPREAD_FLOOR).toBe(0.5);
  });
});

const pffRow = (game_id: string, prospect_id: string, over: Partial<PffGameRow>): PffGameRow =>
  ({ game_id, prospect_id, pff_game_id: 100, season: 2025, week: 1, ...over }) as PffGameRow;

describe("per-game counts", () => {
  it("PFF: only games still linked to the PFF game the row is for", () => {
    const yprr = PFF_COMPONENTS.find((d) => d.key === "pff_wr_yprr")!;
    const games = [game("g1", "W"), game("g2", "W", 2025, { pff_game_id: 999 }), game("g3", "W", 2025, { pff_match_status: "review" })];
    const rows = ["g1", "g2", "g3"].map((g) => pffRow(g, "W", { rec_yards: 50, routes: 25 }));
    const c = pffGameCounts(yprr, games, rows, () => "WR");
    expect(c).toEqual([{ prospectId: "W", gameId: "g1", num: 50, den: 25 }]);
    expect(pffGameCounts(yprr, games, rows, () => "RB")).toEqual([]);
  });

  it("charted: QB sacks per pressured dropback, RB broken tackles per known run, WR drops per catchable target", () => {
    const games = [game("q", "Q"), game("r", "R")];
    const qb = (over: Partial<QBPlay>) => ({ game_id: "q", play_type: "pass", pressure: "front_side", timing: "first_option", ...over }) as QBPlay;
    const rb = (over: Partial<RBPlay>) => ({ game_id: "r", run_type: "inside_zone", success: true, broken_tackle: false, ...over }) as RBPlay;
    const inp = {
      games,
      qbPlays: [qb({ timing: "sack" }), qb({}), qb({ pressure: "clean", timing: "sack" }), qb({ play_type: "run" })],
      rbPlays: [rb({ broken_tackle: true }), rb({}), rb({ run_type: "route", success: null }), rb({ success: null })],
      wrRouteCounts: [{ prospect_id: "W", game_id: "w", routes: 30, targets: 8, catches: 6, drops: 1, contested: 2, contested_catches: 1 }],
    };
    expect(chartedGameCounts("ch_qb_p2s", inp)).toEqual([{ prospectId: "Q", gameId: "q", num: 1, den: 2 }]);
    expect(chartedGameCounts("ch_rb_btk", inp)).toEqual([{ prospectId: "R", gameId: "r", num: 1, den: 2 }]);
    expect(chartedGameCounts("ch_wr_drop", inp)).toEqual([{ prospectId: "W", gameId: "w", num: 1, den: 7 }]);
    expect(chartedGameCounts("ch_wr_cc", inp)).toEqual([{ prospectId: "W", gameId: "w", num: 1, den: 2 }]);
  });
});

describe("tag stats", () => {
  const g = [game("t1", "T")];
  const te = (over: Partial<TEPlay>) => ({ game_id: "t1", ...over }) as TEPlay;

  it("count only tagged plays the tag applied to, with their own n, and show nothing under the floor", () => {
    const plays = [
      ...Array.from({ length: 12 }, (_, i) => te({ press_release: i < 9 ? "won" : "lost" })),
      te({ press_release: null }), te({}),
    ];
    const v = tagStatValues(tagStatReps({ games: g, qbPlays: [], rbPlays: [], tePlays: plays, wrTagRows: [] })).get("T")!;
    expect(v.tag_te_press).toEqual({ rate: 75, n: 12 });
    const few = tagStatValues(tagStatReps({ games: g, qbPlays: [], rbPlays: [], tePlays: plays.slice(0, TAG_STAT_FLOOR - 1), wrTagRows: [] })).get("T")!;
    expect(few.tag_te_press.rate).toBeNull();
    expect(few.tag_te_press.n).toBe(TAG_STAT_FLOOR - 1);
  });

  it("read the WR stats from the tagged route cells (migration 064)", () => {
    const wrTagRows = [{ prospect_id: "W", game_id: "w1", cells: { "slant|press|left|on|0|0|0|0|won|-": [8, 5], "slant|press|left|on|0|0|0|0|lost|-": [4, 1], "curl|zone|slot|off|0|0|0|0|-|1": [3, 3], "curl|zone|slot|off|0|0|0|0|-|0": [9, 9] } as Record<string, [number, number]> }];
    const reps = tagStatReps({ games: [], qbPlays: [], rbPlays: [], tePlays: [], wrTagRows });
    const v = tagStatValues(reps).get("W")!;
    expect(v.tag_wr_press).toEqual({ rate: (8 / 12) * 100, n: 12 });
    expect(v.tag_wr_btac).toEqual({ rate: 25, n: 12 });
    expect(tagGameCounts("tag_wr_press", reps)).toEqual([{ prospectId: "W", gameId: "w1", num: 8, den: 12 }]);
  });

  it("are empty for a prospect charted before the tags (no tagged plays)", () => {
    const old = [te({ press_release: undefined }), te({})];
    expect(tagStatValues(tagStatReps({ games: g, qbPlays: [], rbPlays: [], tePlays: old, wrTagRows: [] })).get("T")).toBeUndefined();
  });
});

describe("buildComponents", () => {
  it("builds every component per position, counted or not, with its weight", () => {
    const b = buildComponents({
      prospects: [], games: [], pffGameRows: [], tierByGame: new Map(), qbPlays: [], rbPlays: [], wrRouteCounts: [],
      tagReps: tagStatReps({ games: [], qbPlays: [], rbPlays: [], tePlays: [], wrTagRows: [] }),
    });
    expect(b.results.length).toBe(CHARTED_COMPONENTS.length + PFF_COMPONENTS.length + TAG_COMPONENTS.length);
    const yprr = b.extra.WR.find((m) => m.key === "pff_wr_yprr")!;
    expect(yprr).toMatchObject({ label: "PFF YPRR", weight: 0.5, perPlayer: true, spreadFloor: COMPONENT_SPREAD_FLOOR });
    expect(b.extra.RB.find((m) => m.key === "ch_rb_btk")!.label).toBe("BTkl%");
    expect(b.extra.WR.find((m) => m.key === "tag_wr_press")!.label).toBe("Tag Press Win%");
  });
});
