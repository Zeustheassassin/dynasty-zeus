import { describe, it, expect } from "vitest";
import { teRoleFit, computeTERoleFits, TE_MIN_SNAPS, ALL_AROUND_MIN_ROUTES, type TERoleInputs } from "@/lib/scouting/roleFitTE";
import { matchFor, ALL_AROUND_LINE } from "@/lib/scouting/roleFit";
import type { Prospect, ScoutingGame, TEPlay } from "@/lib/types";

const play = (over: Partial<TEPlay>): TEPlay => ({
  id: "", user_id: "", game_id: "g", location: "left", positioning: "inline", play_type: "route_run",
  block_type: null, block_success: null, coverage: "zone", route_type: "curl", was_open: true, targeted: false,
  caught: null, dropped: null, contested_target: null, contested_catch: null, broken_tackle: false, play_notes: null,
  created_at: "", ...over,
});
const many = (n: number, over: Partial<TEPlay> = {}) => Array.from({ length: n }, () => play(over));
const block = (over: Partial<TEPlay> = {}): Partial<TEPlay> => ({ play_type: "run_block", block_type: "inline", block_success: true, coverage: null, route_type: null, was_open: null, ...over });

const slice = (ae: number, n: number) => ({ ae, n });
const inputs = (plays: TEPlay[], r: { all?: number; man?: number; flat?: number }, b: { all?: number; inline?: number; movement?: number }, size = { heightIn: 77, weightLb: 250 }): TERoleInputs => ({
  plays,
  route: { all: slice(r.all ?? 0, 60), man: slice(r.man ?? 0, 25), flat: slice(r.flat ?? 0, 10) },
  block: { all: slice(b.all ?? 0, 60), inline: slice(b.inline ?? 0, 40), movement: slice(b.movement ?? 0, 20) },
  ...size,
});

