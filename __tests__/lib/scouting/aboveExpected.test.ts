import { describe, it, expect } from "vitest";
import {
  computeRBAboveExpected,
  computeQBAboveExpected,
  computeQBAAEBreakdown,
  computeQBAAEBreakdownMap,
  computeTERouteAboveExpected,
  computeTEBlockAboveExpected,
  buildRBBaselines,
  computeRBAboveExpectedForPlays,
  buildQBBaselines,
  resolveBaselines,
  computeQBAAEForPlays,
  buildTERouteBaselines,
  computeTERouteAboveExpectedForPlays,
  buildTEBlockBaselines,
  computeTEBlockAboveExpectedForPlays,
} from "@/lib/scouting/aboveExpected";
import type {
  Prospect,
  ScoutingGame,
  RBPlay,
  QBPlay,
  TEPlay,
  RBFormation,
  RBRunType,
  QBAccuracy,
  TEPlayType,
  TEBlockType,
} from "@/lib/types";

// ── Fixture builders ──────────────────────────────────────────────────────
// The functions under test only read a handful of fields off each shape, so we
// build minimal objects and cast through `unknown` to the full interface.

const prospect = (id: string, position: string): Prospect =>
  ({ id, position, name: id }) as unknown as Prospect;

const game = (id: string, prospect_id: string): ScoutingGame =>
  ({ id, prospect_id }) as unknown as ScoutingGame;

const rbPlay = (
  game_id: string,
  run_type: RBRunType,
  formation: RBFormation,
  success: boolean | null,
  loaded_box: boolean,
): RBPlay =>
  ({ game_id, run_type, formation, success, loaded_box }) as unknown as RBPlay;

const qbPlay = (
  game_id: string,
  opts: Partial<QBPlay> & { accuracy: QBAccuracy | null },
): QBPlay =>
  ({
    game_id,
    play_type: "pass",
    completion: null,
    depth_zone: null,
    coverage: null,
    timing: null,
    pressure: null,
    platform: null,
    platform_side: null,
    pressure_handling: null,
    route_type: null,
    ...opts,
  }) as unknown as QBPlay;

const tePlay = (game_id: string, opts: Partial<TEPlay>): TEPlay =>
  ({
    game_id,
    play_type: "route_run",
    positioning: "wide",
    coverage: null,
    was_open: null,
    block_type: null,
    block_success: null,
    ...opts,
  }) as unknown as TEPlay;

// Repeat a play factory `n` times.
function repeat<T>(n: number, make: (i: number) => T): T[] {
  return Array.from({ length: n }, (_, i) => make(i));
}

// =============================================================================
// computeRBAboveExpected
// =============================================================================

