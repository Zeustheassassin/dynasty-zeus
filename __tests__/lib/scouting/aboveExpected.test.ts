import { describe, it, expect } from "vitest";
import {
  computeRBAboveExpected,
  computeQBAboveExpected,
  computeQBAAEBreakdown,
  computeQBThrowSliceAAE,
  computeRBRunSliceSRAE,
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
  computeRBAboveExpectedSamples,
  computeQBAboveExpectedSamples,
  computeTERouteAboveExpectedSamples,
  computeTEBlockAboveExpectedSamples,
  computeRBRoleSlices,
  computeQBRoleSlices,
  computeTERoleSlices,
  aeValues,
} from "@/lib/scouting/aboveExpected";
import { aboveExpectedSampleForPlays, expectedFromModel } from "@/lib/scouting/difficultyModel";
import { SEASON_DECAY } from "@/lib/scouting/seasonWeight";
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
  unblocked_defender = false,
): RBPlay =>
  ({ game_id, run_type, formation, success, loaded_box, unblocked_defender }) as unknown as RBPlay;

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

  it("returns 0 for a lone RB whose situations differ (the league is exactly him)", () => {
    // Formation mix: 10 gun (8 success), 10 under_center (2 success), all
    // loaded. The model's unpenalized intercept makes the league's expected
    // sum equal its actual sum, so the RB who IS the league reads exactly 0.
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
// computeQBAboveExpected  (graded throw value + difficulty model)
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

  it("league-wide AAE nets to 0 (play-weighted) even when QBs face different situations", () => {
    // The unpenalized intercept makes the league's expected sum equal its actual
    // sum — the QBStatsTable footer relies on this.
    const prospects = [prospect("a", "QB"), prospect("b", "QB")];
    const games = [game("g_a", "a"), game("g_b", "b")];
    const plays = [
      ...repeat(30, (i) => qbPlay("g_a", { accuracy: i % 3 ? "on_target" : "high", depth_zone: "deep_left", pressure: "clean" })),
      ...repeat(40, (i) => qbPlay("g_b", { accuracy: i % 5 ? "on_target" : "low", depth_zone: "short_right", pressure: "backside" })),
    ];
    const out = computeQBAboveExpected(prospects, games, plays);
    expect(Math.abs((30 * out.get("a")! + 40 * out.get("b")!) / 70)).toBeLessThan(0.01);
  });
});

// =============================================================================
// Difficulty model — a throw is judged against throws like it
// =============================================================================

