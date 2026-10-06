import { describe, it, expect } from "vitest";
import type { ProspectWithStats, QBPlay, RBPlay, ScoutingGame, TEPlay } from "../../../lib/types";
import {
  ordinal, overviewPagesFor, percentileRanks, pffSource, qbOverview, rbOverview, teOverview, wrOverview,
  PERCENTILE_MIN_POOL, type OverviewPage, type OverviewStat,
} from "../../../lib/scouting/overviewStats";

const stat = (page: OverviewPage, key: string): OverviewStat | undefined =>
  [...page.main, ...page.columns].flatMap((s) => s.stats).find((s) => s.key === key);
const section = (page: OverviewPage, key: string) => [...page.main, ...page.columns].find((s) => s.key === key);

const cvg = (count: number, open: number) => ({ count, open, catches: 0 });
const wr = (id: string, extra: Partial<ProspectWithStats> = {}) =>
  ({
    id, name: id, position: "WR", draft_class_year: 2027,
    total_games: 9, total_snaps: 486, total_routes: 352,
    targets: 80, catches: 60, drops: 4, contested: 10, contested_catches: 6,
    has_charted_open_data: true,
    coverage_stats: { man: cvg(110, 67), press: cvg(36, 17), zone: cvg(196, 137), double: cvg(10, 4) },
    lined_up: null,
    ...extra,
  }) as ProspectWithStats;

const PFF = {
  pff_g: 9, pff_routes: 348, pff_tgt: 84, pff_rec: 61, pff_drops: 3, pff_catchable: 64,
  pff_recyds: 943, pff_yprr: 2.71, pff_radot: 12.8, pff_ctgt: 16, pff_crec: 9,
  pff_wide_pct: 61, pff_slot_pct: 39, pff_align_n: 400,
};

describe("percentileRanks", () => {
  const pageWith = (v: number | null, n = 100, dir: 1 | -1 = 1): OverviewPage => ({
    meta: [], columns: [],
    main: [{ key: "s", title: "S", size: "lg", stats: [{ key: "x", label: "X", value: v, fmt: "pct0", tone: "chart", dir, n, minN: 20, tooltip: "" }] }],
  });

  it("ranks each prospect against the rest, best 99 and worst 1", () => {
    const pages = new Map<string, OverviewPage>(Array.from({ length: 10 }, (_, i) => [`p${i + 1}`, pageWith(i + 1)] as const));
    const r = percentileRanks(pages).get("x")!;
    expect(r.get("p10")).toBe(99);
    expect(r.get("p1")).toBe(1);
    expect(r.get("p5")).toBe(44); // better than 4 of the other 9
  });

  it("flips for lower-is-better and splits ties", () => {
    const pages = new Map<string, OverviewPage>(Array.from({ length: 10 }, (_, i) => [`p${i}`, pageWith(i < 2 ? 0 : i, 100, -1)] as const));
    const r = percentileRanks(pages).get("x")!;
    expect(r.get("p9")).toBe(1); // highest value is worst
    // p0 and p1 tie for best: each beats the other 8 and splits the tie.
    expect(r.get("p0")).toBe(Math.round((8 + 0.5) / 9 * 100));
  });

  it("leaves out thin samples, and ranks nothing until the pool is big enough", () => {
    const pages = new Map<string, OverviewPage>(Array.from({ length: PERCENTILE_MIN_POOL }, (_, i) => [`p${i}`, pageWith(i, i === 0 ? 5 : 100)] as const));
    expect(percentileRanks(pages).has("x")).toBe(false); // one is under minN → 9 qualify
    pages.set("extra", pageWith(50));
    expect(percentileRanks(pages).get("x")!.has("p0")).toBe(false);
  });
});

describe("ordinal", () => {
  it("writes English ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 99].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "99th"]);
  });
});