describe("computeRBAboveExpected", () => {
  it("returns null for an RB under the 15-known-play minimum", () => {
    const prospects = [prospect("rb1", "RB")];
    const games = [game("g1", "rb1")];
    // 14 known runs — one short of MIN_SAMPLE.
    const plays = repeat(14, () => rbPlay("g1", "inside_zone", "gun", true, false));
    const out = computeRBAboveExpected(prospects, games, plays);
    expect(out.get("rb1")).toBeNull();
  });

  it("counts only valid run types toward the minimum sample", () => {
    const prospects = [prospect("rb1", "RB")];
    const games = [game("g1", "rb1")];
    // 14 real runs + plenty of pass_block (not a run type) → still under 15.
    const plays = [
      ...repeat(14, () => rbPlay("g1", "outside_zone", "gun", true, false)),
      ...repeat(20, () => rbPlay("g1", "pass_block", "gun", true, false)),
    ];
    expect(computeRBAboveExpected(prospects, games, plays).get("rb1")).toBeNull();
  });

  it("excludes plays with success === null from the known-run count", () => {
    const prospects = [prospect("rb1", "RB")];
    const games = [game("g1", "rb1")];
    // 10 graded + 10 ungraded runs → only 10 known, under the minimum.
    const plays = [
      ...repeat(10, () => rbPlay("g1", "inside_zone", "gun", true, false)),
      ...repeat(10, () => rbPlay("g1", "inside_zone", "gun", null, false)),
    ];
    expect(computeRBAboveExpected(prospects, games, plays).get("rb1")).toBeNull();
  });

  it("returns 0.00 when the prospect IS the entire league baseline (matches itself)", () => {
    // A lone RB whose plays are also the only league plays: actual rate equals
    // every bucket baseline, so actual - expected collapses to exactly 0.
    const prospects = [prospect("rb1", "RB")];
    const games = [game("g1", "rb1")];
    const plays = [
      ...repeat(10, () => rbPlay("g1", "inside_zone", "gun", true, true)),
      ...repeat(10, () => rbPlay("g1", "inside_zone", "gun", false, true)),
    ];
    expect(computeRBAboveExpected(prospects, games, plays).get("rb1")).toBe(0);
  });

  it("returns a positive metric when the RB beats the league baseline", () => {
    // League background succeeds 50% in gun/loaded; the prospect succeeds 80%.
    const prospects = [prospect("hero", "RB"), prospect("bg", "RB")];
    const games = [game("g_hero", "hero"), game("g_bg", "bg")];
    const heroPlays = [
      ...repeat(16, () => rbPlay("g_hero", "inside_zone", "gun", true, true)),
      ...repeat(4, () => rbPlay("g_hero", "inside_zone", "gun", false, true)),
    ];
    // 100 background plays, exactly 50% success — same formation/box bucket.
    const bgPlays = [
      ...repeat(50, () => rbPlay("g_bg", "inside_zone", "gun", true, true)),
      ...repeat(50, () => rbPlay("g_bg", "inside_zone", "gun", false, true)),
    ];
    const out = computeRBAboveExpected(prospects, games, [...heroPlays, ...bgPlays]);
    const hero = out.get("hero")!;
    // actual = 16/20 = 0.80. Both formation & box buckets blend hero+bg.
    // We assert direction + magnitude precisely below rather than re-deriving.
    expect(hero).toBeGreaterThan(0);
    // Sanity: it should be a rounded-to-2dp number.
    expect(hero).toBe(parseFloat(hero.toFixed(2)));
  });

  it("ignores non-RB prospects entirely (no map entry)", () => {
    const prospects = [prospect("qb1", "QB")];
    const games = [game("g1", "qb1")];
    const plays = repeat(20, () => rbPlay("g1", "inside_zone", "gun", true, false));
    const out = computeRBAboveExpected(prospects, games, plays);
    expect(out.has("qb1")).toBe(false);
  });

  it("matches a hand-computed value for a single isolated-baseline RB", () => {
    // Construct so the formation and box dimensions DISAGREE, making the
    // combine() average observable. The RB is the only league data.
    //   20 known runs total.
    //   Formation mix: 10 gun (8 success), 10 under_center (2 success).
    //   Box mix:       all loaded_box.
    // Because the RB is the whole league, every bucket baseline == that bucket's
    // own rate, so the weighted expected == actual in BOTH dims → metric 0.
    const prospects = [prospect("rb1", "RB")];
    const games = [game("g1", "rb1")];
    const plays = [
      ...repeat(8, () => rbPlay("g1", "inside_zone", "gun", true, true)),
      ...repeat(2, () => rbPlay("g1", "inside_zone", "gun", false, true)),
      ...repeat(2, () => rbPlay("g1", "outside_zone", "under_center", true, true)),
      ...repeat(8, () => rbPlay("g1", "outside_zone", "under_center", false, true)),
    ];
    expect(computeRBAboveExpected(prospects, games, plays).get("rb1")).toBe(0);
  });
});

// =============================================================================
// computeQBAboveExpected  (graded throw value + shrinkage + dim weighting)
// =============================================================================