describe("QB AAE difficulty model", () => {
  // Background league where going deep and throwing cross-body on the run each
  // make a throw harder, independently: clean short throws hit 90%, clean deep
  // throws 60%, short cross-body throws 60%. No deep cross-body throw is in the
  // league — the model must infer that one from the two effects.
  const league = [
    ...repeat(100, (i) => qbPlay("g_bg", { accuracy: i % 10 ? "on_target" : "high", depth_zone: "short_center", pressure: "clean", platform: "on_platform" })),
    ...repeat(100, (i) => qbPlay("g_bg", { accuracy: i % 5 < 3 ? "on_target" : "high", depth_zone: "deep_center", pressure: "clean", platform: "on_platform" })),
    ...repeat(100, (i) => qbPlay("g_bg", { accuracy: i % 5 < 3 ? "on_target" : "high", depth_zone: "short_center", pressure: "front_side", platform: "on_the_run", platform_side: "cross_body" })),
  ];
  const R = resolveBaselines(buildQBBaselines(league));
  // One-throw AAE: for a hit it's (1 − expected) × 100, for a dropped miss
  // (0.2 − expected) × 100 — either way, a harder throw scores higher.
  const aae = (opts: Partial<QBPlay> & { accuracy: QBPlay["accuracy"] }) =>
    computeQBAAEForPlays([qbPlay("g1", { completion: "incomplete", ...opts })], R)!;
  const deepClean = { depth_zone: "deep_center", pressure: "clean", platform: "on_platform" } as const;
  const shortCross = { depth_zone: "short_center", pressure: "front_side", platform: "on_the_run", platform_side: "cross_body" } as const;
  const deepCross = { depth_zone: "deep_center", pressure: "front_side", platform: "on_the_run", platform_side: "cross_body" } as const;

  it("a pressured cross-body miss costs less than the same miss from a clean pocket", () => {
    const cleanMiss = aae({ accuracy: "high", ...deepClean });
    const hardMiss = aae({ accuracy: "high", ...deepCross });
    expect(hardMiss).toBeLessThan(0);
    expect(hardMiss - cleanMiss).toBeGreaterThan(10); // far less than a clean-pocket miss, not ~2 pts
  });

  it("difficulty stacks: deep + cross-body is expected to be harder than either alone", () => {
    // Both single-tag situations run at a 0.68 mean value (60% hit), so a hit
    // there is worth ≈ +32. Stacked effects must expect the deep cross-body throw
    // to be HARDER than anything the league has seen — an average of
    // per-dimension rates can never go below the lowest rate, so it can't pass.
    const singleTagHit = (1 - 0.68) * 100;
    const hitDeep = aae({ accuracy: "on_target", ...deepClean });
    const hitCross = aae({ accuracy: "on_target", ...shortCross });
    const hitBoth = aae({ accuracy: "on_target", ...deepCross });
    expect(hitBoth).toBeGreaterThan(hitDeep);
    expect(hitBoth).toBeGreaterThan(hitCross);
    expect(hitBoth).toBeGreaterThan(singleTagHit + 5);
  });

  it("with plenty of data, lands a well-sampled situation near its league rate", () => {
    // Same league ×10. Clean short throws hit 90% ⇒ mean value 0.92, so a hit
    // is worth ≈ +8. The ridge shrinks toward average, most at small samples;
    // at this size it should cost well under 2 pts.
    const bigR = resolveBaselines(buildQBBaselines(repeat(10, () => league).flat()));
    const hit = computeQBAAEForPlays(
      [qbPlay("g1", { accuracy: "on_target", depth_zone: "short_center", pressure: "clean", platform: "on_platform" })],
      bigR,
    )!;
    expect(Math.abs(hit - 8)).toBeLessThan(2);
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
// computeQBThrowSliceAAE  (AAE by throw location)
// =============================================================================

describe("computeQBThrowSliceAAE", () => {
  // QB "a": 12 deep-left, 8 deep-center, 14 mid-right, 16 short-center throws,
  // hitting each at a different rate. QB "b" fills out the league.
  const prospects = [prospect("a", "QB"), prospect("b", "QB"), prospect("small", "QB"), prospect("rb", "RB")];
  const games = [game("g_a", "a"), game("g_b", "b"), game("g_small", "small"), game("g_rb", "rb")];
  const throwsOf = (g: string, n: number, zone: QBPlay["depth_zone"], hitEvery: number) =>
    repeat(n, (i) => qbPlay(g, { accuracy: i % hitEvery ? "high" : "on_target", completion: "incomplete", depth_zone: zone }));
  const plays = [
    ...throwsOf("g_a", 12, "deep_left", 2),
    ...throwsOf("g_a", 8, "deep_center", 3),
    ...throwsOf("g_a", 14, "mid_right", 1),
    ...throwsOf("g_a", 16, "short_center", 4),
    ...throwsOf("g_b", 20, "deep_right", 3),
    ...throwsOf("g_b", 20, "mid_center", 2),
    ...throwsOf("g_b", 20, "short_left", 1),
    ...throwsOf("g_small", 20, "short_left", 1),
  ];
  const out = computeQBThrowSliceAAE(prospects, games, plays);
  const a = out.get("a")!;

  it("reads each slice off the depth zone: outside = left + right, inside = center", () => {
    expect(a.outside.n).toBe(12 + 14);
    expect(a.inside.n).toBe(8 + 16);
    expect(a.deep.n).toBe(12 + 8);
    expect(a.intermediate.n).toBe(14);
    expect(a.short.n).toBe(16);
  });

  it("blanks every slice under the 25-throw AAE floor; other positions get no entry", () => {
    for (const s of [a.outside, a.inside, a.deep, a.intermediate, a.short]) expect(s.ae).not.toBeNull();
    // "small" has 20 short throws — enough for the slice, not for AAE itself.
    const small = out.get("small")!;
    expect(small.short.n).toBe(20);
    expect(small.short.ae).toBeNull();
    expect(out.has("rb")).toBe(false);
  });

  it("blanks a slice the QB threw fewer than 10 times", () => {
    const thin = computeQBThrowSliceAAE(
      [prospect("t", "QB")], [game("g_t", "t")],
      [...plays, ...throwsOf("g_t", 20, "short_left", 2), ...throwsOf("g_t", 9, "deep_center", 2)],
    ).get("t")!;
    expect(thin.deep.n).toBe(9);
    expect(thin.deep.ae).toBeNull();
    expect(thin.short.ae).not.toBeNull();
  });

  it("splits the headline exactly: each set of slices averages back to the QB's AAE", () => {
    const total = computeQBAboveExpected(prospects, games, plays).get("a")!;
    const mean = (...ss: { ae: number | null; n: number }[]) =>
      ss.reduce((s, x) => s + x.ae! * x.n, 0) / ss.reduce((s, x) => s + x.n, 0);
    expect(mean(a.outside, a.inside)).toBeCloseTo(total, 1);
    expect(mean(a.deep, a.intermediate, a.short)).toBeCloseTo(total, 1);
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

  it("scores press routes too (press is its own bucket, not dropped)", () => {
    // The prospect runs press + man routes against a man-only league. Press has
    // no league data yet, so it adds no effect — but those routes still count.
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

// =============================================================================
// RB / TE difficulty models — a rep is judged against reps like it
// =============================================================================

describe("RB SRAE difficulty model", () => {
  // League: blocked, unloaded runs succeed 60%; runs with an unblocked defender
  // 20%; loaded-box runs 30%. No loaded-box + unblocked run in the league — the
  // model must infer that one from the two effects.
  const league = [
    ...repeat(200, (i) => rbPlay("g_bg", "inside_zone", "gun", i % 5 < 3, false, false)),
    ...repeat(100, (i) => rbPlay("g_bg", "inside_zone", "gun", i % 5 < 1, false, true)),
    ...repeat(100, (i) => rbPlay("g_bg", "inside_zone", "gun", i % 10 < 3, true, false)),
  ];
  const B = buildRBBaselines(league);
  const oneRun = (success: boolean, loaded: boolean, unblocked: boolean, run: RBRunType = "inside_zone") =>
    computeRBAboveExpectedForPlays([rbPlay("g1", run, "gun", success, loaded, unblocked)], B)!;

  it("a stuffed run with an unblocked defender costs far less than a blocked one", () => {
    expect(oneRun(false, false, true) - oneRun(false, false, false)).toBeGreaterThan(30);
  });

  it("difficulty stacks: loaded box + unblocked defender is harder than either alone", () => {
    // An average of per-dimension rates can never go below the lowest rate, so
    // a success here could never out-earn both single-tag successes.
    const both = oneRun(true, true, true);
    expect(both).toBeGreaterThan(oneRun(true, false, true));
    expect(both).toBeGreaterThan(oneRun(true, true, false));
  });

  it("run type is not a difficulty dimension", () => {
    expect(oneRun(true, false, false, "outside_zone")).toBe(oneRun(true, false, false, "inside_zone"));
  });

  it("league-wide SRAE nets to 0 (run-weighted) even when RBs face different situations", () => {
    const prospects = [prospect("a", "RB"), prospect("b", "RB")];
    const games = [game("g_a", "a"), game("g_b", "b")];
    const plays = [
      ...repeat(30, (i) => rbPlay("g_a", "inside_zone", "gun", i % 5 === 0, false, true)),
      ...repeat(40, (i) => rbPlay("g_b", "outside_zone", "under_center", i % 2 === 0, true, false)),
    ];
    const out = computeRBAboveExpected(prospects, games, plays);
    expect(Math.abs((30 * out.get("a")! + 40 * out.get("b")!) / 70)).toBeLessThan(0.01);
  });
});

describe("computeRBRunSliceSRAE  (SRAE by run type)", () => {
  // League: outside runs succeed 70%, inside runs 40%. Back "a" matches the
  // league on both, so he is average on each — even though his outside runs
  // beat the league's overall rate by ~15 pts.
  const prospects = [prospect("a", "RB"), prospect("small", "RB"), prospect("qb", "QB")];
  const games = [game("g_a", "a"), game("g_small", "small"), game("g_qb", "qb")];
  const plays = [
    ...repeat(200, (i) => rbPlay("g_bg", "outside_zone", "gun", i % 10 < 7, false)),
    ...repeat(200, (i) => rbPlay("g_bg", "inside_zone", "gun", i % 10 < 4, false)),
    ...repeat(20, (i) => rbPlay("g_a", "outside_zone", "gun", i % 10 < 7, false)),
    ...repeat(20, (i) => rbPlay("g_a", "inside_zone", "gun", i % 10 < 4, false)),
    ...repeat(14, (i) => rbPlay("g_small", "outside_zone", "gun", i % 10 < 7, false)),
  ];
  const out = computeRBRunSliceSRAE(prospects, games, plays);
  const a = out.get("a")!;

  it("judges each slice against the league on the same run type", () => {
    expect(Math.abs(a.outside.ae!)).toBeLessThan(1);
    expect(Math.abs(a.inside.ae!)).toBeLessThan(1);
    // The headline model ignores run type, so the same outside runs read well
    // above expected there.
    const outsideOnly = computeRBAboveExpectedForPlays(plays.filter((p) => p.game_id === "g_a" && p.run_type === "outside_zone"), buildRBBaselines(plays))!;
    expect(outsideOnly).toBeGreaterThan(10);
  });

  it("pairs run types: outside/inside by direction, zone/man gap by scheme", () => {
    expect(a.outside.n).toBe(20);
    expect(a.inside.n).toBe(20);
    expect(a.zone.n).toBe(40);
    expect(a.man_gap.n).toBe(0);
  });

  it("blanks a slice under 10 runs, and every slice under the 15-run SRAE floor", () => {
    expect(a.zone.ae).not.toBeNull();
    expect(a.man_gap.ae).toBeNull();
    // "small" has 14 outside runs: enough for the slice, not for SRAE itself.
    expect(out.get("small")!.outside.n).toBe(14);
    expect(out.get("small")!.outside.ae).toBeNull();
    expect(out.has("qb")).toBe(false);
  });
});

describe("TE difficulty models", () => {
  it("TE-SAER: a closed go route costs less than a closed slant (route type counts)", () => {
    const B = buildTERouteBaselines([
      ...repeat(200, (i) => tePlay("g_bg", { route_type: "nine", coverage: "zone", positioning: "slot", was_open: i % 10 < 3 })),
      ...repeat(200, (i) => tePlay("g_bg", { route_type: "slant", coverage: "zone", positioning: "slot", was_open: i % 10 < 9 })),
    ]);
    const closed = (route_type: TEPlay["route_type"]) =>
      computeTERouteAboveExpectedForPlays([tePlay("g1", { route_type, coverage: "zone", positioning: "slot", was_open: false })], B)!;
    expect(closed("nine") - closed("slant")).toBeGreaterThan(30);
  });

  it("TE-SAER: press is its own, harder bucket than off man", () => {
    const B = buildTERouteBaselines([
      ...repeat(200, (i) => tePlay("g_bg", { route_type: "curl", coverage: "press", positioning: "inline", was_open: i % 10 < 3 })),
      ...repeat(200, (i) => tePlay("g_bg", { route_type: "curl", coverage: "man", positioning: "inline", was_open: i % 10 < 8 })),
    ]);
    const closed = (coverage: TEPlay["coverage"]) =>
      computeTERouteAboveExpectedForPlays([tePlay("g1", { route_type: "curl", coverage, positioning: "inline", was_open: false })], B)!;
    expect(closed("press") - closed("man")).toBeGreaterThan(25);
  });

  it("TE-SAEB: a lost movement block costs less than a lost inline block", () => {
    const B = buildTEBlockBaselines([
      ...repeat(200, (i) => tePlay("g_bg", { play_type: "run_block", block_type: "movement", block_success: i % 10 < 6 })),
      ...repeat(200, (i) => tePlay("g_bg", { play_type: "run_block", block_type: "inline", block_success: i % 20 < 19 })),
    ]);
    const lost = (block_type: TEBlockType) =>
      computeTEBlockAboveExpectedForPlays([tePlay("g1", { play_type: "run_block", block_type, block_success: false })], B)!;
    expect(lost("movement") - lost("inline")).toBeGreaterThan(20);
  });
});

// =============================================================================
// AE samples — each headline AE with its play count and sampling variance, for
// the cross-position AE Score (aeComposite.ts)
// =============================================================================

describe("AE samples", () => {
  // Two prospects per position in one league, one clearly better, so each
  // model has something to separate.
  const prospects = [
    prospect("rbA", "RB"), prospect("rbB", "RB"),
    prospect("qbA", "QB"), prospect("qbB", "QB"),
    prospect("teA", "TE"), prospect("teB", "TE"),
  ];
  const games = ["rbA", "rbB", "qbA", "qbB", "teA", "teB"].map((id) => game(`g_${id}`, id));
  const rbPlays = [
    ...repeat(30, (i) => rbPlay("g_rbA", "inside_zone", "gun", i % 10 < 7, i % 3 === 0)),
    ...repeat(30, (i) => rbPlay("g_rbB", "outside_zone", "pistol", i % 10 < 4, i % 2 === 0)),
  ];
  const qbPlays = [
    ...repeat(40, (i) => qbPlay("g_qbA", { accuracy: i % 10 < 8 ? "on_target" : "high", depth_zone: i % 2 ? "deep_left" : "short_center" })),
    ...repeat(40, (i) => qbPlay("g_qbB", { accuracy: i % 10 < 5 ? "on_target" : "behind", completion: i % 4 ? "caught" : null, depth_zone: "short_center" })),
  ];
  const tePlays = [
    ...repeat(20, (i) => tePlay("g_teA", { positioning: "slot", coverage: "man", was_open: i % 4 !== 0 })),
    ...repeat(20, (i) => tePlay("g_teB", { positioning: "inline", coverage: "zone", was_open: i % 2 === 0 })),
    ...repeat(20, (i) => tePlay("g_teA", { play_type: "run_block", block_type: "inline", block_success: i % 5 !== 0 })),
    ...repeat(20, (i) => tePlay("g_teB", { play_type: "pass_block", block_type: "movement", block_success: i % 2 === 0 })),
  ];

  it("carries exactly the value each headline column shows", () => {
    expect(aeValues(computeRBAboveExpectedSamples(prospects, games, rbPlays)))
      .toEqual(computeRBAboveExpected(prospects, games, rbPlays));
    expect(aeValues(computeQBAboveExpectedSamples(prospects, games, qbPlays)))
      .toEqual(computeQBAboveExpected(prospects, games, qbPlays));
    expect(aeValues(computeTERouteAboveExpectedSamples(prospects, games, tePlays)))
      .toEqual(computeTERouteAboveExpected(prospects, games, tePlays));
    expect(aeValues(computeTEBlockAboveExpectedSamples(prospects, games, tePlays)))
      .toEqual(computeTEBlockAboveExpected(prospects, games, tePlays));
    // And the fixture really separates them, so the check above isn't 0 = 0.
    const rb = computeRBAboveExpected(prospects, games, rbPlays);
    expect(rb.get("rbA")!).toBeGreaterThan(rb.get("rbB")!);
  });

  it("counts only the plays the metric is built on", () => {
    expect(computeRBAboveExpectedSamples(prospects, games, rbPlays).get("rbA")!.n).toBe(30);
    expect(computeQBAboveExpectedSamples(prospects, games, [
      ...qbPlays,
      ...repeat(10, () => qbPlay("g_qbA", { play_type: "run", accuracy: null })),
      ...repeat(10, () => qbPlay("g_qbA", { accuracy: "tipped_ball", depth_zone: "short_center" })),
    ]).get("qbA")!.n).toBe(40);
    expect(computeTERouteAboveExpectedSamples(prospects, games, tePlays).get("teA")!.n).toBe(20);
    expect(computeTEBlockAboveExpectedSamples(prospects, games, tePlays).get("teA")!.n).toBe(20);
  });

  it("gives the sampling variance of the mean residual, in pts²", () => {
    // A lone back who is the whole league, 10 of 20 successes in one bucket:
    // every run is expected at 0.5, so the residuals are ±0.5.
    const lone = [prospect("rb1", "RB")];
    const plays = [
      ...repeat(10, () => rbPlay("g1", "inside_zone", "gun", true, true)),
      ...repeat(10, () => rbPlay("g1", "inside_zone", "gun", false, true)),
    ];
    const smp = computeRBAboveExpectedSamples(lone, [game("g1", "rb1")], plays).get("rb1")!;
    expect(smp.ae).toBe(0);
    expect(smp.n).toBe(20);
    expect(smp.variance).toBeCloseTo(((20 * 0.25) / 19 / 20) * 1e4, 6);
  });

  it("sums residuals by opponent tier when given the game tiers, without changing the value", () => {
    const tiers = new Map([["g_rbA", "G5" as const]]);
    const plain = computeRBAboveExpectedSamples(prospects, games, rbPlays).get("rbA")!;
    const split = computeRBAboveExpectedSamples(prospects, games, rbPlays, tiers).get("rbA")!;
    expect(split.ae).toBe(plain.ae);
    expect(plain.byTier).toBeUndefined();
    expect(split.byTier!.G5!.n).toBe(30);
    // Residuals sum to (actual − expected) × n: the AE, back in fractions.
    expect(split.byTier!.G5!.resid).toBeCloseTo((split.ae / 100) * 30, 1);
    // rbB's game isn't in the map: no tier, nothing summed.
    expect(computeRBAboveExpectedSamples(prospects, games, rbPlays, tiers).get("rbB")!.byTier).toEqual({});
  });

  it("is null under the same floor as the column", () => {
    const short = rbPlays.filter((pl) => pl.game_id === "g_rbA").slice(0, 14);
    expect(computeRBAboveExpectedSamples(prospects, games, short).get("rbA")).toBeNull();
    expect(computeQBAboveExpectedSamples(prospects, games, qbPlays.slice(0, 24)).get("qbA")).toBeNull();
  });
});

// =============================================================================
// Season weighting — older tape counts a little less (seasonWeight.ts)
// =============================================================================

describe("season weighting", () => {
  const dated = (id: string, prospect_id: string, season_year: number): ScoutingGame =>
    ({ id, prospect_id, season_year }) as unknown as ScoutingGame;
  // One situation bucket, so every run is expected at the same rate. Back "a"
  // converted 50% in 2025 and 80% in 2026, 20 runs each.
  const rbs = [prospect("a", "RB")];
  const runs = [
    ...repeat(200, (i) => rbPlay("g_bg", "inside_zone", "gun", i % 10 < 6, false)),
    ...repeat(20, (i) => rbPlay("a25", "inside_zone", "gun", i % 10 < 5, false)),
    ...repeat(20, (i) => rbPlay("a26", "inside_zone", "gun", i % 10 < 8, false)),
  ];
  const undated = [game("a25", "a"), game("a26", "a")];
  const seasons = [dated("a25", "a", 2025), dated("a26", "a", 2026)];

  it("leans the AE toward the newer season", () => {
    const flat = computeRBAboveExpectedSamples(rbs, undated, runs).get("a")!;
    const weighted = computeRBAboveExpectedSamples(rbs, seasons, runs).get("a")!;
    const newerLean = (0.5 * 20 * SEASON_DECAY + 0.8 * 20) / (20 * SEASON_DECAY + 20) - 0.65;
    expect(weighted.ae - flat.ae).toBeCloseTo(newerLean * 100, 1);
    expect(weighted.n).toBe(40);
    expect(weighted.w).toBeCloseTo(20 + 20 * SEASON_DECAY, 9);
    expect(flat.w).toBe(40);
  });

  it("changes nothing when the seasons agree", () => {
    const same = [
      ...repeat(200, (i) => rbPlay("g_bg", "inside_zone", "gun", i % 10 < 6, false)),
      ...repeat(20, (i) => rbPlay("a25", "inside_zone", "gun", i % 10 < 7, false)),
      ...repeat(20, (i) => rbPlay("a26", "inside_zone", "gun", i % 10 < 7, false)),
    ];
    const flat = computeRBAboveExpectedSamples(rbs, undated, same).get("a")!;
    const weighted = computeRBAboveExpectedSamples(rbs, seasons, same).get("a")!;
    expect(weighted.ae).toBe(flat.ae);
  });

  it("gives the weighted mean's sampling variance (reliability weights)", () => {
    const B = buildRBBaselines(runs);
    const e = expectedFromModel(B.model!, B.design.cols(runs[0]));
    const mine = runs.filter((pl) => pl.game_id !== "g_bg");
    const w = mine.map((pl) => (pl.game_id === "a25" ? SEASON_DECAY : 1));
    const r = mine.map((pl) => (pl.success ? 1 : 0) - e);
    const W = w.reduce((s, x) => s + x, 0);
    const W2 = w.reduce((s, x) => s + x * x, 0);
    const mean = r.reduce((s, x, i) => s + w[i] * x, 0) / W;
    const perPlay = r.reduce((s, x, i) => s + w[i] * (x - mean) ** 2, 0) / (W - W2 / W);
    const smp = computeRBAboveExpectedSamples(rbs, seasons, runs).get("a")!;
    expect(smp.variance).toBeCloseTo(((perPlay * W2) / (W * W)) * 1e4, 6);
  });

  it("is scale-free: a uniform weight leaves the AE and its variance alone", () => {
    const B = buildRBBaselines(runs);
    const mine = runs.filter((pl) => pl.game_id !== "g_bg");
    const y = (pl: RBPlay) => (pl.success ? 1 : 0);
    const plain = aboveExpectedSampleForPlays(mine, B, y)!;
    const halved = aboveExpectedSampleForPlays(mine, B, y, { weightOf: () => 0.5 })!;
    expect(halved.ae).toBe(plain.ae);
    expect(halved.variance).toBeCloseTo(plain.variance, 9);
  });

  it("weights each tier's share of the reps for the opponent adjustment", () => {
    const tiers = new Map([["a25", "G5" as const], ["a26", "P4" as const]]);
    const smp = computeRBAboveExpectedSamples(rbs, seasons, runs, tiers).get("a")!;
    expect(smp.byTier!.G5!.n).toBe(20);
    expect(smp.byTier!.G5!.w).toBeCloseTo(20 * SEASON_DECAY, 9);
    expect(smp.byTier!.P4!.w).toBe(20);
  });

  it("weights the RB run-type slices too", () => {
    const flat = computeRBRunSliceSRAE(rbs, undated, runs).get("a")!;
    const weighted = computeRBRunSliceSRAE(rbs, seasons, runs).get("a")!;
    expect(weighted.inside.n).toBe(40);
    expect(weighted.inside.ae!).toBeGreaterThan(flat.inside.ae!);
  });

  describe("QB", () => {
    // All short-center throws: on target 50% in 2025, 90% in 2026.
    const qbs = [prospect("q", "QB")];
    const throws = [
      ...repeat(200, (i) => qbPlay("g_bg", { accuracy: i % 10 < 7 ? "on_target" : "high", depth_zone: "short_center" })),
      ...repeat(30, (i) => qbPlay("q25", { accuracy: i % 10 < 5 ? "on_target" : "high", depth_zone: "short_center" })),
      ...repeat(30, (i) => qbPlay("q26", { accuracy: i % 10 < 9 ? "on_target" : "high", depth_zone: "short_center" })),
    ];
    const qGames = [dated("q25", "q", 2025), dated("q26", "q", 2026)];
    const mine = throws.filter((pl) => pl.game_id !== "g_bg");

    it("weights the headline, and the Overview total still matches it", () => {
      const flat = computeQBAboveExpectedSamples(qbs, [game("q25", "q"), game("q26", "q")], throws).get("q")!;
      const weighted = computeQBAboveExpectedSamples(qbs, qGames, throws).get("q")!;
      expect(weighted.ae).toBeGreaterThan(flat.ae);
      expect(computeQBAAEBreakdown(mine, throws, qGames).total).toBe(weighted.ae);
      // Without the games, the Overview counts every throw in full.
      expect(computeQBAAEBreakdown(mine, throws).total).toBe(flat.ae);
    });

    it("weights the Overview per-dimension rows", () => {
      const depth = (games?: ScoutingGame[]) => computeQBAAEBreakdown(mine, throws, games).dims.find((d) => d.key === "depth")!;
      expect(depth(qGames).aae!).toBeGreaterThan(depth().aae!);
      expect(depth(qGames).n).toBe(60);
    });

    it("weights the throw-location slices", () => {
      const weighted = computeQBAboveExpectedSamples(qbs, qGames, throws).get("q")!;
      // Every throw is short, so the short slice is the whole headline.
      expect(computeQBThrowSliceAAE(qbs, qGames, throws).get("q")!.short.ae).toBe(weighted.ae);
    });
  });

  it("weights TE-SAER and TE-SAEB", () => {
    const tes = [prospect("t", "TE")];
    const plays = [
      ...repeat(20, (i) => tePlay("t25", { positioning: "slot", coverage: "man", was_open: i % 10 < 3 })),
      ...repeat(20, (i) => tePlay("t26", { positioning: "slot", coverage: "man", was_open: i % 10 < 8 })),
      ...repeat(20, (i) => tePlay("t25", { play_type: "run_block", block_type: "inline", block_success: i % 10 < 4 })),
      ...repeat(20, (i) => tePlay("t26", { play_type: "run_block", block_type: "inline", block_success: i % 10 < 9 })),
      ...repeat(100, (i) => tePlay("g_bg", { positioning: "slot", coverage: "man", was_open: i % 2 === 0 })),
      ...repeat(100, (i) => tePlay("g_bg", { play_type: "run_block", block_type: "inline", block_success: i % 2 === 0 })),
    ];
    const undatedTE = [game("t25", "t"), game("t26", "t")];
    const datedTE = [dated("t25", "t", 2025), dated("t26", "t", 2026)];
    expect(computeTERouteAboveExpectedSamples(tes, datedTE, plays).get("t")!.ae)
      .toBeGreaterThan(computeTERouteAboveExpectedSamples(tes, undatedTE, plays).get("t")!.ae);
    expect(computeTEBlockAboveExpectedSamples(tes, datedTE, plays).get("t")!.ae)
      .toBeGreaterThan(computeTEBlockAboveExpectedSamples(tes, undatedTE, plays).get("t")!.ae);
  });
});

// =============================================================================
// Role-bucket slices (roleFitRB / roleFitQB / roleFitTE)
// =============================================================================

describe("role-bucket slices", () => {
  it("RB: the all-runs slice is SRAE itself, run-type slices use the run-type model, and there's no floor", () => {
    const prospects = [prospect("a", "RB"), prospect("thin", "RB"), prospect("qb", "QB")];
    const games = [game("g_a", "a"), game("g_thin", "thin")];
    const plays = [
      ...repeat(200, (i) => rbPlay("g_bg", "outside_zone", "gun", i % 10 < 7, false)),
      ...repeat(200, (i) => rbPlay("g_bg", "inside_man_gap", "gun", i % 10 < 4, false)),
      ...repeat(20, (i) => rbPlay("g_a", "outside_zone", "gun", i % 10 < 7, false)),
      ...repeat(20, (i) => rbPlay("g_a", "inside_man_gap", "gun", i % 10 < 4, i < 5)),
      ...repeat(3, () => rbPlay("g_thin", "outside_zone", "gun", true, false)),
    ];
    const out = computeRBRoleSlices(prospects, games, plays, {
      all: { pred: () => true },
      loaded: { pred: (pl) => pl.loaded_box },
      zone: { pred: (pl) => pl.run_type === "outside_zone", byRunType: true },
    });
    const a = out.get("a")!;
    expect(a.all.ae).toBeCloseTo(computeRBAboveExpected(prospects, games, plays).get("a")!, 6);
    expect(a.loaded.n).toBe(5);
    expect(Math.abs(a.zone.ae!)).toBeLessThan(1); // matches the league on his run type
    expect(out.get("thin")!.all.n).toBe(3);       // under SRAE's 15-run floor, still read
    expect(out.has("qb")).toBe(false);
  });

  it("QB: the all slice is AAE itself; an empty slice is null", () => {
    const prospects = [prospect("q", "QB")];
    const games = [game("g_q", "q")];
    const plays = [
      ...repeat(40, (i) => qbPlay("g_bg", { accuracy: i % 2 ? "on_target" : "high", depth_zone: "short_center" })),
      ...repeat(30, (i) => qbPlay("g_q", { accuracy: i % 3 ? "on_target" : "low", depth_zone: "short_center" })),
    ];
    const out = computeQBRoleSlices(prospects, games, plays, { all: () => true, deep: (pl) => pl.depth_zone?.startsWith("deep_") ?? false });
    expect(out.get("q")!.all.ae).toBeCloseTo(computeQBAboveExpected(prospects, games, plays).get("q")!, 6);
    expect(out.get("q")!.deep).toEqual({ ae: null, n: 0 });
  });

  it("TE: route slices read rated routes, block slices rated blocks", () => {
    const prospects = [prospect("t", "TE")];
    const games = [game("g_t", "t")];
    const plays = [
      ...repeat(20, (i) => tePlay("g_t", { was_open: i % 2 === 0, coverage: i < 8 ? "man" : "zone", route_type: "flat" })),
      ...repeat(16, (i) => tePlay("g_t", { play_type: "run_block", block_type: i < 10 ? "inline" : "movement", block_success: i % 2 === 0 })),
    ];
    const out = computeTERoleSlices(prospects, games, plays, { all: () => true, man: (pl) => pl.coverage === "man" }, { all: () => true, movement: (pl) => pl.block_type === "movement" });
    const t = out.get("t")!;
    expect([t.route.all.n, t.route.man.n, t.block.all.n, t.block.movement.n]).toEqual([20, 8, 16, 6]);
  });
});