describe("TE role buckets", () => {
  it("makes a route winner who lines up in the slot or wide a Move TE", () => {
    const plays = [...many(70, { positioning: "slot" }), ...many(30, { positioning: "wide" }), ...many(20, block())];
    const f = teRoleFit(inputs(plays, { all: 12, man: 12 }, { all: -4 }))!;
    expect(f.best).toBe("move");
    expect(f.usedAs).toBe("move");
  });

  it("makes an inline TE who wins on routes and blocks a bit above average an Inline Y", () => {
    const plays = [...many(50, { positioning: "inline" }), ...many(60, block())];
    const f = teRoleFit(inputs(plays, { all: 6 }, { all: 2, inline: 2 }))!;
    expect(f.best).toBe("inline_y");
    expect(matchFor(f, "all_around")!.pct).toBeLessThan(ALL_AROUND_LINE);
  });

  it("makes a TE who wins on routes and as a blocker, with the size, All-Around, on its own", () => {
    const plays = [...many(50, { positioning: "inline" }), ...many(60, block())];
    const f = teRoleFit(inputs(plays, { all: 10 }, { all: 10, inline: 10 }))!;
    expect(f.best).toBe("all_around");
    expect(f.also).toEqual([]);
    expect(matchFor(f, "all_around")!.pct).toBeGreaterThanOrEqual(ALL_AROUND_LINE);
  });

  it("keeps a great receiver who can't block out of All-Around (the weaker side gates it)", () => {
    const plays = [...many(70, { positioning: "slot" }), ...many(40, block())];
    const f = teRoleFit(inputs(plays, { all: 14, man: 14 }, { all: -4 }))!;
    const m = matchFor(f, "all_around")!;
    expect(m.pct).toBeLessThan(40);
    expect(m.drivers.some((d) => d.startsWith("− Above average on both routes and blocking") && d.endsWith("(−50%)"))).toBe(true);
    expect(f.best).toBe("move");
  });

  it(`never names All-Around under ${ALL_AROUND_MIN_ROUTES} rated routes`, () => {
    const plays = [...many(13, { positioning: "inline" }), ...many(60, block())];
    const inp = inputs(plays, { all: 16 }, { all: 10, inline: 10 });
    const f = teRoleFit({ ...inp, route: { ...inp.route, all: slice(16, ALL_AROUND_MIN_ROUTES - 2) } })!;
    const m = matchFor(f, "all_around")!;
    expect(m.proven).toBe(false);
    expect(m.pendingWhy).toContain(`needs ${ALL_AROUND_MIN_ROUTES}+ rated routes`);
    expect(f.best).not.toBe("all_around");
  });

  it("reads your Hands grade into All-Around, and leaves it out until a game is graded", () => {
    const plays = [...many(50, { positioning: "inline" }), ...many(60, block())];
    const base = inputs(plays, { all: 3 }, { all: 3, inline: 3 });
    const none = matchFor(teRoleFit(base)!, "all_around")!.pct;
    const good = teRoleFit({ ...base, hands: { avg: 9, games: 2 } })!;
    const poor = teRoleFit({ ...base, hands: { avg: 3, games: 2 } })!;
    expect(good.features.hands!.display).toBe("9.0 / 10 over 2 graded games");
    expect(none).toBeLessThan(matchFor(good, "all_around")!.pct);
    expect(none).toBeGreaterThan(matchFor(poor, "all_around")!.pct);
    expect(teRoleFit(base)!.features.hands).toBeUndefined();
  });

  it("drops All-Around under 6'4\" 240", () => {
    const plays = [...many(50, { positioning: "inline" }), ...many(60, block())];
    const m = matchFor(teRoleFit(inputs(plays, {}, {}, { heightIn: 75, weightLb: 235 }))!, "all_around")!;
    expect(m.sizeDrop).toBeCloseTo(0.06 + 5 * 0.006);
  });

  it("makes an inline blocker with thin receiving a Blocking TE", () => {
    const plays = [...many(25, { positioning: "inline", was_open: false }), ...many(90, block())];
    const f = teRoleFit(inputs(plays, { all: -10, man: -10 }, { all: 14, inline: 14 }))!;
    expect(f.best).toBe("blocking");
  });

  it("makes a wing / fullback who blocks on the move an H-back", () => {
    const plays = [...many(40, { positioning: "wing_back", route_type: "flat" }), ...many(50, block({ positioning: "full_back", block_type: "movement" }))];
    const f = teRoleFit(inputs(plays, { flat: 8 }, { movement: 12 }))!;
    expect(f.best).toBe("h_back");
  });

  it("drops a 6'2\" 230 as an Inline Y", () => {
    const plays = [...many(50, { positioning: "inline" }), ...many(60, block())];
    const m = matchFor(teRoleFit(inputs(plays, {}, {}, { heightIn: 74, weightLb: 230 }))!, "inline_y")!;
    expect(m.sizeDrop).toBeCloseTo(0.06 + 15 * 0.006);
  });

  it(`needs ${TE_MIN_SNAPS} snaps`, () => {
    expect(teRoleFit(inputs(many(TE_MIN_SNAPS - 1), {}, {}))).toBeNull();
  });

  it("scores every TE from the league's plays", () => {
    const prospects = [{ id: "te", position: "TE", height: "6'5\"", weight: 250 }] as unknown as Prospect[];
    const games = [{ id: "g1", prospect_id: "te", season_year: 2025 }] as unknown as ScoutingGame[];
    const plays = [...many(30, { game_id: "g1", positioning: "slot" }), ...many(20, { game_id: "g1", ...block() })];
    const fit = computeTERoleFits(prospects, games, plays).get("te")!;
    expect(fit.sample).toEqual({ n: 50, unit: "snaps" });
    expect(fit.features.hands).toBeUndefined();
  });

  it("takes the Hands grade from his graded games", () => {
    const prospects = [{ id: "te", position: "TE", height: "6'5\"", weight: 250 }] as unknown as Prospect[];
    const games = [{ id: "g1", prospect_id: "te", season_year: 2025, created_at: "2026-10-19T12:00:00Z", trait_grades: { hands: 8, inline_block: 9 } }] as unknown as ScoutingGame[];
    const plays = [...many(30, { game_id: "g1", positioning: "slot" }), ...many(20, { game_id: "g1", ...block() })];
    expect(computeTERoleFits(prospects, games, plays).get("te")!.features.hands!.display).toBe("8.0 / 10 over 1 graded game");
  });
});