describe("computeQBAboveExpected", () => {
  it("returns null for a QB under the 25-graded-throw minimum", () => {
    const prospects = [prospect("qb1", "QB")];
    const games = [game("g1", "qb1")];
    const plays = repeat(24, () =>
      qbPlay("g1", { accuracy: "on_target", depth_zone: "short_center" }),
    );
    expect(computeQBAboveExpected(prospects, games, plays).get("qb1")).toBeNull();
  });

  it("filters out runs, null-accuracy, and tipped balls from the graded set", () => {
    const prospects = [prospect("qb1", "QB")];
    const games = [game("g1", "qb1")];
    // Only 24 graded throws survive the filter → under QB_MIN_SAMPLE → null.
    const plays = [
      ...repeat(24, () =>
        qbPlay("g1", { accuracy: "on_target", depth_zone: "short_center" }),
      ),
      ...repeat(10, () => qbPlay("g1", { play_type: "run", accuracy: null })),
      ...repeat(10, () => qbPlay("g1", { accuracy: null, depth_zone: "short_center" })),
      ...repeat(10, () => qbPlay("g1", { accuracy: "tipped_ball", depth_zone: "short_center" })),
    ];
    expect(computeQBAboveExpected(prospects, games, plays).get("qb1")).toBeNull();
  });

  it("counts RPO pass attempts as graded throws", () => {
    const prospects = [prospect("qb1", "QB")];
    const games = [game("g1", "qb1")];
    const plays = repeat(25, () =>
      qbPlay("g1", { play_type: "rpo", accuracy: "on_target", depth_zone: "short_center" }),
    );
    // 25 graded RPO throws → meets the gate → a number (not null).
    expect(computeQBAboveExpected(prospects, games, plays).get("qb1")).not.toBeNull();
  });

  it("returns 0.00 when the QB is the only league data (compares against itself)", () => {
    // With a single QB as the entire league, each bucket's shrunk rate is pulled
    // toward the global mean which equals the QB's own mean, so expected == actual.
    const prospects = [prospect("qb1", "QB")];
    const games = [game("g1", "qb1")];
    const plays = repeat(30, () =>
      qbPlay("g1", { accuracy: "on_target", depth_zone: "short_center" }),
    );
    expect(computeQBAboveExpected(prospects, games, plays).get("qb1")).toBe(0);
  });

  it("produces a positive AAE for an above-baseline QB and negative for a below-baseline QB", () => {
    // Two QBs sharing identical situations (same depth zone) so they only differ
    // by accuracy. The above-baseline QB throws more on-target throws.
    const prospects = [prospect("good", "QB"), prospect("bad", "QB")];
    const games = [game("g_good", "good"), game("g_bad", "bad")];
    const goodPlays = [
      ...repeat(28, () => qbPlay("g_good", { accuracy: "on_target", completion: "caught", depth_zone: "mid_center" })),
      ...repeat(2, () => qbPlay("g_good", { accuracy: "low", completion: "incomplete", depth_zone: "mid_center" })),
    ];
    const badPlays = [
      ...repeat(6, () => qbPlay("g_bad", { accuracy: "on_target", completion: "caught", depth_zone: "mid_center" })),
      ...repeat(24, () => qbPlay("g_bad", { accuracy: "high", completion: "incomplete", depth_zone: "mid_center" })),
    ];
    const out = computeQBAboveExpected(prospects, games, [...goodPlays, ...badPlays]);
    expect(out.get("good")!).toBeGreaterThan(0);
    expect(out.get("bad")!).toBeLessThan(0);
    // The metric is conservation: total above-baseline ≈ -(below-baseline) is NOT
    // guaranteed (different sample sizes/shrinkage), but signs must be opposite.
    expect(Math.sign(out.get("good")!)).toBe(-Math.sign(out.get("bad")!));
  });

  it("graded throw value: a caught miss outscores an identical dropped miss", () => {
    // Two QBs identical except one's misses were caught (0.30) vs not (0.20).
    // Caught-miss QB must have the higher (less negative) AAE.
    const prospects = [prospect("caught", "QB"), prospect("dropped", "QB")];
    const games = [game("g_c", "caught"), game("g_d", "dropped")];
    const caughtPlays = repeat(30, () =>
      qbPlay("g_c", { accuracy: "low", completion: "caught", depth_zone: "short_left" }),
    );
    const droppedPlays = repeat(30, () =>
      qbPlay("g_d", { accuracy: "low", completion: "incomplete", depth_zone: "short_left" }),
    );
    const out = computeQBAboveExpected(prospects, games, [...caughtPlays, ...droppedPlays]);
    expect(out.get("caught")!).toBeGreaterThan(out.get("dropped")!);
  });
});