describe("pffSource", () => {
  it("names the games PFF covers", () => {
    expect(pffSource({ games: 9, charted: 9 })).toBe("PFF, over the 9 charted games");
    expect(pffSource({ games: 7, charted: 9 })).toContain("7 of his 9 charted games");
  });
});

describe("wrOverview", () => {
  it("folds press into man and takes the open rates from the charting", () => {
    const page = wrOverview(wr("a"), PFF, { games: 9, charted: 9 });
    expect(stat(page, "cv_man")).toMatchObject({ value: (84 / 146) * 100, detail: "84 / 146", note: "(incl. press)" });
    expect(stat(page, "cv_press")).toMatchObject({ detail: "17 / 36" });
  });

  it("takes target data from PFF, matching PFF's own numbers", () => {
    const page = wrOverview(wr("a"), PFF, { games: 9, charted: 9 });
    expect(stat(page, "tprr")).toMatchObject({ value: (84 / 348) * 100, detail: "84 / 348", tone: "pff" });
    expect(stat(page, "drop")).toMatchObject({ dir: -1, detail: "3 / 64 catchable" });
    expect(stat(page, "yprr")).toMatchObject({ value: 2.71, detail: "943 yds / 348" });
    expect(stat(page, "cc")).toMatchObject({ detail: "9 / 16", tone: "pff" });
  });

  it("falls back to the charted counts without PFF, and drops what only PFF has", () => {
    const page = wrOverview(wr("a"), {}, null);
    expect(stat(page, "tprr")).toMatchObject({ value: (80 / 352) * 100, tone: "chart" });
    expect(stat(page, "tprr")!.tooltip).toContain("no PFF stats");
    expect(stat(page, "yprr")).toBeUndefined();
    expect(stat(page, "cc")).toMatchObject({ detail: "6 / 10", tone: "chart" });
  });

  it("reads alignment from the in-app charting, else PFF's wide / slot split", () => {
    const lined_up = { snaps: 486, slot_on: 4, slot_off: 186, left_on: 120, left_off: 65, right_on: 90, right_off: 12, backfield: 9 };
    const inApp = wrOverview(wr("a", { lined_up }), PFF, null);
    expect(stat(inApp, "al_left")).toMatchObject({ detail: "185 / 486" });
    expect(stat(inApp, "dp_on")).toMatchObject({ detail: "214 / 486" });
    expect(stat(inApp, "dp_off")).toMatchObject({ detail: "272 / 486" });

    const imported = wrOverview(wr("a"), PFF, null);
    expect(stat(imported, "al_wide")).toMatchObject({ value: 61, tone: "pff" });
    expect(section(imported, "depth")).toBeUndefined();
  });

  it("shows no open rates without open data charted", () => {
    expect(stat(wrOverview(wr("a", { has_charted_open_data: false }), PFF, null), "cv_zone")!.value).toBeNull();
  });
});

describe("qbOverview", () => {
  const throwPlay = (accuracy: QBPlay["accuracy"], extra: Partial<QBPlay> = {}) =>
    ({ play_type: "pass", timing: "first_option", accuracy, depth_zone: "short_left", coverage: "man", pressure: "clean", platform: "on_platform", ...extra }) as QBPlay;
  const plays = [
    throwPlay("on_target"),
    throwPlay("high", { depth_zone: "deep_center", coverage: "zone", pressure: "mid" }),
    throwPlay("on_target", { depth_zone: "mid_right", platform: "on_the_run" }),
    throwPlay("tipped_ball"),
    throwPlay(null),
    throwPlay("on_target", { timing: "scramble" }),
    { play_type: "run", run_success: true } as QBPlay,
    { play_type: "run", run_success: false } as QBPlay,
  ];

  it("grades thrown balls with accuracy charted, tipped left out", () => {
    const page = qbOverview(plays, {}, null, 2);
    expect(stat(page, "ot_all")).toMatchObject({ detail: "2 / 3" });
    expect(stat(page, "ot_deep")).toMatchObject({ detail: "0 / 1" });
    expect(stat(page, "ot_pressured")).toMatchObject({ detail: "0 / 1" });
    expect(stat(page, "pl_run")).toMatchObject({ detail: "on target · 1 / 1" });
    expect(stat(page, "run_succ")).toMatchObject({ detail: "1 / 2 tagged runs" });
    expect(page.meta).toEqual(["2 games", "8 plays", "3 graded throws"]);
  });

  it("adds the PFF passing numbers only when there are some", () => {
    expect(section(qbOverview(plays, {}, null, 2), "passing")).toBeUndefined();
    const page = qbOverview(plays, { pff_g: 2, pff_twp: 2, pff_all_db: 80, pff_sk: 3, pff_prf: 20 }, null, 2);
    expect(stat(page, "twp")).toMatchObject({ dir: -1, detail: "2 / 80 dropbacks" });
    expect(stat(page, "p2s")).toMatchObject({ detail: "3 / 20 pressures" });
  });
});