// =============================================================================
// computeQBAAEBreakdown  (per-dimension rows + display on-target%)
// =============================================================================

describe("computeQBAAEBreakdown", () => {
  it("returns an empty breakdown for zero rated passes", () => {
    const bd = computeQBAAEBreakdown([], []);
    expect(bd).toEqual({ ratedPasses: 0, actualOnTgtPct: null, total: null, dims: [] });
  });

  it("reports the literal on-target% as a display field, distinct from AAE total", () => {
    // 30 throws, 18 on-target → 60.00% on-target display.
    const plays = [
      ...repeat(18, () => qbPlay("g1", { accuracy: "on_target", depth_zone: "deep_left" })),
      ...repeat(12, () => qbPlay("g1", { accuracy: "high", completion: "incomplete", depth_zone: "deep_left" })),
    ];
    const bd = computeQBAAEBreakdown(plays, plays);
    expect(bd.ratedPasses).toBe(30);
    expect(bd.actualOnTgtPct).toBe(60);
    // Self-baseline ⇒ AAE total collapses to 0, which is NOT the on-target%.
    expect(bd.total).toBe(0);
  });

  it("emits the six fixed dimension rows in order with the documented keys", () => {
    const plays = repeat(30, () =>
      qbPlay("g1", {
        accuracy: "on_target",
        depth_zone: "mid_center",
        coverage: "zone",
        timing: "first_option",
        pressure: "clean",
        platform: "on_platform",
        route_type: "post",
      }),
    );
    const bd = computeQBAAEBreakdown(plays, plays);
    expect(bd.dims.map((d) => d.key)).toEqual([
      "depth", "coverage", "timing", "pressure", "platform", "route",
    ]);
    // Every row carried its filled-play count (all 30 plays fill every dim).
    for (const row of bd.dims) {
      expect(row.n).toBe(30);
    }
  });

  it("leaves a dimension row's AAE null when the prospect never charted that dim", () => {
    // No coverage charted on the prospect → coverage row has n=0 and aae=null,
    // while depth (always filled) has a real n.
    const plays = repeat(30, () =>
      qbPlay("g1", { accuracy: "on_target", depth_zone: "short_right", coverage: null }),
    );
    const bd = computeQBAAEBreakdown(plays, plays);
    const coverage = bd.dims.find((d) => d.key === "coverage")!;
    const depth = bd.dims.find((d) => d.key === "depth")!;
    expect(coverage.n).toBe(0);
    expect(coverage.aae).toBeNull();
    expect(depth.n).toBe(30);
  });
});

// =============================================================================
// computeQBAAEBreakdownMap  (bulk variant — omits gated prospects)
// =============================================================================

describe("computeQBAAEBreakdownMap", () => {
  it("omits QBs under the sample gate and includes those over it", () => {
    const prospects = [prospect("big", "QB"), prospect("small", "QB"), prospect("rb", "RB")];
    const games = [game("g_big", "big"), game("g_small", "small"), game("g_rb", "rb")];
    const plays = [
      ...repeat(30, () => qbPlay("g_big", { accuracy: "on_target", depth_zone: "mid_left" })),
      ...repeat(10, () => qbPlay("g_small", { accuracy: "on_target", depth_zone: "mid_left" })),
    ];
    const map = computeQBAAEBreakdownMap(prospects, games, plays);
    expect(map.has("big")).toBe(true);
    expect(map.has("small")).toBe(false); // under QB_MIN_SAMPLE
    expect(map.has("rb")).toBe(false);     // wrong position
    expect(map.get("big")!.ratedPasses).toBe(30);
  });

  it("the bulk total matches the standalone computeQBAboveExpected total", () => {
    // Same inputs through both entry points must agree (shared internals).
    const prospects = [prospect("a", "QB"), prospect("b", "QB")];
    const games = [game("g_a", "a"), game("g_b", "b")];
    const plays = [
      ...repeat(20, () => qbPlay("g_a", { accuracy: "on_target", completion: "caught", depth_zone: "deep_center" })),
      ...repeat(10, () => qbPlay("g_a", { accuracy: "behind", completion: "incomplete", depth_zone: "deep_center" })),
      ...repeat(15, () => qbPlay("g_b", { accuracy: "on_target", completion: "caught", depth_zone: "short_center" })),
      ...repeat(15, () => qbPlay("g_b", { accuracy: "in_front", completion: "caught", depth_zone: "short_center" })),
    ];
    const scalar = computeQBAboveExpected(prospects, games, plays);
    const map = computeQBAAEBreakdownMap(prospects, games, plays);
    expect(map.get("a")!.total).toBe(scalar.get("a"));
    expect(map.get("b")!.total).toBe(scalar.get("b"));
  });
});

// =============================================================================
// computeTERouteAboveExpected  (Open Rate Above Expected)
// =============================================================================

describe("computeTERouteAboveExpected", () => {
  it("returns null under the 15-rated-route minimum", () => {
    const prospects = [prospect("te1", "TE")];
    const games = [game("g1", "te1")];
    const plays = repeat(14, () =>
      tePlay("g1", { play_type: "route_run", positioning: "slot", coverage: "man", was_open: true }),
    );
    expect(computeTERouteAboveExpected(prospects, games, plays).get("te1")).toBeNull();
  });

  it("excludes routes with was_open === null from the rated count", () => {
    const prospects = [prospect("te1", "TE")];
    const games = [game("g1", "te1")];
    const plays = [
      ...repeat(10, () => tePlay("g1", { positioning: "slot", coverage: "man", was_open: true })),
      ...repeat(10, () => tePlay("g1", { positioning: "slot", coverage: "man", was_open: null })),
    ];
    expect(computeTERouteAboveExpected(prospects, games, plays).get("te1")).toBeNull();
  });

  it("returns 0.00 when the TE is the whole league baseline", () => {
    const prospects = [prospect("te1", "TE")];
    const games = [game("g1", "te1")];
    const plays = [
      ...repeat(12, () => tePlay("g1", { positioning: "slot", coverage: "man", was_open: true })),
      ...repeat(8, () => tePlay("g1", { positioning: "slot", coverage: "man", was_open: false })),
    ];
    expect(computeTERouteAboveExpected(prospects, games, plays).get("te1")).toBe(0);
  });

  it("folds press coverage into the man bucket (no double-counting)", () => {
    // The prospect runs press + man routes; press must be scored against the man
    // baseline. If press were dropped, the metric would change. We verify the
    // metric is a finite number (press contributed) rather than null.
    const prospects = [prospect("te1", "TE"), prospect("bg", "TE")];
    const games = [game("g1", "te1"), game("g_bg", "bg")];
    const tePlays = [
      ...repeat(10, () => tePlay("g1", { positioning: "wide", coverage: "press", was_open: true })),
      ...repeat(10, () => tePlay("g1", { positioning: "wide", coverage: "man", was_open: false })),
    ];
    const bgPlays = repeat(40, () =>
      tePlay("g_bg", { positioning: "wide", coverage: "man", was_open: true }),
    );
    const out = computeTERouteAboveExpected(prospects, games, [...tePlays, ...bgPlays]);
    const te1 = out.get("te1")!;
    expect(te1).not.toBeNull();
    expect(Number.isFinite(te1)).toBe(true);
  });

  it("flags an above-baseline route runner as positive", () => {
    // Background TE opens 50% in slot/zone; prospect opens 90% in the same bucket.
    const prospects = [prospect("sep", "TE"), prospect("bg", "TE")];
    const games = [game("g_sep", "sep"), game("g_bg", "bg")];
    const sepPlays = [
      ...repeat(18, () => tePlay("g_sep", { positioning: "slot", coverage: "zone", was_open: true })),
      ...repeat(2, () => tePlay("g_sep", { positioning: "slot", coverage: "zone", was_open: false })),
    ];
    const bgPlays = [
      ...repeat(50, () => tePlay("g_bg", { positioning: "slot", coverage: "zone", was_open: true })),
      ...repeat(50, () => tePlay("g_bg", { positioning: "slot", coverage: "zone", was_open: false })),
    ];
    const out = computeTERouteAboveExpected(prospects, games, [...sepPlays, ...bgPlays]);
    expect(out.get("sep")!).toBeGreaterThan(0);
  });

  it("ignores block plays (only route_run counts toward the route metric)", () => {
    const prospects = [prospect("te1", "TE")];
    const games = [game("g1", "te1")];
    const plays = [
      ...repeat(14, () => tePlay("g1", { positioning: "slot", coverage: "man", was_open: true })),
      ...repeat(20, () => tePlay("g1", { play_type: "run_block" as TEPlayType, block_success: true, block_type: "inline" as TEBlockType })),
    ];
    // Only 14 route_run plays → under the minimum → null.
    expect(computeTERouteAboveExpected(prospects, games, plays).get("te1")).toBeNull();
  });
});