describe("rbOverview", () => {
  const run = (run_type: RBPlay["run_type"], success: boolean, extra: Partial<RBPlay> = {}) =>
    ({ run_type, success, formation: "gun", explosive_play: false, broken_tackle: false, run_stuff: false, loaded_box: false, ...extra }) as RBPlay;
  const plays = [
    run("inside_zone", true), run("inside_zone", false, { run_stuff: true }), run("outside_man_gap", true, { explosive_play: true }),
    run("pass_block", true), run("pass_block", false),
    { run_type: "route", was_open: true, targeted: true } as RBPlay,
  ];

  it("counts only designed carries as runs", () => {
    const page = rbOverview(plays, {}, null, 1);
    expect(stat(page, "sr_iz")).toMatchObject({ detail: "1 / 2" });
    expect(stat(page, "sr_all")).toMatchObject({ detail: "2 / 3" });
    expect(stat(page, "stuffed")).toMatchObject({ dir: -1, detail: "1 / 3" });
    expect(stat(page, "pb_won")).toMatchObject({ detail: "1 / 2" });
    expect(stat(page, "rb_open")).toMatchObject({ detail: "1 / 1 routes" });
    expect(page.meta).toEqual(["1 game", "6 snaps", "3 carries"]);
  });
});

describe("teOverview", () => {
  const route = (coverage: TEPlay["coverage"], was_open: boolean) => ({ play_type: "route_run", coverage, was_open, positioning: "slot" }) as TEPlay;
  const block = (play_type: TEPlay["play_type"], block_type: TEPlay["block_type"], block_success: boolean) =>
    ({ play_type, block_type, block_success, positioning: "inline" }) as TEPlay;

  it("folds press into man and splits block wins by kind", () => {
    const plays = [route("man", true), route("press", false), route("zone", true), block("run_block", "inline", true), block("pass_block", "movement", false)];
    const page = teOverview(plays, {}, null, 1);
    expect(stat(page, "te_man")).toMatchObject({ detail: "1 / 2" });
    expect(stat(page, "bk_run")).toMatchObject({ detail: "1 / 1" });
    expect(stat(page, "bk_move")).toMatchObject({ detail: "0 / 1" });
    expect(stat(page, "te_inline")).toMatchObject({ detail: "2 / 5" });
  });
});

describe("overviewPagesFor", () => {
  it("builds the page of everyone at the prospect's position, and nothing for an unknown id", () => {
    const prospects = [wr("a"), wr("b"), { ...wr("q"), position: "QB" } as ProspectWithStats];
    const base = { prospects, games: [] as ScoutingGame[], qbPlays: [], rbPlays: [], tePlays: [], pffVals: new Map(), pffGames: new Map() };
    expect([...overviewPagesFor({ ...base, prospectId: "a" }).keys()]).toEqual(["a", "b"]);
    expect(overviewPagesFor({ ...base, prospectId: "zzz" }).size).toBe(0);
  });
});