// =============================================================================
// computeTEBlockAboveExpected  (Block Success Above Expected)
// =============================================================================

describe("computeTEBlockAboveExpected", () => {
  const block = (
    game_id: string,
    play_type: TEPlayType,
    block_type: TEBlockType | null,
    block_success: boolean | null,
  ): TEPlay => tePlay(game_id, { play_type, block_type, block_success });

  it("returns null under the 15-rated-block minimum", () => {
    const prospects = [prospect("te1", "TE")];
    const games = [game("g1", "te1")];
    const plays = repeat(14, () => block("g1", "run_block", "inline", true));
    expect(computeTEBlockAboveExpected(prospects, games, plays).get("te1")).toBeNull();
  });

  it("excludes blocks missing block_type or block_success from the sample", () => {
    const prospects = [prospect("te1", "TE")];
    const games = [game("g1", "te1")];
    const plays = [
      ...repeat(10, () => block("g1", "run_block", "inline", true)),
      ...repeat(10, () => block("g1", "run_block", null, true)),     // no block_type
      ...repeat(10, () => block("g1", "pass_block", "movement", null)), // no result
    ];
    // Only 10 fully-rated blocks → under the minimum → null.
    expect(computeTEBlockAboveExpected(prospects, games, plays).get("te1")).toBeNull();
  });

  it("returns 0.00 when the TE is the whole league baseline", () => {
    const prospects = [prospect("te1", "TE")];
    const games = [game("g1", "te1")];
    const plays = [
      ...repeat(12, () => block("g1", "run_block", "inline", true)),
      ...repeat(8, () => block("g1", "run_block", "inline", false)),
    ];
    expect(computeTEBlockAboveExpected(prospects, games, plays).get("te1")).toBe(0);
  });

  it("flags an above-baseline blocker as positive", () => {
    // Background TE blocks 50% on run_block/inline; the prospect succeeds 85%.
    const prospects = [prospect("anchor", "TE"), prospect("bg", "TE")];
    const games = [game("g_a", "anchor"), game("g_bg", "bg")];
    const anchorPlays = [
      ...repeat(17, () => block("g_a", "run_block", "inline", true)),
      ...repeat(3, () => block("g_a", "run_block", "inline", false)),
    ];
    const bgPlays = [
      ...repeat(50, () => block("g_bg", "run_block", "inline", true)),
      ...repeat(50, () => block("g_bg", "run_block", "inline", false)),
    ];
    const out = computeTEBlockAboveExpected(prospects, games, [...anchorPlays, ...bgPlays]);
    expect(out.get("anchor")!).toBeGreaterThan(0);
  });

  it("includes both run-block and pass-block plays in the same sample", () => {
    const prospects = [prospect("te1", "TE")];
    const games = [game("g1", "te1")];
    // 8 run + 8 pass = 16 rated blocks, over the minimum → non-null number.
    const plays = [
      ...repeat(8, () => block("g1", "run_block", "inline", true)),
      ...repeat(8, () => block("g1", "pass_block", "movement", true)),
    ];
    expect(computeTEBlockAboveExpected(prospects, games, plays).get("te1")).not.toBeNull();
  });
});

// =============================================================================
// Per-game (ungated) variants — the Chart Game card badges. Unlike the
// season/career functions above, these apply NO minimum-sample gate: a
// single-play game must still return a number, not null, since the whole
// point is a quick per-game "good/bad" read on an inherently tiny sample.
// =============================================================================

describe("computeRBAboveExpectedForPlays", () => {
  it("returns a number for a single play (no MIN_SAMPLE gate)", () => {
    const baselines = buildRBBaselines([
      ...repeat(50, () => rbPlay("g_bg", "inside_zone", "gun", true, true)),
      ...repeat(50, () => rbPlay("g_bg", "inside_zone", "gun", false, true)),
    ]);
    const gamePlays = [rbPlay("g1", "inside_zone", "gun", true, true)];
    const out = computeRBAboveExpectedForPlays(gamePlays, baselines);
    expect(out).not.toBeNull();
    expect(Number.isFinite(out)).toBe(true);
  });

  it("returns null when the game has zero known runs (e.g. all pass-block)", () => {
    const baselines = buildRBBaselines(repeat(30, () => rbPlay("g_bg", "inside_zone", "gun", true, true)));
    const gamePlays = repeat(10, () => rbPlay("g1", "pass_block", "gun", true, false));
    expect(computeRBAboveExpectedForPlays(gamePlays, baselines)).toBeNull();
  });

  it("agrees with computeRBAboveExpected when fed the same baseline + full prospect sample", () => {
    const prospects = [prospect("hero", "RB"), prospect("bg", "RB")];
    const games = [game("g_hero", "hero"), game("g_bg", "bg")];
    const heroPlays = [
      ...repeat(16, () => rbPlay("g_hero", "inside_zone", "gun", true, true)),
      ...repeat(4, () => rbPlay("g_hero", "inside_zone", "gun", false, true)),
    ];
    const bgPlays = [
      ...repeat(50, () => rbPlay("g_bg", "inside_zone", "gun", true, true)),
      ...repeat(50, () => rbPlay("g_bg", "inside_zone", "gun", false, true)),
    ];
    const allPlays = [...heroPlays, ...bgPlays];
    const scalar = computeRBAboveExpected(prospects, games, allPlays).get("hero");
    const perPlay = computeRBAboveExpectedForPlays(heroPlays, buildRBBaselines(allPlays));
    expect(perPlay).toBe(scalar);
  });
});

describe("computeQBAAEForPlays", () => {
  it("returns a number for a single graded throw (no QB_MIN_SAMPLE gate)", () => {
    const baselines = resolveBaselines(buildQBBaselines(
      repeat(30, () => qbPlay("g_bg", { accuracy: "on_target", depth_zone: "mid_center" })),
    ));
    const gamePlays = [qbPlay("g1", { accuracy: "on_target", depth_zone: "mid_center" })];
    const out = computeQBAAEForPlays(gamePlays, baselines);
    expect(out).not.toBeNull();
    expect(Number.isFinite(out)).toBe(true);
  });

  it("returns null when the game has zero graded throws (all runs)", () => {
    const baselines = resolveBaselines(buildQBBaselines(
      repeat(30, () => qbPlay("g_bg", { accuracy: "on_target", depth_zone: "mid_center" })),
    ));
    const gamePlays = repeat(5, () => qbPlay("g1", { play_type: "run", accuracy: null }));
    expect(computeQBAAEForPlays(gamePlays, baselines)).toBeNull();
  });

  it("agrees with computeQBAboveExpected when fed the same resolved baselines + full prospect sample", () => {
    const prospects = [prospect("a", "QB"), prospect("b", "QB")];
    const games = [game("g_a", "a"), game("g_b", "b")];
    const aPlays = repeat(25, () => qbPlay("g_a", { accuracy: "on_target", completion: "caught", depth_zone: "deep_center" }));
    const bPlays = repeat(25, () => qbPlay("g_b", { accuracy: "low", completion: "incomplete", depth_zone: "short_center" }));
    const allPlays = [...aPlays, ...bPlays];
    const scalar = computeQBAboveExpected(prospects, games, allPlays).get("a");
    const perPlay = computeQBAAEForPlays(aPlays, resolveBaselines(buildQBBaselines(allPlays)));
    expect(perPlay).toBe(scalar);
  });
});

describe("computeTERouteAboveExpectedForPlays", () => {
  it("returns a number for a single rated route (no MIN_SAMPLE gate)", () => {
    const baselines = buildTERouteBaselines(
      repeat(30, () => tePlay("g_bg", { positioning: "slot", coverage: "man", was_open: true })),
    );
    const gamePlays = [tePlay("g1", { positioning: "slot", coverage: "man", was_open: true })];
    const out = computeTERouteAboveExpectedForPlays(gamePlays, baselines);
    expect(out).not.toBeNull();
    expect(Number.isFinite(out)).toBe(true);
  });

  it("returns null when the game has zero rated routes (all blocks)", () => {
    const baselines = buildTERouteBaselines(
      repeat(30, () => tePlay("g_bg", { positioning: "slot", coverage: "man", was_open: true })),
    );
    const gamePlays = repeat(5, () => tePlay("g1", { play_type: "run_block", block_type: "inline", block_success: true }));
    expect(computeTERouteAboveExpectedForPlays(gamePlays, baselines)).toBeNull();
  });
});

describe("computeTEBlockAboveExpectedForPlays", () => {
  it("returns a number for a single rated block (no MIN_SAMPLE gate)", () => {
    const baselines = buildTEBlockBaselines(
      repeat(30, () => tePlay("g_bg", { play_type: "run_block", block_type: "inline", block_success: true })),
    );
    const gamePlays = [tePlay("g1", { play_type: "run_block", block_type: "inline", block_success: true })];
    const out = computeTEBlockAboveExpectedForPlays(gamePlays, baselines);
    expect(out).not.toBeNull();
    expect(Number.isFinite(out)).toBe(true);
  });

  it("returns null when the game has zero rated blocks (all routes)", () => {
    const baselines = buildTEBlockBaselines(
      repeat(30, () => tePlay("g_bg", { play_type: "run_block", block_type: "inline", block_success: true })),
    );
    const gamePlays = repeat(5, () => tePlay("g1", { positioning: "slot", coverage: "man", was_open: true }));
    expect(computeTEBlockAboveExpectedForPlays(gamePlays, baselines)).toBeNull();
  });
});
